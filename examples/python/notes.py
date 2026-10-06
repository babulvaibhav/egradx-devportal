"""The notes endpoints: this application's own business, on the SDK."""

import uuid

from fastapi import APIRouter, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from egradx.sdk import (
    EgradxAuditActionDefinition,
    EgradxAuditEvent,
    EgradxInAppMessage,
    EgradxMessageRequest,
    EgradxSdk,
    NotFoundException,
    ValidationException,
    egradx_transaction,
)
from egradx.sdk.fastapi import require_authority, signed_in_user
from egradx.events import EgradxEvents

# docs:region audit-catalog
CREATED = "notes.note.created"
UPDATED = "notes.note.updated"
DELETED = "notes.note.deleted"

# This application's audit actions, with the words the audit screen shows for them.
AUDIT_ACTIONS = [
    EgradxAuditActionDefinition(CREATED, "Created a note", "note"),
    EgradxAuditActionDefinition(UPDATED, "Changed a note", "note"),
    EgradxAuditActionDefinition(DELETED, "Deleted a note", "note"),
]
# docs:end

# The kind of message a new note is: the bell shows it, and it names the email template.
NOTE_CREATED = "notes.note.created"


class NoteRequest(BaseModel):
    title: str = ""
    body: str | None = None


# docs:region note-validation
def title_of(request: NoteRequest) -> str:
    if not request.title.strip():
        raise ValidationException("A note needs a title", "NOTE_TITLE_REQUIRED")  # 400, with this code
    return request.title.strip()
# docs:end


# docs:region tenant-scope
async def find(connection: AsyncConnection, note_id: uuid.UUID) -> dict:
    """A note of the caller's organization; another organization's note does not exist, as far as they can tell."""
    row = (await connection.execute(
        text("SELECT id::text, organization_id::text AS \"organizationId\", title, body FROM notes_note "
             "WHERE id = :id AND organization_id = CAST(:organization AS uuid)"),
        {"id": note_id, "organization": signed_in_user().organization_id})).mappings().first()
    if row is None:
        raise NotFoundException(f"There is no note {note_id}", "NOTE_NOT_FOUND")
    return dict(row)
# docs:end


# docs:region note-routes
def note_routes(sdk: EgradxSdk, events: EgradxEvents) -> APIRouter:
    router = APIRouter()
    # Every route states the permission it needs; the caller's permissions are resolved on each request.

    @router.get("/api/notes", dependencies=[require_authority("note.read")])
    async def list_notes() -> list[dict]:
        async with egradx_transaction(sdk.engine) as connection:
            rows = await connection.execute(
                text("SELECT id::text, organization_id::text AS \"organizationId\", title, body FROM notes_note "
                     "WHERE organization_id = CAST(:organization AS uuid) ORDER BY title"),
                {"organization": signed_in_user().organization_id})
            return [dict(row) for row in rows.mappings()]

    @router.post("/api/notes", status_code=201, dependencies=[require_authority("note.write")])
    async def create(request: NoteRequest) -> dict:
        caller = signed_in_user()                                     # who is calling, in which organization
        note = {"id": str(uuid.uuid4()), "organizationId": caller.organization_id, "title": title_of(request), "body": request.body}
        async with egradx_transaction(sdk.engine) as connection:     # one transaction: the note, its record, its notice
            await connection.execute(text("INSERT INTO notes_note (id, organization_id, title, body) "
                                          "VALUES (CAST(:id AS uuid), CAST(:organizationId AS uuid), :title, :body)"), note)
            await sdk.auditor.record(EgradxAuditEvent.of(CREATED)    # the audit trail, committed with the note
                                     .organization(caller.organization_id).entity("note", note["id"], note["title"])
                                     .after(note).build())
            await sdk.notifications.publish_to_organization(          # the bell of everyone in the organization
                caller.organization_id,
                EgradxInAppMessage("New note", note["title"], notification_key=NOTE_CREATED, metadata={"noteId": note["id"]}))
            await email_the_author(sdk, caller.organization_id, caller.user_id, note["title"])
            await events.publish("notes.note.created.v1", {"noteId": note["id"], "title": note["title"]},  # sent after commit
                                 subject=note["id"], organization_id=caller.organization_id)
        return note
    # docs:end

    @router.get("/api/notes/stats", dependencies=[require_authority("note.read")])
    async def stats() -> dict:
        """How many notes the organization has created: kept by an event handler, so it follows a moment later."""
        async with egradx_transaction(sdk.engine) as connection:
            created = (await connection.execute(
                text("SELECT notes_created FROM notes_note_stats WHERE organization_id = CAST(:organization AS uuid)"),
                {"organization": signed_in_user().organization_id})).scalar()
        return {"notesCreated": created or 0}

    @router.get("/api/notes/{id}", dependencies=[require_authority("note.read")])
    async def get(id: uuid.UUID) -> dict:
        async with egradx_transaction(sdk.engine) as connection:
            return await find(connection, id)

    # docs:region note-update
    @router.put("/api/notes/{id}", dependencies=[require_authority("note.write")])
    async def update(id: uuid.UUID, request: NoteRequest) -> dict:
        async with egradx_transaction(sdk.engine) as connection:
            before = await find(connection, id)                  # a copy, taken before the change
            after = {**before, "title": title_of(request), "body": request.body}
            await connection.execute(text("UPDATE notes_note SET title = :title, body = :body WHERE id = CAST(:id AS uuid)"), after)
            await sdk.auditor.record(EgradxAuditEvent.of(UPDATED)
                                     .organization(after["organizationId"]).entity("note", after["id"], after["title"])
                                     .before(before).after(after)     # the record lists the fields that changed
                                     .build())
        return after
    # docs:end

    @router.delete("/api/notes/{id}", status_code=204, dependencies=[require_authority("note.write")])
    async def delete(id: uuid.UUID) -> Response:
        async with egradx_transaction(sdk.engine) as connection:
            note = await find(connection, id)
            await sdk.auditor.record(EgradxAuditEvent.of(DELETED)
                                     .organization(note["organizationId"]).entity("note", note["id"], note["title"])
                                     .before(note).build())
            await connection.execute(text("DELETE FROM notes_note WHERE id = CAST(:id AS uuid)"), note)
        return Response(status_code=204)

    return router


# docs:region note-email
async def email_the_author(sdk: EgradxSdk, organization_id: str, user_id: str, title: str) -> None:
    """Tells the author by email. The message is queued with the note, in its transaction, and sent after commit by the
    SDK's dispatcher, with retries. When the organization has no email set up, there is nothing to queue."""
    email = sdk.notifications.channels.find("email")
    if email is None or await email.unavailable_for(organization_id):
        return
    await sdk.notifications.messenger.send(EgradxMessageRequest.on("email")
                                           .organization(organization_id)
                                           .template(NOTE_CREATED, {"title": title})
                                           .to_users(user_id)  # their verified address, or the one they sign in with
                                           .build())
# docs:end
