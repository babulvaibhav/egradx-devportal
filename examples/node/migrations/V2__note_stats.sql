-- Kept by the note-stats event handler from notes.note.created.v1 events.
CREATE TABLE notes_note_stats (
    organization_id UUID   PRIMARY KEY REFERENCES egradx_organization (id),
    notes_created   BIGINT NOT NULL
);
