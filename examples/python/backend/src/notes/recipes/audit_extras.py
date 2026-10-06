"""Audit records the sample feature does not write."""

from egradx.sdk import AuditQuery, EgradxAuditEvent, EgradxSdk, publish_audit_event


# docs:region record-a-refusal
async def export_refused(sdk: EgradxSdk, organization_id: str, note_id: str) -> None:
    """A refused attempt: written on its own, so it stays even when the work around it rolls back."""
    await sdk.auditor.record(EgradxAuditEvent.of("notes.note.export_refused")
                             .organization(organization_id)
                             .entity("note", note_id)
                             .denied("EXPORT_LIMIT_REACHED")  # outcome DENIED, with its reason
                             .detail("limit", 100)
                             .build())
# docs:end


# docs:region publish-from-a-library
async def from_a_library(organization_id: str, report_id: str) -> None:
    """In a library that must not depend on the audit package: the application's auditor records it, by the same rules."""
    await publish_audit_event(EgradxAuditEvent.of("reports.report.generated")
                              .organization(organization_id)
                              .entity("report", report_id)
                              .build())
# docs:end


# docs:region read-the-trail
async def history(sdk: EgradxSdk, organization_id: str, note_id: str) -> None:
    """One note's history, newest first: the same records /egradx/audit/timeline answers."""
    page = await sdk.auditor.search(AuditQuery(organization_id=organization_id, entity_type="note", entity_id=note_id), None, 20)
    for record in page.items:  # page.next_cursor for the next page
        print(record.occurred_at, record.action, record.changed_fields)
# docs:end
