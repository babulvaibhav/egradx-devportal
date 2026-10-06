"""This application's audit actions, with the words the audit screen shows for them."""

from egradx.sdk import EgradxAuditActionDefinition

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
