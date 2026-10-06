package com.acme.notes.recipes;

import java.util.UUID;

import com.egradx.notification.EgradxAttachment;
import com.egradx.notification.EgradxChannel;
import com.egradx.notification.EgradxMessageContent;
import com.egradx.notification.messenger.EgradxMessageRequest;
import com.egradx.notification.messenger.EgradxMessenger;
import com.egradx.notification.messenger.EgradxSendReceipt;

/** Messages the sample feature does not send (the portal's recipes). */
public class Messages {

    private final EgradxMessenger messenger;

    public Messages(EgradxMessenger messenger) {
        this.messenger = messenger;
    }

    // docs:region bulk-send
    /**
     * Everyone in the organization, by email. One row now; the recipients are expanded in the background, 200 at a
     * time, each to their verified address (or the one they sign in with). At most 1000 by default.
     */
    public UUID announce(UUID organizationId, String subject, String body) {
        EgradxSendReceipt receipt = messenger.send(EgradxMessageRequest.on(EgradxChannel.EMAIL)
            .organization(organizationId)
            .content(null, EgradxMessageContent.of(subject, body))    // ready-made content: no template needed
            .toOrganizationMembers()
            .build());
        return receipt.bulkSendId();                                 // follow it: GET /egradx/notifications/admin/bulk-sends/{id}
    }
    // docs:end

    // docs:region send-to-address
    /** Someone who is not a user — a customer — with a file attached. */
    public void sendInvoice(UUID organizationId, String customerEmail, byte[] pdf) {
        messenger.send(EgradxMessageRequest.on(EgradxChannel.EMAIL)
            .organization(organizationId)                            // the organization's own mail settings apply
            .content("invoice", EgradxMessageContent.html("Your invoice", "<p>Your invoice is attached.</p>"))
            .toAddresses(customerEmail)
            .attach(EgradxAttachment.of("invoice.pdf", "application/pdf", pdf))
            .build());
    }
    // docs:end
}
