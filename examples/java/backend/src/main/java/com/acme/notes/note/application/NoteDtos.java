package com.acme.notes.note.application;

import java.util.UUID;

import com.acme.notes.note.domain.Note;

/** What the notes endpoints take and return. */
public final class NoteDtos {

    private NoteDtos() {
    }

    public record NoteRequest(String title, String body) {
    }

    public record NoteResponse(UUID id, UUID organizationId, String title, String body) {

        public static NoteResponse from(Note note) {
            return new NoteResponse(note.getId(), note.getOrganizationId(), note.getTitle(), note.getBody());
        }
    }

    public record NoteStats(long notesCreated) {
    }
}
