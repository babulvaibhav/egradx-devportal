"""Startup: OIM's database migrated in the Java backend's order, the SDK wired as the Java backend's auto-configuration
wires it, the seed, and the server."""

import asyncio
import logging
import selectors
import socket
import sys
from dataclasses import dataclass

import psycopg
import tzlocal
import uvicorn
from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
from sqlalchemy.ext.asyncio import create_async_engine

from egradx.sdk import (
    CORRELATION_FORMAT,
    ApplicationEmail,
    AuditRetentionSettings,
    AuthOptions,
    BuiltInChannels,
    DispatcherSettings,
    EgradxSdk,
    LinkSettings,
    NotificationsOptions,
    OidcProviderSettings,
    OidcSettings,
    PlatformSettings,
    ProfileSettings,
    SdkOptions,
    SignupSettings,
    SmtpTransport,
    install_log_correlation,
    migrate_async,
    migrate_egradx,
)

from egradx.files import EgradxFileAccessPolicy, FilesOptions, LocalSettings, S3Settings

from .app import oim_app
from .config import Config, load_config
from .telemetry import prometheus_text, start_telemetry
from .orders import order_file_access
from .oim import AUDIT_ACTIONS, DashboardCache, Oim, notification_types, organization_defaults, seed

log = logging.getLogger("egradx.oim")

# Loopback, link-local and private ranges, as Express's 'loopback, linklocal, uniquelocal'.
_LOCAL_NETWORKS = "127.0.0.0/8,::1,169.254.0.0/16,fe80::/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"

# Moves the old audit_logs table's rows into egradx-audit's trail, as the Java backend's OimLegacyAuditImport does after
# migrating: the same SQL. %s is the zone the old local times were written in.
_LEGACY_AUDIT_IMPORT = r"""INSERT INTO egradx_audit_event (id, occurred_at, recorded_at, organization_id, category, action, outcome,
    actor_type, actor_id, entity_type, entity_id, entity_label, before_state, after_state, changed_fields, details)
  SELECT l.id, l."timestamp" AT TIME ZONE %(zone)s, coalesce(l.created_at, l."timestamp") AT TIME ZONE %(zone)s, l.organization_id, 'oim',
    CASE WHEN l.action ~ '^[A-Z]+_[A-Z_]+$' THEN lower(regexp_replace(l.action, '^([A-Z]+)_(.*)$', 'oim.\1.\2'))
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
  ON CONFLICT (id) DO NOTHING"""


def _import_legacy_audit(database_url: str, configured_zone: str) -> None:
    with psycopg.connect(database_url) as connection:
        present = connection.execute("SELECT to_regclass('public.audit_logs') IS NOT NULL").fetchone()[0]
        if not present:
            return
        # As Java's ZoneId.systemDefault(): the server's zone, by name, so daylight-saving history converts exactly.
        zone = configured_zone or tzlocal.get_localzone_name()
        with connection.transaction():
            copied = connection.execute(_LEGACY_AUDIT_IMPORT, {"zone": zone}).rowcount
            connection.execute("DROP TABLE audit_logs")
        if copied:
            log.info("Moved %d record(s) from audit_logs into the audit trail (local times read in %s), and dropped it", copied, zone)
        else:
            log.info("Dropped the empty audit_logs table; the audit trail is egradx-audit's")


async def migrate_database(config: Config, database_url: str | None = None) -> None:
    """OIM's database, migrated in the order the Java backend migrates it, into the same history tables, so any backend
    can start first: egradx-auth's tables, then OIM's own (the Java backend's Flyway files), then egradx-audit's (moving
    the old audit_logs into it) and egradx-notification's."""
    say = log.info

    async def application(url: str) -> None:
        # As the Java backend's Flyway customizer: on a database where egradx-auth's tables came first.
        await migrate_async(url, config.migrations, "flyway_schema_history",
                            baseline_description="before the first application migration, egradx-auth tables existed", log=say)

    async def import_legacy_audit(url: str) -> None:
        # As the Java backend's OimLegacyAuditImport, an EgradxAuditSchemaCallback.
        await asyncio.to_thread(_import_legacy_audit, url, config.legacy_audit_import_zone)

    await migrate_egradx(database_url or config.database_url, application=application, after_audit=import_legacy_audit, log=say)


@dataclass
class RunningOim:
    oim: Oim
    sdk: EgradxSdk

    async def stop(self) -> None:
        await self.sdk.close()
        await self.oim.engine.dispose()


