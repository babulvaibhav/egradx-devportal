"""Messages the sample feature does not send."""

from egradx.sdk import EgradxMessageContent, EgradxMessageRequest, EgradxSdk, attachment


# docs:region bulk-send
async def announce(sdk: EgradxSdk, organization_id: str, subject: str, body: str) -> str | None:
    """Everyone in the organization, by email. One row now; the recipients are expanded in the background, 200 at a
    time, each to their verified address (or the one they sign in with). At most 1000 by default."""
    receipt = await sdk.notifications.messenger.send(EgradxMessageRequest.on("email")
                                                     .organization(organization_id)
                                                     .content(None, EgradxMessageContent.of(subject, body))  # no template needed
                                                     .to_organization_members()
                                                     .build())
    return receipt.bulk_send_id  # follow it: GET /egradx/notifications/admin/bulk-sends/{id}
# docs:end


# docs:region send-to-address
async def send_invoice(sdk: EgradxSdk, organization_id: str, customer_email: str, pdf: bytes) -> None:
    """Someone who is not a user — a customer — with a file attached."""
    await sdk.notifications.messenger.send(EgradxMessageRequest.on("email")
                                           .organization(organization_id)  # the organization's own mail settings apply
                                           .content("invoice", EgradxMessageContent.html("Your invoice", "<p>Your invoice is attached.</p>"))
                                           .to_addresses(customer_email)
                                           .attach(attachment("invoice.pdf", "application/pdf", pdf))
                                           .build())
# docs:end
