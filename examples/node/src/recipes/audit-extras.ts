// Audit records the sample feature does not write (the portal's recipes).
import { EgradxAuditEvent, publishAuditEvent, type Egradx } from '@babulvaibhav/egradx-sdk';

// docs:region record-a-refusal
/** A refused attempt: written on its own, so it stays even when the work around it rolls back. */
export async function exportRefused(egradx: Egradx, organizationId: string, noteId: string): Promise<void> {
  await egradx.auditor.record(EgradxAuditEvent.of('notes.note.export_refused')
    .organization(organizationId)
    .entity('note', noteId)
    .denied('EXPORT_LIMIT_REACHED') // outcome DENIED, with its reason
    .detail('limit', 100)
    .build());
}
// docs:end

// docs:region publish-from-a-library
/** In a library that must not depend on the audit package: the application's auditor records it, by the same rules. */
export async function fromALibrary(organizationId: string, reportId: string): Promise<void> {
  await publishAuditEvent(EgradxAuditEvent.of('reports.report.generated')
    .organization(organizationId)
    .entity('report', reportId)
    .build());
}
// docs:end

// docs:region read-the-trail
/** One note's history, newest first: the same records /egradx/audit/timeline answers. */
export async function history(egradx: Egradx, organizationId: string, noteId: string): Promise<void> {
  const page = await egradx.auditor.search({ organizationId, entityType: 'note', entityId: noteId }, null, 20);
  for (const record of page.items) { // page.nextCursor for the next page
    console.log(record.occurredAt, record.action, record.changedFields);
  }
}
// docs:end
