import { bff } from '@/lib/egradx-server';

// Every browser call to the API goes through here (src/egradx-server.ts).
export const dynamic = 'force-dynamic';
export const { GET, HEAD, POST, PUT, PATCH, DELETE } = bff.routeHandlers;
