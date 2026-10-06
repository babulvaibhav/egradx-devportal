package com.acme.notes.note.events;

import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.acme.notes.note.application.NoteDtos.NoteStats;
import com.egradx.auth.security.EgradxTenantContextAccessor;
import com.egradx.events.EgradxEvent;
import com.egradx.events.EgradxEventHandler;

// docs:region event-handler
/**
 * Counts each organization's notes from the events NoteService publishes. The SDK calls it once per event, after the
 * note committed, in a transaction of its own: a second delivery of the same event is dropped, and a failure is
 * tried again later. Another service could handle the same event the same way, over RabbitMQ or Kafka.
 */
@Component
public class NoteStatsHandler implements EgradxEventHandler {

    private final JdbcTemplate jdbc;
    private final EgradxTenantContextAccessor tenant;

    NoteStatsHandler(JdbcTemplate jdbc, EgradxTenantContextAccessor tenant) {
        this.jdbc = jdbc;
        this.tenant = tenant;
    }

    @Override
    public String type() {
        return "notes.note.created.v1";
    }

    @Override
    public String name() {
        return "note-stats";                      // stable: it is how the SDK remembers what this handler has seen
    }

    @Override
    public void handle(EgradxEvent event) {
        jdbc.update("""
            INSERT INTO notes_note_stats (organization_id, notes_created) VALUES (?, 1)
            ON CONFLICT (organization_id) DO UPDATE SET notes_created = notes_note_stats.notes_created + 1
            """, event.organizationId());
    }
    // docs:end

    @Transactional(readOnly = true)
    public NoteStats statsOfCaller() {
        UUID organizationId = tenant.current().orElseThrow().organizationId();
        Long created = jdbc.query("SELECT notes_created FROM notes_note_stats WHERE organization_id = ?",
            rows -> rows.next() ? rows.getLong(1) : 0L, organizationId);
        return new NoteStats(created == null ? 0 : created);
    }
}
