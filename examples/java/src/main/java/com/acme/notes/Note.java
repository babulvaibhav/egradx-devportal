package com.acme.notes;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** A note: this application's own table, which belongs to an organization like everything it stores. */
@Entity
@Table(name = "notes_note")
public class Note {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(nullable = false)
    private String title;

    private String body;

    protected Note() {
    }

    public Note(UUID organizationId, String title, String body) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.title = title;
        this.body = body;
    }

    public void change(String title, String body) {
        this.title = title;
        this.body = body;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getTitle() {
        return title;
    }

    public String getBody() {
        return body;
    }
}
