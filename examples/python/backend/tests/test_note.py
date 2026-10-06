"""The application over HTTP, as a client sees it, against a real PostgreSQL: TEST_DATABASE_URL, or the
notes_test database that docker compose creates. Signs in as the demo administrator common/seeding.py creates."""

import asyncio
import os
import tempfile
import time
import uuid
import socket

import httpx
import pytest
import pytest_asyncio
from aiosmtpd.controller import Controller

from notes.app import Application
from notes.common.seeding import DEMO_ADMIN
from notes.config import AppConfig

pytestmark = pytest.mark.asyncio(loop_scope="module")
DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/notes_test")


class Mailbox:
    """An SMTP server inside the test: the application's mail goes here, and the test reads it."""

    def __init__(self) -> None:
        self.messages: list[str] = []

    async def handle_DATA(self, server, session, envelope) -> str:
        self.messages.append(envelope.content.decode("utf-8", "replace"))
        return "250 OK"


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Client:
    """The application, called as the demo administrator unless told otherwise."""

    def __init__(self, http: httpx.AsyncClient, auth: dict[str, str], mailbox: Mailbox) -> None:
        self.http, self.auth, self.mailbox = http, auth, mailbox

    async def get(self, url: str, signed_in: bool = True) -> httpx.Response:
        return await self.http.get(url, headers=self.auth if signed_in else {})

    async def post(self, url: str, body: dict) -> httpx.Response:
        return await self.http.post(url, json=body, headers=self.auth)


# docs:region test
@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def client():
    mailbox = Mailbox()
    smtp = Controller(mailbox, hostname="127.0.0.1", port=free_port())
    smtp.start()
    application = Application(AppConfig(
        database_url=DATABASE_URL,
        keystore_path=tempfile.mkdtemp(prefix="notes-test-keys-"),
        key_passphrase="test-passphrase",
        demo_password="demo-password",
        smtp_host="127.0.0.1",
        smtp_port=smtp.port,
    ))
    await application.start()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application.app), base_url="http://test") as http:
        signed_in = await http.post("/egradx/auth/login", json={"username": DEMO_ADMIN, "password": "demo-password"})
        assert signed_in.status_code == 200, signed_in.text
        yield Client(http, {"Authorization": f"Bearer {signed_in.json()['accessToken']}"}, mailbox)
    await application.close()
    smtp.stop()


async def test_a_new_note_is_audited_and_announced(client: Client) -> None:
    before = (await client.get("/api/notes/stats")).json()["notesCreated"]
    title = f"Test note {uuid.uuid4()}"
    created = await client.post("/api/notes", {"title": title})
    assert created.status_code == 201, created.text
    note_id = created.json()["id"]

    # The audit record, written in the note's transaction.
    audit = (await client.get(f"/egradx/audit/events?action=notes.note.created&entityId={note_id}")).json()
    assert len(audit["items"]) == 1
    assert audit["items"][0]["after"]["title"] == title

    # The notice in the bell of everyone in the organization.
    inbox = (await client.get("/egradx/notifications?size=50")).json()
    assert title in [item["body"] for item in inbox["items"]]

    # The email to its author, sent after the commit by the SDK's dispatcher.
    await eventually(lambda: any(title in message for message in client.mailbox.messages))

    # The event, handled a moment after the commit.
    async def counted() -> bool:
        return (await client.get("/api/notes/stats")).json()["notesCreated"] == before + 1
    await eventually(counted)


async def test_refusals_come_in_the_sdks_envelope(client: Client) -> None:
    anonymous = await client.get("/api/notes", signed_in=False)
    assert (anonymous.status_code, anonymous.json()["error"]["code"]) == (401, "NOT_AUTHENTICATED")

    missing = await client.get(f"/api/notes/{uuid.uuid4()}")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "NOTE_NOT_FOUND")

    untitled = await client.post("/api/notes", {"title": " "})
    assert (untitled.status_code, untitled.json()["error"]["code"]) == (400, "NOTE_TITLE_REQUIRED")
# docs:end


async def eventually(check, timeout: float = 15) -> None:
    deadline = time.monotonic() + timeout
    while True:
        result = check()
        if asyncio.iscoroutine(result):
            result = await result
        if result:
            return
        if time.monotonic() > deadline:
            raise AssertionError("It did not happen within the time")
        await asyncio.sleep(0.2)
