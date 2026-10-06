package com.acme.notes;

import java.util.List;

import org.springframework.stereotype.Component;

import com.egradx.core.audit.EgradxAuditActionCatalog;

// docs:region audit-catalog
/** This application's audit actions, with the words the audit screen shows for them. */
@Component
class NoteAuditActions implements EgradxAuditActionCatalog {

    static final String CREATED = "notes.note.created";
    static final String UPDATED = "notes.note.updated";
    static final String DELETED = "notes.note.deleted";

    @Override
    public List<Definition> actions() {
        return List.of(
            new Definition(CREATED, "Created a note", "note"),
            new Definition(UPDATED, "Changed a note", "note"),
            new Definition(DELETED, "Deleted a note", "note"));
    }
}
// docs:end
