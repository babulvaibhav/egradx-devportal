import { createEgradxClient } from '@babulvaibhav/egradx-client';

// docs:region web-client
/**
 * The one SDK client of this application. It keeps the session (in localStorage, so other tabs follow it), adds the
 * access token and an X-Request-ID to every call, and renews the token when the API refuses it.
 */
export const egradx = createEgradxClient({
  baseUrl: window.location.origin, // the API and the SDK's endpoints, on the page's origin (vite.config.ts)
  onSessionEnded: (reason) => {
    // A refresh the server refused: signed out elsewhere, password changed, organization suspended.
    if (reason) sessionStorage.setItem('signedOutReason', reason.message);
  },
});
// docs:end
