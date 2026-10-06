import { bff } from '@/lib/egradx-server';

// docs:region web-proxy
/** Sends anyone without a session to /login (and back afterwards, with ?next=), before a page is rendered. */
export function proxy(request: Request) {
  return bff.guard(request, { signInPath: '/login' });
}

export const config = { matcher: ['/((?!bff/|_next/|favicon.ico).*)'] };
// docs:end
