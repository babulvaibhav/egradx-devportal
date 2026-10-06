// Messages the sample feature does not send (the portal's recipes).
import { EgradxMessageContent, EgradxMessageRequest, attachment, type Egradx } from '@babulvaibhav/egradx-sdk';

// docs:region bulk-send
/**
 * Everyone in the organization, by email. One row now; the recipients are expanded in the background, 200 at a time,
 * each to their verified address (or the one they sign in with). At most 1000 by default.
 */
export async function announce(egradx: Egradx, organizationId: string, subject: string, body: string): Promise<string | null> {
  const receipt = await egradx.notifications.messenger.send(EgradxMessageRequest.on('email')
    .organization(organizationId)
    .content(null, EgradxMessageContent.of(subject, body)) // ready-made content: no template needed
    .toOrganizationMembers()
    .build());
  return receipt.bulkSendId; // follow it: GET /egradx/notifications/admin/bulk-sends/{id}
}
// docs:end

// docs:region send-to-address
/** Someone who is not a user — a customer — with a file attached. */
export async function sendInvoice(egradx: Egradx, organizationId: string, customerEmail: string, pdf: Uint8Array): Promise<void> {
  await egradx.notifications.messenger.send(EgradxMessageRequest.on('email')
    .organization(organizationId) // the organization's own mail settings apply
    .content('invoice', EgradxMessageContent.html('Your invoice', '<p>Your invoice is attached.</p>'))
    .toAddresses(customerEmail)
    .attach(attachment('invoice.pdf', 'application/pdf', pdf))
    .build());
}
// docs:end
