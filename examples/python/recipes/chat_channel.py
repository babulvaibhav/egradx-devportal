"""A channel of your own."""

import httpx

from egradx.sdk import EgradxDeliveryResult


# docs:region custom-channel
class ChatChannel:
    """Messages posted to a chat service's incoming webhook. Give it to NotificationsOptions(channels=[ChatChannel()])
    and "chat" can be sent on like any other; the dispatcher calls send() for each address, after the commit, with
    retries."""

    channel = "chat"

    def validate_address(self, address: str) -> None:
        """Checked when a message is sent, before anything is queued."""
        if not address.startswith("https://"):
            raise ValueError("A chat address is the https URL of an incoming webhook")

    async def send(self, request) -> EgradxDeliveryResult:
        content = request.content
        text = f"{content.subject}\n{content.body}" if content.subject else content.body
        try:
            async with httpx.AsyncClient(timeout=15) as http:  # bound every call
                response = await http.post(request.address, json={"text": text},
                                           headers={"Idempotency-Key": request.delivery_id})  # delivery is at least once
        except httpx.HTTPError as error:
            return EgradxDeliveryResult.retryable(f"The chat service could not be reached: {error}")
        if response.is_success:
            return EgradxDeliveryResult.sent()
        if response.status_code == 429 or response.status_code >= 500:
            return EgradxDeliveryResult.retryable(f"The chat service answered {response.status_code}")  # tried again later
        return EgradxDeliveryResult.permanent(f"The chat service refused it: {response.status_code}")  # dead at once
# docs:end
