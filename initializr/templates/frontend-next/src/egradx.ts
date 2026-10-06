import { createEgradxClient } from '@babulvaibhav/egradx-client';

// docs:region web-client-next
/**
 * The browser's SDK client. With tokens: 'server' it holds no tokens at all: the backend-for-frontend at /bff keeps
 * them in HttpOnly cookies, and the client keeps only who is signed in.
 */
export const egradx = createEgradxClient({
  baseUrl: '/bff',
  tokens: 'server',
  onSessionEnded: (reason) => {
    // A refresh the server refused: signed out elsewhere, password changed, organization suspended.
    if (reason) sessionStorage.setItem('signedOutReason', reason.message);
  },
});
// docs:end
