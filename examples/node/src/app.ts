import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { PrismaPg } from '@prisma/adapter-pg';
import { createEgradx, migrate, migrateEgradx, type EgradxLog } from '@babulvaibhav/egradx-sdk';
import { egradxErrors, egradxMiddleware, egradxRoutes } from '@babulvaibhav/egradx-sdk/express';
import { createEvents, migrateEvents, type Events } from '@babulvaibhav/egradx-events';
import { notificationTypes, templateDirectory } from './notifications.js';
import { noteStats } from './events.js';
import { createLogging } from './logging.js';
import { PrismaClient } from './generated/prisma/client.js';
import { AUDIT_ACTIONS, noteRoutes } from './notes.js';
import { grantNotePermissionsToNewOrganizations, seed } from './setup.js';

export interface AppConfig {
  databaseUrl: string;
  keystorePath: string;
  keyPassphrase: string;
  demoPassword: string;
  smtp: { host: string; port: number };
  log?: EgradxLog;
}

export interface Application {
  app: Express;
  close(): Promise<void>;
}

/** The application's own tables, with the SDK's runner (Flyway's history format, so any SDK can share the database). */
async function migrateOwnTables(databaseUrl: string): Promise<void> {
  await migrate({
    database: databaseUrl,
    location: fileURLToPath(new URL('../migrations/', import.meta.url)),
    table: 'notes_schema_history',
  });
}

// docs:region main
export async function startApplication(config: AppConfig): Promise<Application> {
  // The SDK's tables first (sign-in before yours, so your tables can reference them), then yours.
  await migrateEgradx(config.databaseUrl, { application: migrateOwnTables });
  await migrateEvents(config.databaseUrl);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
  // The transport comes from EGRADX_EVENTS_TRANSPORT (in-process unless set): the same code on a broker.
  const events: Events = createEvents({ prisma, source: 'notes', handlers: [noteStats()] });
  const logging = createLogging(events, 'notes');
  const egradx = createEgradx({
    prisma,
    log: config.log ?? logging.egradxLog,
    auth: {
      issuer: 'https://notes.local', // any stable identifier, stamped on every token
      keys: { keystorePath: config.keystorePath, passphrase: config.keyPassphrase },
      onOrganizationCreated: [grantNotePermissionsToNewOrganizations(() => egradx)],
    },
    audit: { actions: AUDIT_ACTIONS },
    notifications: {
      types: notificationTypes,
      templates: { directories: [templateDirectory] },
      // The application's own mail server, for every organization that has not stored SMTP settings of its own.
      builtInChannels: {
        email: { transport: { host: config.smtp.host, port: config.smtp.port, secure: false }, from: 'no-reply@notes.local', fromName: 'Notes' },
      },
    },
  });
  await egradx.start(); // seeds the platform organization and its administrator; starts the background work
  await events.start();
  await seed(egradx, config.demoPassword);

  const app = express();
  app.use(egradxMiddleware(egradx)); // request id, then the caller from the bearer token
  app.use(noteRoutes(prisma, egradx, events)); // your own routes
  app.use(egradxRoutes(egradx));     // the SDK's endpoints: /egradx/auth, /egradx/audit, /egradx/notifications
  app.use(...egradxErrors());        // every error, yours too, as the SDK's envelope
  // docs:end

  return {
    app,
    async close() {
      await logging.close();
      await events.close();
      await egradx.close();
      await prisma.$disconnect();
    },
  };
}
