import 'server-only';
import { createEgradxBff } from '@babulvaibhav/egradx-next';

// docs:region web-bff
/**
 * The backend-for-frontend: the browser talks to /bff/**, and this server forwards each call to the API with the
 * signed-in person's token, which it keeps in HttpOnly cookies no script can read. It renews tokens before they expire,
 * refuses cross-site writes, and streams the live notifications through.
 */
export const bff = createEgradxBff({
  apiUrl: process.env.EGRADX_API_URL ?? 'http://localhost:8080', // the API, as this server reaches it; never sent to the browser
  mountPath: '/bff',
});
// docs:end
