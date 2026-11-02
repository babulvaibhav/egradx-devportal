import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { correlationPrefix, createEgradx, isUuid, migrate, migrateEgradx } from '@babulvaibhav/egradx-sdk';
import { createFileStorage, fileAccessPolicy, type EgradxFileAccessPolicy } from '@babulvaibhav/egradx-file-storage';
import { oimApp } from './app.js';
import { config } from './config.js';
import { PrismaClient } from './generated/prisma/client.js';
import { AUDIT_ACTIONS, DashboardCache, Permissions, notificationTypes, organizationDefaults, seed, type Oim } from './oim.js';
import type { Telemetry } from './telemetry.js';

/** Every line carries [traceId,spanId,requestId], as the Java backend's logging.pattern.correlation gives its lines. */
const log = {
  info: (message: string) => console.info(correlationPrefix() + message),
  warn: (message: string) => console.warn(correlationPrefix() + message),
  error: (message: string, error?: unknown) => console.error(correlationPrefix() + message, error ?? ''),
};

/**
 * OIM's database, migrated in the order the Java backend migrates it, into the same history tables, so
 * either backend can start first: egradx-auth's tables, then OIM's own (the Java backend's Flyway files),
 * then egradx-audit's (moving the old audit_logs into it) and egradx-notification's.
 */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const say = (message: string) => log.info(message);
  await migrateEgradx(databaseUrl, {
    log: say,
    application: async (url) => {
      await migrate({
        database: url,
        location: config.migrations,
        table: 'flyway_schema_history',
        // As the Java backend's Flyway customizer: on a database where egradx-auth's tables came first.
        baselineDescription: 'before the first application migration, egradx-auth tables existed',
        log: say,
      });
    },
    // As the Java backend's OimLegacyAuditImport, an EgradxAuditSchemaCallback.
    afterAudit: importLegacyAudit,
  });
}

/**
 * Moves the old audit_logs table's rows into egradx-audit's trail and drops it, as the Java backend's
 * OimLegacyAuditImport does after migrating; the same SQL.
 */
async function importLegacyAudit(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ present: boolean }>(`SELECT to_regclass('public.audit_logs') IS NOT NULL AS present`);
    if (!rows[0]?.present) {
      return;
    }
    const zone = config.legacyAuditImportZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    await client.query('BEGIN');
    const copied = await client.query(`INSERT INTO egradx_audit_event (id, occurred_at, recorded_at, organization_id, category, action, outcome,
        actor_type, actor_id, entity_type, entity_id, entity_label, before_state, after_state, changed_fields, details)
      SELECT l.id, l."timestamp" AT TIME ZONE $1, coalesce(l.created_at, l."timestamp") AT TIME ZONE $1, l.organization_id, 'oim',
        CASE WHEN l.action ~ '^[A-Z]+_[A-Z_]+$' THEN lower(regexp_replace(l.action, '^([A-Z]+)_(.*)$', 'oim.\\1.\\2'))
             ELSE 'oim.legacy.' || lower(regexp_replace(l.action, '[^A-Za-z0-9_]', '_', 'g')) END,
        'SUCCESS', CASE WHEN l.user_id IS NULL THEN 'UNKNOWN' ELSE 'USER' END, l.user_id, lower(l.entity), l.entity_id::text,
        left(coalesce(s.after_state ->> 'name', s.before_state ->> 'name'), 512), s.before_state, s.after_state,
        CASE WHEN jsonb_typeof(s.before_state) = 'object' AND jsonb_typeof(s.after_state) = 'object' THEN
          ARRAY(SELECT k.key FROM (SELECT jsonb_object_keys(s.before_state) AS key UNION SELECT jsonb_object_keys(s.after_state)) k
                WHERE nullif(s.before_state -> k.key, 'null'::jsonb) IS DISTINCT FROM nullif(s.after_state -> k.key, 'null'::jsonb) ORDER BY k.key)
        END,
        jsonb_build_object('importedFrom', 'audit_logs', 'legacyAction', l.action)
          || CASE WHEN l.action = 'INVENTORY_TRANSFERRED' AND jsonb_typeof(l.old_value) = 'object' THEN l.old_value ELSE '{}'::jsonb END
      FROM audit_logs l
      CROSS JOIN LATERAL (SELECT CASE WHEN l.action = 'INVENTORY_TRANSFERRED' THEN NULL ELSE nullif(l.old_value, 'null'::jsonb) END AS before_state,
                                 nullif(l.new_value, 'null'::jsonb) AS after_state) s
      ORDER BY l."timestamp", l.id
      ON CONFLICT (id) DO NOTHING`, [zone]);
    await client.query('DROP TABLE audit_logs');
    await client.query('COMMIT');
    log.info(copied.rowCount ? `Moved ${copied.rowCount} record(s) from audit_logs into the audit trail (local times read in ${zone}), and dropped it`
      : 'Dropped the empty audit_logs table; the audit trail is egradx-audit\'s');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Who may see and add an order's attachments (attachedType `order`): those who may see the order may see its files; those
 * who may create orders may add and delete them. An id that is not an order of the caller's organization is refused. As
 * the Java backend's OrderFileAccess.
 */
