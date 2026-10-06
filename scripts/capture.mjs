// Records what the example applications answer, for the pages that show it. Runs examples/java, node and python, each
// against a fresh database with an SMTP server of this script's own, walks every scenario below against each, checks
// every answer against what the pages say and the languages against each other, and writes
// content/results/<scenario>.json. A result on a page is never typed: it is captured here, from the code the page shows.
//
//   node scripts/capture.mjs                   every language, every scenario
//   node scripts/capture.mjs java node         these languages (the others' recorded answers are kept)
//
// Needs a local PostgreSQL (EGRADX_TEST_PG_HOST/_PORT/_USER/_PASSWORD, default localhost:5432 postgres/postgres) and the
// examples ready (examples/README.md): java packaged, node installed and generated, python synced.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.join(app, 'examples');
const windows = process.platform === 'win32';
const env = (name, fallback) => process.env[`EGRADX_TEST_PG_${name}`] || fallback;
const server = { host: env('HOST', 'localhost'), port: Number(env('PORT', '5432')), user: env('USER', 'postgres'), password: env('PASSWORD', 'postgres') };

const ADMIN = { username: 'ada@example.com', password: 'demo-password' };
const AREA = 'notes';

const LANGUAGES = {
  java: {
    port: 8091,
    command: () => {
      const target = path.join(examples, 'java', 'backend', 'target');
      const jar = readdirSync(target).find((name) => name.endsWith('.jar') && !name.endsWith('-plain.jar'));
      return ['java', ['-jar', path.join(target, jar)], path.join(examples, 'java', 'backend')];
    },
    env: (database) => ({ DB_URL: `jdbc:postgresql://${server.host}:${server.port}/${database}`, DB_USER: server.user, DB_PASSWORD: server.password }),
  },
  node: {
    port: 8092,
    command: () => [process.execPath, [path.join(examples, 'node', 'backend', 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/main.ts'], path.join(examples, 'node', 'backend')],
    env: (database) => ({ DATABASE_URL: url(database) }),
  },
  python: {
    port: 8093,
    command: () => [path.join(examples, 'python', 'backend', '.venv', windows ? 'Scripts/python.exe' : 'bin/python'), ['-m', 'notes'], path.join(examples, 'python', 'backend')],
    env: (database) => ({ DATABASE_URL: url(database), PYTHONUTF8: '1' }),
  },
};

const url = (database) => `postgresql://${encodeURIComponent(server.user)}:${encodeURIComponent(server.password)}@${server.host}:${server.port}/${database}`;

async function freshDatabase(name) {
  const client = new pg.Client({ ...server, database: 'postgres' });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}

/** An SMTP server the applications send to: every message, parsed. */
async function mailSink() {
  const messages = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, _session, done) {
      simpleParser(stream).then((parsed) => {
        messages.push(parsed);
        done();
      }, done);
    },
  });
  await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  return { port: smtp.server.address().port, messages, close: () => smtp.close() };
}

function start(language, database, smtpPort) {
  const spec = LANGUAGES[language];
  const [command, args, cwd] = spec.command();
  const keys = mkdtempSync(path.join(tmpdir(), `egradx-${language}-keys-`));
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...spec.env(database),
      PORT: String(spec.port),
      EGRADX_KEY_PASSPHRASE: 'devportal-capture',
      EGRADX_KEYSTORE_PATH: path.join(keys, 'keys'),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      // Traces stay in the process: there is no Jaeger here, and the trace ids still reach audit records.
      OTLP_TRACING_ENDPOINT: 'http://127.0.0.1:9/v1/traces',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  return { child, base: `http://localhost:${spec.port}`, output };
}

