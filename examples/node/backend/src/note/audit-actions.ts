import type { EgradxAuditActionDefinition } from '@babulvaibhav/egradx-sdk';

// docs:region audit-catalog
/** This application's audit actions, with the words the audit screen shows for them. */
export const AuditActions = {
  CREATED: 'notes.note.created',
  UPDATED: 'notes.note.updated',
  DELETED: 'notes.note.deleted',
} as const;

export const AUDIT_ACTIONS: EgradxAuditActionDefinition[] = [
  { action: AuditActions.CREATED, description: 'Created a note', entityType: 'note' },
  { action: AuditActions.UPDATED, description: 'Changed a note', entityType: 'note' },
  { action: AuditActions.DELETED, description: 'Deleted a note', entityType: 'note' },
];
// docs:end