async def create_oim(config: Config, database_url: str | None = None, platform_admin_password: str | None = None,
                     dispatcher: bool = True) -> RunningOim:
    """Everything the application runs on, wired as the Java backend's auto-configuration wires it."""
    url = database_url or config.database_url
    engine = create_async_engine(url.replace("postgresql://", "postgresql+psycopg://", 1), pool_size=10, max_overflow=20)
    holder: dict[str, Oim] = {}
    admin_password = platform_admin_password or config.platform_admin_password
    email = ApplicationEmail(SmtpTransport(config.mail_host, config.mail_port, start_tls=False, timeout_seconds=30) if config.mail_host else None,
                             config.email_from, config.email_from_name)
    def provider(settings: dict) -> OidcProviderSettings:
        # ``preset``: the earlier name of ``type``, still read.
        return OidcProviderSettings(type=settings.get("type") or settings.get("preset"), name=settings.get("name"),
                                    issuer=settings.get("issuer"), client_id=settings.get("clientId"), client_secret=settings.get("clientSecret"),
                                    trust_email=settings.get("trustEmail"))

    # docs:region sdk-wiring
    # As the Java backend's application.yml configures egradx-sdk.
    sdk = EgradxSdk(engine, SdkOptions(
        auth=AuthOptions(
            issuer=config.issuer, keystore_path=config.keystore_path, keystore_passphrase=config.key_passphrase,
            access_token_ttl_minutes=config.access_token_ttl_minutes, refresh_token_ttl_days=config.refresh_token_ttl_days,
            role_authorities_cache_ttl_seconds=config.role_cache_ttl_seconds, links=LinkSettings(base_url=config.public_url),
            platform=PlatformSettings(admin_password=admin_password) if admin_password else PlatformSettings(),
            # Sign-up and signing in with Google, Zoho or another provider (docs/auth/sign-in-methods.md).
            signup=SignupSettings(mode=config.signup_mode),
            oidc=OidcSettings(callback_base_url=config.oidc_callback_base_url,
                              providers={key: provider(value) for key, value in config.oidc_providers.items()}),
            profile=ProfileSettings(channels=("email", "sms", "whatsapp", "slack", "log")) if config.local else ProfileSettings(),
            on_organization_created=[organization_defaults(lambda: holder["oim"])]),
        audit={"actions": AUDIT_ACTIONS, "retention": AuditRetentionSettings(default_period=config.audit_retention)},
        notifications=NotificationsOptions(
            types=notification_types(), template_directories=[config.templates], dispatcher=DispatcherSettings(enabled=dispatcher),
            # Stored channel secrets are encrypted with the key passphrase, as Java's egradx.security.crypto.passphrase does both.
            secrets_passphrase=config.key_passphrase,
            built_in_channels=BuiltInChannels(email=email, log=config.local, webhook_allow_http=config.local)),
        # As the Java backend's egradx.files.*, with OrderFileAccess deciding for order attachments.
        files=FilesOptions(
            backend=config.files_backend, max_size=config.files_max_size, local=LocalSettings(root=config.files_root),
            s3=S3Settings(bucket=config.files_s3_bucket or None, endpoint=config.files_s3_endpoint or None, path_style=config.files_s3_path_style,
                          access_key=config.files_s3_access_key or None, secret_key=config.files_s3_secret_key or None),
            policies=[EgradxFileAccessPolicy("order", order_file_access(engine))]),
        logger=log))
    oim = Oim(engine, sdk.auth, sdk.auditor, sdk.notifications, DashboardCache(), log, list(config.low_stock_channels), sdk.files)
    holder["oim"] = oim
    await sdk.start()
    await seed(oim, config.seed_admin_password)
    # docs:end
    return RunningOim(oim, sdk)


async def serve(config: Config) -> None:
    telemetry = start_telemetry(config)
    await migrate_database(config)
    running = await create_oim(config)
    # A span per request, as Spring Boot gives the Java backend's: outermost, so the egradx spans are its children.
    app = OpenTelemetryMiddleware(oim_app(running.oim, config, prometheus=prometheus_text))
    # As server.forward-headers-strategy=native: the client's address from a proxy on the local network.
    server = uvicorn.Server(uvicorn.Config(app, loop="none", log_level="info", proxy_headers=True,
                                           forwarded_allow_ips=_LOCAL_NETWORKS))
    # IPv6 and IPv4 on one socket, as Tomcat and Node listen: a client on ::1 is recorded as Java writes it.
    sock = socket.create_server(("", config.port), family=socket.AF_INET6, dualstack_ipv6=True) if socket.has_dualstack_ipv6()         else socket.create_server(("0.0.0.0", config.port))
    log.info("OIM (Python) listening on http://localhost:%d%s", config.port, config.context_path)
    try:
        await server.serve(sockets=[sock])
    finally:
        await running.stop()
        telemetry.shutdown()


def selector_loop() -> asyncio.AbstractEventLoop:
    """psycopg's async mode needs a selector event loop, which Windows doesn't use by default."""
    return asyncio.SelectorEventLoop(selectors.SelectSelector()) if sys.platform == "win32" else asyncio.new_event_loop()


def main() -> None:
    # Every line carries [traceId,spanId,requestId], as the Java backend's logging.pattern.correlation gives its lines.
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s " + CORRELATION_FORMAT + "%(name)s - %(message)s")
    install_log_correlation()
    asyncio.run(serve(load_config()), loop_factory=selector_loop)


if __name__ == "__main__":
    main()