async function call(base, method, route, { token, body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

async function waitUntilUp(running, language) {
  for (let i = 0; i < 180; i++) {
    if (running.child.exitCode !== null) break;
    try {
      // Any answer below 500 means it is listening; then the demo organization must exist (seeded after start).
      if ((await call(running.base, 'GET', '/egradx/auth/me')).status < 500) {
        const signedIn = await call(running.base, 'POST', '/egradx/auth/login', { body: ADMIN });
        if (signedIn.status === 200) return signedIn.body.accessToken;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The ${language} example did not start:\n${running.output.join('').slice(-4000)}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function eventually(check, what, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what} did not happen within ${timeoutMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Tokens are secrets even in a recording: their first characters only. */
function redact(body) {
  if (!body || typeof body !== 'object') return body;
  const copy = { ...body };
  for (const key of ['accessToken', 'refreshToken']) {
    if (typeof copy[key] === 'string') copy[key] = `${copy[key].slice(0, 16)}… (redacted)`;
  }
  return copy;
}

/**
 * Each scenario walks one page's steps against a running example and returns them: what was sent, what came back,
 * and the step's title as the page says it. `ctx` = { base, token, platformToken, mail, language }.
 */
const SCENARIOS = {
  async 'first-endpoint'(ctx) {
    const steps = [];
    const note = { title: 'Call the supplier' };
    const anonymous = await call(ctx.base, 'POST', '/api/notes', { body: note });
    expect(anonymous.status === 401 && anonymous.body?.error?.code === 'NOT_AUTHENTICATED', `without a token: ${anonymous.status} ${JSON.stringify(anonymous.body)}`);
    steps.push({ name: 'without-token', title: 'Without a token', request: { method: 'POST', path: '/api/notes', body: note }, response: anonymous });

    const refused = await call(ctx.base, 'POST', '/api/notes', { token: ctx.platformToken, body: note });
    expect(refused.status === 403 && refused.body?.error?.code === 'ACCESS_DENIED', `without the permission: ${refused.status} ${JSON.stringify(refused.body)}`);
    steps.push({ name: 'without-permission', title: 'Signed in, without the permission', request: { method: 'POST', path: '/api/notes', as: 'platform-admin (no note.write)', body: note }, response: refused });

    const created = await call(ctx.base, 'POST', '/api/notes', { token: ctx.token, body: note });
    expect(created.status === 201 && created.body?.title === note.title, `creating a note: ${created.status} ${JSON.stringify(created.body)}`);
    steps.push({ name: 'created', title: 'With the permission', request: { method: 'POST', path: '/api/notes', as: `${ADMIN.username} (Admin of Demo, holds note.write)`, body: note }, response: created });

    const audit = await call(ctx.base, 'GET', `/egradx/audit/events?action=${AREA}.note.created&entityId=${created.body.id}`, { token: ctx.token });
    const item = audit.body?.items?.[0];
    expect(audit.status === 200 && item?.outcome === 'SUCCESS' && item.actor?.name === 'Ada Admin' && item.organizationName === 'Demo',
      `the audit record: ${audit.status} ${JSON.stringify(audit.body)}`);
    steps.push({ name: 'audit-record', title: 'The audit record it wrote', request: { method: 'GET', path: `/egradx/audit/events?action=${AREA}.note.created`, as: ADMIN.username }, response: { status: audit.status, body: item } });
    ctx.noteId = created.body.id;
    return steps;
  },

  async errors(ctx) {
    const steps = [];
    const missing = await call(ctx.base, 'GET', '/api/notes/00000000-0000-4000-8000-000000000000', { token: ctx.token });
    expect(missing.status === 404 && missing.body?.error?.code === 'NOTE_NOT_FOUND', `not found: ${missing.status} ${JSON.stringify(missing.body)}`);
    steps.push({ name: 'not-found', title: "Another organization's note, or none: the application's own code", request: { method: 'GET', path: '/api/notes/00000000-0000-4000-8000-000000000000' }, response: missing });

    const untitled = await call(ctx.base, 'POST', '/api/notes', { token: ctx.token, body: { title: '' } });
    expect(untitled.status === 400 && untitled.body?.error?.code === 'NOTE_TITLE_REQUIRED', `validation: ${untitled.status} ${JSON.stringify(untitled.body)}`);
    steps.push({ name: 'validation', title: 'A rule of the application broken', request: { method: 'POST', path: '/api/notes', body: { title: '' } }, response: untitled });

    const malformed = await call(ctx.base, 'GET', '/api/notes/not-an-id', { token: ctx.token });
    expect(malformed.status === 400 && malformed.body?.error?.code === 'INVALID_REQUEST', `malformed id: ${malformed.status} ${JSON.stringify(malformed.body)}`);
    steps.push({ name: 'malformed', title: 'A malformed request', request: { method: 'GET', path: '/api/notes/not-an-id' }, response: malformed });

    const nowhere = await call(ctx.base, 'GET', '/api/nothing-here', { token: ctx.token });
    expect(nowhere.status === 404 && nowhere.body?.error?.code === 'NOT_FOUND', `no endpoint: ${nowhere.status} ${JSON.stringify(nowhere.body)}`);
    steps.push({ name: 'no-endpoint', title: 'No such endpoint', request: { method: 'GET', path: '/api/nothing-here' }, response: nowhere });

    const refusedToken = await call(ctx.base, 'GET', '/api/notes', { token: 'not-a-token' });
    expect(refusedToken.status === 401 && refusedToken.body?.error?.code === 'SESSION_EXPIRED', `refused token: ${refusedToken.status} ${JSON.stringify(refusedToken.body)}`);
    steps.push({ name: 'refused-token', title: 'A token sent and refused: renew it, or sign in again', request: { method: 'GET', path: '/api/notes', as: 'Bearer not-a-token' }, response: refusedToken });

    const wrong = await call(ctx.base, 'POST', '/egradx/auth/login', { body: { username: ADMIN.username, password: 'not-the-password' } });
    expect(wrong.status === 401 && wrong.body?.error?.code === 'AUTH_INVALID_CREDENTIALS', `wrong password: ${wrong.status} ${JSON.stringify(wrong.body)}`);
    steps.push({ name: 'wrong-password', title: "One of the SDK's own codes", request: { method: 'POST', path: '/egradx/auth/login', body: { username: ADMIN.username, password: '…' } }, response: wrong });
    return steps;
  },

  async audit(ctx) {
    const steps = [];
    const changed = { title: 'Call the supplier today', body: 'About the late delivery' };
    const updated = await call(ctx.base, 'PUT', `/api/notes/${ctx.noteId}`, { token: ctx.token, body: changed });
    expect(updated.status === 200 && updated.body?.title === changed.title, `update: ${updated.status} ${JSON.stringify(updated.body)}`);
    steps.push({ name: 'update', title: 'A change', request: { method: 'PUT', path: '/api/notes/{id}', body: changed }, response: updated });

    const records = await call(ctx.base, 'GET', `/egradx/audit/events?action=${AREA}.note.updated&entityId=${ctx.noteId}`, { token: ctx.token });
    const record = records.body?.items?.[0];
    expect(record && [...(record.changedFields ?? [])].sort().join() === 'body,title', `the update's record: ${JSON.stringify(records.body)}`);
    steps.push({ name: 'update-record', title: 'Its audit record: before, after, and what changed', request: { method: 'GET', path: `/egradx/audit/events?action=${AREA}.note.updated&entityId={id}` }, response: { status: records.status, body: record } });

    const timeline = await call(ctx.base, 'GET', `/egradx/audit/timeline?entityType=note&entityId=${ctx.noteId}`, { token: ctx.token });
    expect(timeline.status === 200 && timeline.body?.items?.length === 2, `the timeline: ${JSON.stringify(timeline.body)}`);
    steps.push({
      name: 'timeline',
      title: "The note's history, newest first",
      request: { method: 'GET', path: '/egradx/audit/timeline?entityType=note&entityId={id}' },
      response: { status: timeline.status, body: { items: timeline.body.items.map((i) => ({ action: i.action, occurredAt: i.occurredAt, actor: i.actor?.name, changedFields: i.changedFields })), nextCursor: timeline.body.nextCursor } },
    });

    const actions = await call(ctx.base, 'GET', '/egradx/audit/actions', { token: ctx.token });
    const own = actions.body?.filter?.((a) => a.action.startsWith(`${AREA}.`));
    expect(own?.length === 3, `the action catalog: ${JSON.stringify(actions.body)}`);
    steps.push({ name: 'actions', title: "The application's actions in the catalog", request: { method: 'GET', path: '/egradx/audit/actions' }, response: { status: actions.status, body: own } });
    return steps;
  },

  async notifications(ctx) {
    const steps = [];
    const inbox = await call(ctx.base, 'GET', '/egradx/notifications?size=1', { token: ctx.token });
    expect(inbox.status === 200 && inbox.body?.items?.[0]?.notificationKey === `${AREA}.note.created`, `the inbox: ${JSON.stringify(inbox.body)}`);
    steps.push({ name: 'inbox', title: 'The bell: the newest notice', request: { method: 'GET', path: '/egradx/notifications?size=1' }, response: inbox });

    const unread = await call(ctx.base, 'GET', '/egradx/notifications/unread-count', { token: ctx.token });
    steps.push({ name: 'unread-count', title: 'Its unread count', request: { method: 'GET', path: '/egradx/notifications/unread-count' }, response: unread });

    const message = await eventually(() => ctx.mail.messages.find((m) => m.subject?.includes('Call the supplier')), 'The email');
    steps.push({
      name: 'email',
      title: 'The email, as the mail server received it',
      request: { method: 'SMTP', path: `to ${ADMIN.username}` },
      response: { status: 250, body: { from: message.from?.text, to: message.to?.text, subject: message.subject, html: message.html?.trim() } },
    });

    const deliveries = await eventually(async () => {
      const answer = await call(ctx.base, 'GET', '/egradx/notifications/admin/deliveries?channel=email', { token: ctx.token });
      return answer.body?.items?.find?.((d) => d.status === 'SENT') ? answer : undefined;
    }, 'The delivery to be marked sent');
    const delivery = deliveries.body.items.find((d) => d.status === 'SENT');
    steps.push({ name: 'delivery', title: 'Its delivery, in the delivery log', request: { method: 'GET', path: '/egradx/notifications/admin/deliveries?channel=email' }, response: { status: deliveries.status, body: delivery } });
    return steps;
  },

  async events(ctx) {
    const steps = [];
    const before = await call(ctx.base, 'GET', '/api/notes/stats', { token: ctx.token });
    steps.push({ name: 'stats-before', title: 'The count the handler keeps', request: { method: 'GET', path: '/api/notes/stats' }, response: before });
    const created = await call(ctx.base, 'POST', '/api/notes', { token: ctx.token, body: { title: 'Order more paper' } });
    expect(created.status === 201, `creating a note: ${created.status}`);
    steps.push({ name: 'publish', title: 'A note: the event goes out with it', request: { method: 'POST', path: '/api/notes', body: { title: 'Order more paper' } }, response: created });
    const after = await eventually(async () => {
      const answer = await call(ctx.base, 'GET', '/api/notes/stats', { token: ctx.token });
      return answer.body?.notesCreated === before.body.notesCreated + 1 ? answer : undefined;
    }, 'The handler');
    steps.push({ name: 'stats-after', title: 'A moment later: handled', request: { method: 'GET', path: '/api/notes/stats' }, response: after });
    return steps;
  },

  async 'sign-in'(ctx) {
    const steps = [];
    const login = await call(ctx.base, 'POST', '/egradx/auth/login', { body: ADMIN });
    expect(login.status === 200 && login.body?.accessToken, `sign-in: ${login.status}`);
    steps.push({ name: 'login', title: 'Sign in', request: { method: 'POST', path: '/egradx/auth/login', body: { username: ADMIN.username, password: '…' } }, response: { status: login.status, body: redact(login.body) } });

    const me = await call(ctx.base, 'GET', '/egradx/auth/me', { token: login.body.accessToken });
    expect(me.status === 200, `me: ${me.status} ${JSON.stringify(me.body)}`);
    steps.push({ name: 'me', title: 'Who is signed in', request: { method: 'GET', path: '/egradx/auth/me' }, response: me });

    const refreshed = await call(ctx.base, 'POST', '/egradx/auth/refresh', { body: { refreshToken: login.body.refreshToken } });
    expect(refreshed.status === 200 && refreshed.body?.accessToken, `refresh: ${refreshed.status} ${JSON.stringify(refreshed.body)}`);
    steps.push({ name: 'refresh', title: 'A new access token from the refresh token', request: { method: 'POST', path: '/egradx/auth/refresh', body: { refreshToken: '…' } }, response: { status: refreshed.status, body: redact(refreshed.body) } });
    return steps;
  },
};

/**
 * What the SDK declares, as an application answers it: its authorities and the roles holding them, its audit actions,
 * its message types. The reference pages are built from it (scripts/build-reference.mjs).
 */
async function catalogOf(ctx) {
  const permissions = await call(ctx.base, 'GET', '/egradx/auth/permissions', { token: ctx.token });
  const roles = await call(ctx.base, 'GET', '/egradx/auth/my/roles', { token: ctx.token });
  const actions = await call(ctx.base, 'GET', '/egradx/audit/actions', { token: ctx.token });
  const types = await call(ctx.base, 'GET', '/egradx/notifications/admin/types', { token: ctx.token });
  for (const [what, answer] of [['permissions', permissions], ['roles', roles], ['actions', actions], ['types', types]]) {
    expect(answer.status === 200 && Array.isArray(answer.body), `${what}: ${answer.status} ${JSON.stringify(answer.body).slice(0, 300)}`);
  }
  const adminRole = roles.body.find((role) => role.name === 'Admin');
  expect(adminRole, `no Admin role in ${JSON.stringify(roles.body).slice(0, 300)}`);
  const byName = (a, b) => String(a.name ?? a.action ?? a.key).localeCompare(String(b.name ?? b.action ?? b.key));
  return {
    permissions: permissions.body.map(({ name, description, category }) => ({ name, description, category })).sort(byName),
    adminRole: { name: adminRole.name, permissions: adminRole.permissions.map(({ name }) => ({ name })).sort(byName) },
    actions: actions.body.map(({ action, category, description, entityType }) => ({ action, category, description, entityType: entityType ?? null })).sort(byName),
    types: types.body.map(({ key, description, required, optional, userCanOptOut }) => ({ key, description, required: [...required].sort(), optional: [...optional].sort(), userCanOptOut })).sort(byName),
  };
}

const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LANGUAGES);
const captured = {};
const catalogs = {};
const mail = await mailSink();
try {
  for (const language of chosen) {
    const database = `devportal_capture_${language}`;
    await freshDatabase(database);
    const running = start(language, database, mail.port);
    try {
      const token = await waitUntilUp(running, language);
      const platform = await call(running.base, 'POST', '/egradx/auth/login', { body: { username: 'platform-admin', password: 'change-me-platform-admin' } });
      expect(platform.status === 200, `${language}: platform-admin could not sign in: ${platform.status}`);
      const ctx = { base: running.base, token, platformToken: platform.body.accessToken, mail, language };
      for (const [scenario, walk] of Object.entries(SCENARIOS)) {
        try {
          (captured[scenario] ??= {})[language] = await walk(ctx);
        } catch (error) {
          throw new Error(`${language}, ${scenario}: ${error.message}\n--- application log ---\n${running.output.join('').slice(-3000)}`);
        }
      }
      catalogs[language] = await catalogOf(ctx);
      console.log(`${language}: ok — ${Object.keys(SCENARIOS).join(', ')}, catalog`);
    } finally {
      if (windows) spawn('taskkill', ['/pid', String(running.child.pid), '/T', '/F']);
      else running.child.kill();
    }
  }
} finally {
  mail.close();
}

// The same answers in every language (statuses and error codes), then into each scenario's file, keeping the
// languages not run this time.
const signature = (steps) => steps.map((step) => `${step.name}:${step.response.status}:${step.response.body?.error?.code ?? ''}`).join(' ');
for (const [scenario, languages] of Object.entries(captured)) {
  const file = path.join(app, 'content', 'results', `${scenario}.json`);
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { languages: {} };
  const merged = { capturedAt: new Date().toISOString(), sdkVersion: '1.0.0', languages: { ...previous.languages, ...languages } };
  const order = Object.keys(LANGUAGES).filter((l) => merged.languages[l]);
  merged.languages = Object.fromEntries(order.map((l) => [l, merged.languages[l]]));
  const signatures = new Set(Object.values(merged.languages).map(signature));
  expect(signatures.size === 1, `${scenario}: the languages answered differently: ${[...signatures].join(' | ')}`);
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Recorded ${scenario}: ${order.join(', ')}`);
}

// The catalogs must be the same in every language (names, descriptions, who holds what); the first is recorded.
const catalogNames = Object.keys(catalogs);
if (catalogNames.length > 0) {
  const shapes = new Set(catalogNames.map((language) => JSON.stringify(catalogs[language])));
  if (shapes.size > 1) {
    const [first, ...others] = catalogNames;
    for (const other of others) {
      for (const part of ['permissions', 'adminRole', 'actions', 'types']) {
        if (JSON.stringify(catalogs[first][part]) !== JSON.stringify(catalogs[other][part])) {
          console.error(`The catalogs differ between ${first} and ${other} in ${part}`);
        }
      }
    }
    process.exit(1);
  }
  const file = path.join(app, 'content', 'results', 'catalog.json');
  writeFileSync(file, `${JSON.stringify({ capturedAt: new Date().toISOString(), sdkVersion: '1.0.0', languages: catalogNames, catalog: catalogs[catalogNames[0]] }, null, 2)}\n`);
  console.log(`Recorded catalog: ${catalogNames.join(', ')} (alike)`);
}
