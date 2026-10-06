package com.acme.notes;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.acme.notes.NoteDtos.NoteRequest;
import com.acme.notes.NoteDtos.NoteResponse;
import com.acme.notes.NoteDtos.NoteStats;

// docs:region note-controller
/**
 * The notes endpoints. The SDK lets every request through to the application, so each endpoint states the permission
 * it needs; without one, an endpoint is public.
 */
@RestController
@RequestMapping("/api/notes")
class NoteController {

    private final NoteService notes;
    private final NoteStatsHandler stats;

    NoteController(NoteService notes, NoteStatsHandler stats) {
        this.notes = notes;
        this.stats = stats;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('note.read')")              // the caller's permissions, resolved on every request
    List<NoteResponse> list() {
        return notes.list();
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('note.read')")
    NoteResponse get(@PathVariable UUID id) {
        return notes.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('note.write')")
    NoteResponse create(@RequestBody NoteRequest request) {
        return notes.create(request);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('note.write')")
    NoteResponse update(@PathVariable UUID id, @RequestBody NoteRequest request) {
        return notes.update(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('note.write')")
    void delete(@PathVariable UUID id) {
        notes.delete(id);
    }

    /** How many notes the organization has: kept by an event handler, so it follows the notes a moment later. */
    @GetMapping("/stats")
    @PreAuthorize("hasAuthority('note.read')")
    NoteStats stats() {
        return stats.statsOfCaller();
    }
}
// docs:end
