'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { EgradxApiError } from '@babulvaibhav/egradx-client';
import { Can, useAuth } from '@babulvaibhav/egradx-react';
import { Bell } from './Bell';
import { createNote, listNotes, type Note } from './notes-api';

/** The notes of the signed-in person's organization, and a form to add one for those who may. */
export function Notes({ onSignedOut }: { onSignedOut: () => void }) {
  const { session, logout } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listNotes().then(setNotes, (e: Error) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createNote(title);
      setTitle('');
      reload();
    } catch (e) {
      setError(e instanceof EgradxApiError && e.code === 'NOTE_TITLE_REQUIRED' ? 'Give the note a title.' : (e as Error).message);
    }
  }

  return (
    <main className="card">
      <header className="top">
        <div>
          <h1>Notes</h1>
          <p className="muted">
            {session?.user?.displayName ?? session?.user?.username} · {session?.organizationName}
          </p>
        </div>
        <div className="actions">
          {/* A new note anywhere in the organization arrives here live, and the list follows. */}
          <Bell onNotification={reload} />
          <button className="secondary" onClick={() => void logout().then(onSignedOut)}>
            Sign out
          </button>
        </div>
      </header>
      {/* Shown to those whose role holds note.write; the server checks it anyway. */}
      <Can authority="note.write">
        <form className="inline" onSubmit={(event) => void add(event)}>
          <input placeholder="A new note" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit">Add</button>
        </form>
      </Can>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <ul className="notes">
        {notes.map((note) => (
          <li key={note.id}>{note.title}</li>
        ))}
        {notes.length === 0 ? <li className="muted">No notes yet.</li> : null}
      </ul>
    </main>
  );
}
