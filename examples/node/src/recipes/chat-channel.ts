import { EgradxDeliveryResult, type EgradxNotificationChannel } from '@babulvaibhav/egradx-sdk';

// docs:region custom-channel
/**
 * A channel of your own: messages posted to a chat service's incoming webhook. Give it to
 * createEgradx({ notifications: { channels: [chatChannel] } }) and 'chat' can be sent on like any other; the
 * dispatcher calls send() for each address, after the commit, with retries.
 */
export const chatChannel: EgradxNotificationChannel = {
  channel: 'chat',

  /** Checked when a message is sent, before anything is queued. */
  validateAddress(address) {
    if (!address.startsWith('https://')) {
      throw new Error('A chat address is the https URL of an incoming webhook');
    }
  },

  async send(request) {
    const { subject, body } = request.content;
    try {
      const response = await fetch(request.address, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.deliveryId }, // at least once
        body: JSON.stringify({ text: subject ? `${subject}\n${body}` : body }),
        signal: AbortSignal.timeout(15_000), // bound every call
      });
      if (response.ok) {
        return EgradxDeliveryResult.sent();
      }
      return response.status === 429 || response.status >= 500
        ? EgradxDeliveryResult.retryable(`The chat service answered ${response.status}`) // tried again later
        : EgradxDeliveryResult.permanent(`The chat service refused it: ${response.status}`); // dead at once
    } catch (error) {
      return EgradxDeliveryResult.retryable(`The chat service could not be reached: ${(error as Error).message}`);
    }
  },
};
// docs:end