export function orderFileAccess(prisma: PrismaClient): EgradxFileAccessPolicy {
  return fileAccessPolicy('order', async (request) => {
    if (!isUuid(request.attachedId)) {
      return 'DENY';
    }
    const order = await prisma.order.findFirst({ where: { id: request.attachedId, organizationId: request.organizationId }, select: { id: true } });
    if (!order) {
      return 'DENY';
    }
    const needed = request.action === 'READ' ? Permissions.ORDER_READ : Permissions.ORDER_CREATE;
    return request.authorities.has(needed) ? 'ALLOW' : 'DENY';
  });
}

/** Everything the application runs on, wired as the Java backend's auto-configuration wires it. */
export async function createOim(databaseUrl = config.databaseUrl, overrides: { platformAdminPassword?: string; dispatcher?: boolean } = {}): Promise<RunningOim> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  let oim: Oim | undefined;
  const adminPassword = overrides.platformAdminPassword ?? config.platformAdminPassword;
  // As the Java backend's application.yml configures egradx-sdk.
  // docs:region sdk-wiring
  const egradx = createEgradx({
    prisma, log,
    auth: {
      issuer: config.issuer, keys: { keystorePath: config.keystorePath, passphrase: config.keyPassphrase },
      accessTokenTtlMinutes: config.accessTokenTtlMinutes, refreshTokenTtlDays: config.refreshTokenTtlDays,
      roleAuthoritiesCacheTtlSeconds: config.roleCacheTtlSeconds, links: { baseUrl: config.publicUrl },
      // Sign-up and signing in with Google, Zoho or others (docs/auth/sign-in-methods.md).
      signup: { mode: config.signupMode },
      oidc: { callbackBaseUrl: config.oidcCallbackBaseUrl, providers: config.oidcProviders },
      platform: adminPassword ? { adminPassword } : {},
      profile: config.local ? { channels: ['email', 'sms', 'whatsapp', 'slack', 'log'] } : {},
      onOrganizationCreated: [organizationDefaults(() => oim!)],
    },
    audit: { actions: AUDIT_ACTIONS, retention: { defaultPeriod: config.auditRetention } },
    notifications: {
      types: notificationTypes(), templates: { directories: [config.templates] },
      // Stored channel secrets are encrypted with the key passphrase, as Java's egradx.security.crypto.passphrase does both.
      secrets: { passphrase: config.keyPassphrase },
      dispatcher: { enabled: overrides.dispatcher ?? true },
      builtInChannels: {
        email: { transport: config.mail ? { host: config.mail.host, port: config.mail.port, ignoreTLS: true, connectionTimeout: 10_000, socketTimeout: 30_000 }
          : null, from: config.emailFrom, fromName: config.emailFromName },
        log: config.local,
        webhook: { allowHttp: config.local },
      },
    },
    // Uploaded files, as application.yml's egradx.files.
    files: createFileStorage({
      backend: config.files.backend, maxSize: config.files.maxSize, local: { root: config.files.root },
      s3: config.files.s3, policies: [orderFileAccess(prisma)],
    }),
  });
  const { auth, auditor, notifications, files } = egradx;
  oim = { prisma, auth, auditor, notifications, files, dashboard: new DashboardCache(), log, lowStockChannels: config.lowStockChannels };
  await egradx.start();
  await seed(oim, config.seedAdminPassword);
  // docs:end
  return {
    ...oim,
    async stop() {
      await egradx.close();
      await prisma.$disconnect();
    },
  };
}

export interface RunningOim extends Oim {
  /** Stops the timers and the dispatcher, and closes the connections. */
  stop(): Promise<void>;
}

/** Migrates, starts everything, and serves until SIGINT or SIGTERM: the application as main.ts runs it. */
export async function serve(telemetry?: Telemetry): Promise<void> {
  await migrateDatabase(config.databaseUrl);
  const oim = await createOim();
  const server = oimApp(oim, { prometheus: telemetry?.prometheus })
    .listen(config.port, () => log.info(`OIM (Node) listening on http://localhost:${config.port}${config.contextPath}`));
  const stop = async () => {
    server.close();
    await oim.stop();
    await telemetry?.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
