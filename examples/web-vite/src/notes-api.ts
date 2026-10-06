import { errorFromResponse } from '@babulvaibhav/egradx-client';
import { egradx } from './egradx';

export interface Note {
  id: string;
  organizationId: string;
  title: string;
  body: string | null;
}

// docs:region web-own-api
/**
 * This application's own API, through the SDK client's fetch: the access token, an X-Request-ID, and one renewal of an
 * expired token come with every call. A refusal arrives as an EgradxApiError whose `code` the screens switch on.
 */
export async function listNotes(): Promise<Note[]> {
  const response = await egradx.fetch('/api/notes');
  if (!response.ok) throw await errorFromResponse(response);
  return response.json();
}

export async function createNote(title: string): Promise<Note> {
  const response = await egradx.fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw await errorFromResponse(response);
  return response.json();
}
// docs:end
