"""The application: the SDK wired in, migrations first, then this application's routes."""

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine

from egradx.sdk import AuthOptions, EgradxSdk, SdkOptions, migrate_async, migrate_egradx
from egradx.sdk import ApplicationEmail, BuiltInChannels, NotificationsOptions, SmtpTransport
from egradx.events import EgradxEvents, migrate_events
from egradx.sdk import EgradxLogShipper

from events import NoteStats
from notes import AUDIT_ACTIONS, note_routes
from notifications import NOTIFICATION_TYPES, TEMPLATE_DIRECTORY
from seeding import grant_note_permissions_to_new_organizations, seed


@dataclass
class AppConfig:
    database_url: str
    keystore_path: str
    key_passphrase: str
    demo_password: str
    smtp_host: str = "localhost"
    smtp_port: int = 1025


async def migrate_own_tables(database_url: str) -> None:
    """The application's own tables, with the SDK's runner (Flyway's history format, so any SDK can share the database)."""
    await migrate_async(database_url, Path(__file__).parent / "migrations", "notes_schema_history")


class Application:
    """The FastAPI application with the SDK in it. ``start`` and ``close`` run in its lifespan (or in tests)."""

    # docs:region main
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.engine = create_async_engine(config.database_url.replace("postgresql://", "postgresql+psycopg://", 1))
        self.sdk = EgradxSdk(self.engine, SdkOptions(
            auth=AuthOptions(
                issuer="https://notes.local",  # any stable identifier, stamped on every token
                keystore_path=config.keystore_path,
                keystore_passphrase=config.key_passphrase,
                on_organization_created=[grant_note_permissions_to_new_organizations(lambda: self.sdk)],
            ),
            audit={"actions": AUDIT_ACTIONS},
            notifications=NotificationsOptions(
                types=NOTIFICATION_TYPES,
                template_directories=[TEMPLATE_DIRECTORY],
                # The application's own mail server, for every organization that has not stored SMTP settings of its own.
                built_in_channels=BuiltInChannels(email=ApplicationEmail(
                    SmtpTransport(config.smtp_host, port=config.smtp_port, start_tls=False),
                    sender="no-reply@notes.local", sender_name="Notes")),
            ),
        ))
        # The transport comes from EGRADX_EVENTS_TRANSPORT (in-process unless set): the same code on a broker.
        self.events = EgradxEvents(self.engine, source="notes", handlers=[NoteStats()])
        # Every log line also leaves as an egradx.log.record.v1 event, with its request, person and organization.
        self.shipper = EgradxLogShipper(self.events.log_sink, service="notes")
        self.app = FastAPI(title="Notes", lifespan=self._lifespan)
        self.sdk.install(self.app)  # request id, the caller from the bearer token, the error envelope, the SDK's endpoints
        self.app.include_router(note_routes(self.sdk, self.events))  # your own routes

    async def start(self) -> None:
        # The SDK's tables first (sign-in before yours, so your tables can reference them), then yours.
        await migrate_egradx(self.config.database_url, application=migrate_own_tables)
        await migrate_events(self.config.database_url)
        await self.sdk.start()  # seeds the platform organization and its administrator; starts the background work
        await self.events.start()
        await self.shipper.start()
        await seed(self.sdk, self.config.demo_password)
    # docs:end

    async def close(self) -> None:
        await self.shipper.close()
        await self.events.close()
        await self.sdk.close()
        await self.engine.dispose()

    @asynccontextmanager
    async def _lifespan(self, _app: FastAPI):
        await self.start()
        yield
        await self.close()


logging.getLogger(__name__).addHandler(logging.NullHandler())
