import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { startApplication, type Application } from '../src/app.js';
import { DEMO_ADMIN } from '../src/common/setup.js';

// docs:region test
/**
 * The application over HTTP, as a client sees it, against a real PostgreSQL: TEST_DATABASE_URL, or the
 * notes_test database that docker compose creates. Signs in as the demo administrator setup.ts creates.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/notes_test';
let application: Application;
let server: Server;
let base: string;
let token: string;

/** An SMTP server inside the test: the application's mail goes here, and the test reads it. */
const mail: string[] = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, _session, done) {
    let message = '';
    stream.on('data', (chunk: Buffer) => (message += chunk.toString()));
    stream.on('end', () => {
      mail.push(message);
      done();
    });
  },
});

beforeAll(async () => {
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const smtpPort = (smtp.server.address() as AddressInfo).port;
  application = await startApplication({
    databaseUrl,
    keystorePath: mkdtempSync(path.join(tmpdir(), 'notes-test-keys-')),
    keyPassphrase: 'test-passphrase',
    demoPassword: 'demo-password',
    smtp: { host: '127.0.0.1', port: smtpPort },
    log: { info: () => {}, warn: () => {}, error: console.error },
  });
  server = application.app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const session = await call('POST', '/egradx/auth/login', undefined, { username: DEMO_ADMIN, password: 'demo-password' });
  token = session.body.accessToken;
}, 60_000);

afterAll(async () => {
  server?.close();
  await application?.close();
  smtp.close();
});

it('audits and announces a new note', async () => {
  const before = (await call('GET', '/api/notes/stats', token)).body.notesCreated;
  const title = `Test note ${crypto.randomUUID()}`;
  const created = await call('POST', '/api/notes', token, { title });
  expect(created.status).toBe(201);

  // The audit record, written in the note's transaction.
  const audit = await call('GET', `/egradx/audit/events?action=notes.note.created&entityId=${created.body.id}`, token);
  expect(audit.body.items).toHaveLength(1);
  expect(audit.body.items[0].after.title).toBe(title);

  // The notice in the bell of everyone in the organization.
  const inbox = await call('GET', '/egradx/notifications?size=50', token);
  expect(inbox.body.items.map((item: { body: string }) => item.body)).toContain(title);

  // The email to its author, sent after the commit by the SDK's dispatcher.
  await eventually(() => mail.some((message) => message.includes(title)));

  // The event, handled a moment after the commit.
  await eventually(async () => (await call('GET', '/api/notes/stats', token)).body.notesCreated === before + 1);
}, 30_000);

it("answers refusals in the SDK's envelope", async () => {
  const anonymous = await call('GET', '/api/notes');
  expect([anonymous.status, anonymous.body.error.code]).toEqual([401, 'NOT_AUTHENTICATED']);

  const missing = await call('GET', `/api/notes/${crypto.randomUUID()}`, token);
  expect([missing.status, missing.body.error.code]).toEqual([404, 'NOTE_NOT_FOUND']);

  const untitled = await call('POST', '/api/notes', token, { title: ' ' });
  expect([untitled.status, untitled.body.error.code]).toEqual([400, 'NOTE_TITLE_REQUIRED']);
});
// docs:end

async function call(method: string, url: string, bearer?: string, body?: unknown) {
  const response = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('It did not happen within the time');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
