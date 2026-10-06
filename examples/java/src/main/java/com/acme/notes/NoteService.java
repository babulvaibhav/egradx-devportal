package com.acme.notes;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.acme.notes.NoteDtos.NoteRequest;
import com.acme.notes.NoteDtos.NoteResponse;
import com.egradx.audit.EgradxAuditor;
import com.egradx.auth.security.EgradxTenantContext;
import com.egradx.auth.security.EgradxTenantContextAccessor;
import com.egradx.core.audit.EgradxAuditEvent;
import com.egradx.core.exception.NotFoundException;
import com.egradx.core.exception.ValidationException;
import com.egradx.events.EgradxEventPublisher;
import com.egradx.notification.EgradxChannel;
import com.egradx.notification.delivery.EgradxChannelRegistry;
import com.egradx.notification.inbox.EgradxInAppMessage;
import com.egradx.notification.inbox.EgradxNotificationPublisher;
import com.egradx.notification.messenger.EgradxMessageRequest;
import com.egradx.notification.messenger.EgradxMessenger;

// docs:region note-service
@Service
class NoteService {

    /** The kind of message a new note is: the bell shows it, and (with email) it names the email template. */
    static final String NOTE_CREATED = "notes.note.created";

    private final NoteRepository repository;
    private final EgradxTenantContextAccessor tenant;
    private final EgradxAuditor auditor;
    private final EgradxNotificationPublisher inbox;
    private final EgradxMessenger messenger;
    private final EgradxChannelRegistry channels;
    private final EgradxEventPublisher events;

    NoteService(NoteRepository repository, EgradxTenantContextAccessor tenant, EgradxAuditor auditor,
            EgradxNotificationPublisher inbox, EgradxMessenger messenger, EgradxChannelRegistry channels,
            EgradxEventPublisher events) {
        this.repository = repository;
        this.tenant = tenant;
        this.auditor = auditor;
        this.inbox = inbox;
        this.messenger = messenger;
        this.channels = channels;
        this.events = events;
    }

    @Transactional(readOnly = true)
    List<NoteResponse> list() {
        return repository.findByOrganizationIdOrderByTitle(caller().organizationId()).stream().map(NoteResponse::from).toList();
    }

    @Transactional(readOnly = true)
    NoteResponse get(UUID id) {
        return NoteResponse.from(find(id));
    }

    @Transactional                                                 // one transaction: the note, its record, its notice
    NoteResponse create(NoteRequest request) {
        EgradxTenantContext caller = caller();                     // who is calling, in which organization
        UUID organizationId = caller.organizationId();
        Note saved = repository.save(new Note(organizationId, titleOf(request), request.body()));
        NoteResponse response = NoteResponse.from(saved);

        auditor.record(EgradxAuditEvent.of(NoteAuditActions.CREATED)  // the audit trail, committed with the note
            .organization(organizationId)
            .entity("note", saved.getId(), saved.getTitle())
            .after(response)
            .build());
        inbox.publishToOrganization(organizationId, new EgradxInAppMessage(   // the bell of everyone in the organization
            NOTE_CREATED, "New note", saved.getTitle(), Map.of("noteId", saved.getId().toString())));
        emailTheAuthor(caller, saved);
        events.publish("notes.note.created.v1", saved.getId().toString(), organizationId,  // sent after commit
            Map.of("noteId", saved.getId().toString(), "title", saved.getTitle()));
        return response;
    }
    // docs:end

    // docs:region note-update
    @Transactional
    NoteResponse update(UUID id, NoteRequest request) {
        Note note = find(id);
        NoteResponse before = NoteResponse.from(note);             // a copy, taken before the change
        note.change(titleOf(request), request.body());
        NoteResponse after = NoteResponse.from(note);
        auditor.record(EgradxAuditEvent.of(NoteAuditActions.UPDATED)
            .organization(note.getOrganizationId())
            .entity("note", note.getId(), note.getTitle())
            .before(before).after(after)                           // the record lists the fields that changed
            .build());
        return after;
    }
    // docs:end

    @Transactional
    void delete(UUID id) {
        Note note = find(id);
        auditor.record(EgradxAuditEvent.of(NoteAuditActions.DELETED)
            .organization(note.getOrganizationId())
            .entity("note", note.getId(), note.getTitle())
            .before(NoteResponse.from(note))
            .build());
        repository.delete(note);
    }

    // docs:region tenant-scope
    /** A note of the caller's organization; another organization's note does not exist, as far as they can tell. */
    private Note find(UUID id) {
        return repository.findByIdAndOrganizationId(id, caller().organizationId())
            .orElseThrow(() -> new NotFoundException("There is no note " + id, "NOTE_NOT_FOUND"));
    }

    private EgradxTenantContext caller() {
        return tenant.current().orElseThrow();   // the endpoints are protected, so there always is one
    }
    // docs:end

    // docs:region note-validation
    private static String titleOf(NoteRequest request) {
        if (request.title() == null || request.title().isBlank()) {
            throw new ValidationException("A note needs a title", "NOTE_TITLE_REQUIRED");   // 400, with this code
        }
        return request.title().trim();
    }
    // docs:end

    // docs:region note-email
    /**
     * Tells the author by email. The message is queued with the note, in its transaction, and sent after commit by the
     * SDK's dispatcher, with retries. When the organization has no email set up, there is nothing to queue.
     */
    private void emailTheAuthor(EgradxTenantContext caller, Note note) {
        boolean available = channels.find(EgradxChannel.EMAIL)
            .map(email -> email.unavailableFor(caller.organizationId()).isEmpty())
            .orElse(false);
        if (available) {
            messenger.send(EgradxMessageRequest.on(EgradxChannel.EMAIL)
                .organization(caller.organizationId())
                .template(NOTE_CREATED, Map.of("title", note.getTitle()))
                .toUsers(caller.userId())                          // their verified address, or the one they sign in with
                .build());
        }
    }
    // docs:end
}
