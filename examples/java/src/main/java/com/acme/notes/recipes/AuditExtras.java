package com.acme.notes.recipes;

import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;

import com.egradx.audit.EgradxAuditor;
import com.egradx.audit.query.EgradxAuditPage;
import com.egradx.audit.query.EgradxAuditQueries;
import com.egradx.audit.query.EgradxAuditQuery;
import com.egradx.audit.query.EgradxAuditRecord;
import com.egradx.core.audit.EgradxAuditEvent;

/** Audit records the sample feature does not write (the portal's recipes). */
public class AuditExtras {

    private final EgradxAuditor auditor;
    private final EgradxAuditQueries queries;
    private final ApplicationEventPublisher events;

    public AuditExtras(EgradxAuditor auditor, EgradxAuditQueries queries, ApplicationEventPublisher events) {
        this.auditor = auditor;
        this.queries = queries;
        this.events = events;
    }

    // docs:region record-a-refusal
    /** A refused attempt: written on its own, so it stays even when the work around it rolls back. */
    public void exportRefused(UUID organizationId, UUID noteId) {
        auditor.record(EgradxAuditEvent.of("notes.note.export_refused")
            .organization(organizationId)
            .entity("note", noteId)
            .denied("EXPORT_LIMIT_REACHED")                          // outcome DENIED, with its reason
            .detail("limit", 100)
            .build());
    }
    // docs:end

    // docs:region publish-from-a-library
    /** In a library that must not depend on egradx-audit: the application's auditor records it, by the same rules. */
    public void fromALibrary(UUID organizationId, String reportId) {
        events.publishEvent(EgradxAuditEvent.of("reports.report.generated")
            .organization(organizationId)
            .entity("report", reportId)
            .build());
    }
    // docs:end

    // docs:region read-the-trail
    /** One note's history, newest first: the same records /egradx/audit/timeline answers. */
    public void history(UUID organizationId, UUID noteId) {
        EgradxAuditPage page = queries.search(EgradxAuditQuery.organization(organizationId)
            .entityType("note")
            .entityId(noteId.toString())
            .build(), null, 20);                                     // a cursor from page.nextCursor() for the next page
        for (EgradxAuditRecord record : page.items()) {
            System.out.println(record.occurredAt() + " " + record.action() + " " + record.changedFields());
        }
    }
    // docs:end
}
