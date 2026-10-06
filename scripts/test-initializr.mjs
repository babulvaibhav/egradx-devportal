// The Initializr's test matrix (plan §6.4): every combination below is generated with the same code the /start page
// runs, then built, tested against PostgreSQL, started with its own development configuration and signed in to. A
// template that stops compiling, a test that fails, or a project that does not start fails the run.
//
//   node scripts/test-initializr.mjs                 every combination
//   node scripts/test-initializr.mjs java node       only these languages
//   node scripts/test-initializr.mjs --list          what would run
//
// Needs: Java 21 and Maven, Node 24, uv; PostgreSQL at PGHOST (localhost:5432, postgres/postgres), where it creates and
// drops one database pair per combination; GITHUB_TOKEN with read:packages (or a Maven server "egradx-sdk-github" in
// ~/.m2/settings.xml, whose token is then used); EGRADX_WHEELS_DIR, a folder holding the Python wheels (default:
// examples/python/egradx-wheels). Projects are generated into .matrix/ (git-ignored) and kept for a look afterwards.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { generate, fromQuery } = await import(pathToFileURL(path.join(app, 'initializr', 'core', 'index.ts')).href);
const manifest = JSON.parse(readFileSync(path.join(app, 'initializr', 'manifest.json'), 'utf8'));
const windows = process.platform === 'win32';

/** uv: UV, else the monorepo's own copy (.tools/uv, with its cache in .cache/uv), else the one on the PATH. */
const monorepo = path.resolve(app, '..', '..');
const workspaceUv = path.join(monorepo, '.tools', 'uv', windows ? 'Scripts/uv.exe' : 'bin/uv');
const uv = process.env.UV ?? (existsSync(workspaceUv) ? workspaceUv : 'uv');
const uvEnv = existsSync(workspaceUv) && !process.env.UV_CACHE_DIR ? { UV_CACHE_DIR: path.join(monorepo, '.cache', 'uv') } : {};

/** run: 'full' = build, test, start and sign in; 'build' = build only (a broker it would need is not started here). */
export const COMBOS = [
  { lang: 'java', name: 'minimal', caps: '', run: 'full' },
  { lang: 'java', name: 'all', caps: 'email,events,log-shipping,tracing', fe: 'vite', run: 'full' },
  { lang: 'java', name: 'rabbitmq', caps: 'events:transport=rabbitmq', fe: 'next', run: 'build' },
  { lang: 'java', name: 'kafka', caps: 'events:transport=kafka,log-shipping', run: 'build' },
  { lang: 'node', name: 'minimal', caps: '', run: 'full' },
  { lang: 'node', name: 'all', caps: 'email,events,log-shipping,tracing', fe: 'next', run: 'full' },
  { lang: 'node', name: 'rabbitmq', caps: 'events:transport=rabbitmq', run: 'build' },
  { lang: 'node', name: 'kafka', caps: 'events:transport=kafka', fe: 'vite', run: 'build' },
  { lang: 'python', name: 'minimal', caps: '', run: 'full' },
  { lang: 'python', name: 'all', caps: 'email,events,log-shipping,tracing', fe: 'vite', run: 'full' },
  { lang: 'python', name: 'rabbitmq', caps: 'events:transport=rabbitmq', fe: 'next', run: 'build' },
  { lang: 'python', name: 'kafka', caps: 'events:transport=kafka', run: 'build' },
];

function queryOf(combo) {
  const params = new URLSearchParams({ lang: combo.lang, group: 'com.acme', artifact: `mx-${combo.lang}-${combo.name}` });
  if (combo.caps) params.set('caps', combo.caps);
  if (combo.fe) params.set('fe', combo.fe);
  return params.toString();
}

function readTemplates() {
  const root = path.join(app, 'initializr', 'templates');
  const templates = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else templates[path.relative(root, full).split(path.sep).join('/')] = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    }
  };
  walk(root);
  return templates;
}

/** GITHUB_TOKEN, or the token of Maven's egradx-sdk-github server. Never printed. */
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const settings = path.join(homedir(), '.m2', 'settings.xml');
  if (!existsSync(settings)) return undefined;
  const server = /<server>\s*<id>egradx-sdk-github<\/id>[\s\S]*?<password>([^<]+)<\/password>/.exec(readFileSync(settings, 'utf8'));
  return server?.[1]?.startsWith('${') ? undefined : server?.[1];
}

function sh(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, shell: windows, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (error) => reject(new Error(`${command} ${args.join(' ')} could not start in ${options.cwd}: ${error.message}`)));
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(' ')} failed (${code}) in ${options.cwd}\n${output.slice(-6000)}`)),
    );
  });
}

const pgConfig = { host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres' };
async function databases(names, action) {
  const client = new pg.Client({ ...pgConfig, database: 'postgres' });
  await client.connect();
  try {
    for (const name of names) {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      if (action === 'create') await client.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.end();
  }
}

async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Starts the generated application with its own configuration, waits for it, signs in and creates a note. */
async function startAndSignIn(dir, combo, database) {
  const port = await freePort();
  const jdbc = `jdbc:postgresql://${pgConfig.host}:${pgConfig.port}/${database}`;
  const url = `postgresql://${pgConfig.user}:${pgConfig.password}@${pgConfig.host}:${pgConfig.port}/${database}`;
  const env = { PORT: String(port), DB_URL: jdbc, DATABASE_URL: url, EGRADX_KEY_PASSPHRASE: 'matrix-passphrase', SMTP_PORT: '1' };
  const [command, args] =
    combo.lang === 'java'
      ? ['java', ['-jar', path.join('target', readdirSync(path.join(dir, 'target')).find((n) => n.endsWith('.jar') && !n.endsWith('-plain.jar')))]]
      : combo.lang === 'node'
        ? ['npm', ['start']]
        : [uv, ['run', 'python', 'main.py']];
  const child = spawn(command, args, { cwd: dir, env: { ...process.env, ...env, ...uvEnv }, shell: windows, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`It stopped (exit ${child.exitCode})`);
      try {
        if ((await fetch(`${base}/egradx/auth/me`)).status < 500) break;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) throw new Error('It did not start within 2 minutes');
      await new Promise((r) => setTimeout(r, 1000));
    }
    // The server listens before its start-up seeding (the demo organization) has run: try again for a while.
    let login;
    for (let attempt = 0; attempt < 30; attempt++) {
      login = await fetch(`${base}/egradx/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ada@example.com', password: 'demo-password' }),
      });
      if (login.status !== 401) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (login.status !== 200) throw new Error(`Signing in answered ${login.status}: ${await login.text()}`);
    const { accessToken } = await login.json();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
    const created = await fetch(`${base}/api/notes`, { method: 'POST', headers, body: JSON.stringify({ title: 'Matrix note' }) });
    if (created.status !== 201) throw new Error(`Creating a note answered ${created.status}: ${await created.text()}`);
    const list = await (await fetch(`${base}/api/notes`, { headers })).json();
    if (!list.some((n) => n.title === 'Matrix note')) throw new Error(`The note is not listed: ${JSON.stringify(list)}`);
  } catch (error) {
    throw new Error(`${error.message}\n--- application log ---\n${log.slice(-6000)}`);
  } finally {
    if (windows) await sh('taskkill', ['/pid', String(child.pid), '/T', '/F']).catch(() => {});
    else child.kill();
  }
}

async function runCombo(combo, templates, token) {
  const artifact = `mx-${combo.lang}-${combo.name}`;
  const moduleName = artifact.replace(/-/g, '_');
  const dir = path.join(app, '.matrix', artifact);
  rmSync(dir, { recursive: true, force: true });
  for (const file of generate(manifest, fromQuery(manifest, queryOf(combo)), templates)) {
    mkdirSync(path.dirname(path.join(dir, file.path)), { recursive: true });
    writeFileSync(path.join(dir, file.path), file.content);
  }
  const full = combo.run === 'full';
  if (full) await databases([moduleName, `${moduleName}_test`], 'create');
  const env = { GITHUB_TOKEN: token, TEST_DB_URL: `jdbc:postgresql://${pgConfig.host}:${pgConfig.port}/${moduleName}_test`, TEST_DATABASE_URL: `postgresql://${pgConfig.user}:${pgConfig.password}@${pgConfig.host}:${pgConfig.port}/${moduleName}_test` };
  try {
    if (combo.lang === 'java') {
      await sh('mvn', ['-B', '-q', full ? 'verify' : 'package', ...(full ? [] : ['-DskipTests'])], { cwd: dir, env });
    } else if (combo.lang === 'node') {
      await sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, env });
      await sh('npx', ['prisma', 'generate'], { cwd: dir, env });
      await sh('npm', ['run', 'typecheck'], { cwd: dir, env });
      if (full) await sh('npm', ['test'], { cwd: dir, env });
    } else {
      const wheels = process.env.EGRADX_WHEELS_DIR ?? path.join(app, 'examples', 'python', 'egradx-wheels');
      cpSync(wheels, path.join(dir, 'egradx-wheels'), { recursive: true });
      await sh(uv, ['sync', '--quiet'], { cwd: dir, env: { ...env, ...uvEnv } });
      if (full) await sh(uv, ['run', 'pytest', '-q'], { cwd: dir, env: { ...env, ...uvEnv } });
    }
    if (full) await startAndSignIn(dir, combo, moduleName);
    if (combo.fe) {
      await sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: path.join(dir, 'web'), env });
      await sh('npm', ['run', 'build'], { cwd: path.join(dir, 'web'), env });
    }
  } finally {
    if (full) await databases([moduleName, `${moduleName}_test`], 'drop').catch(() => {});
  }
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const combos = COMBOS.filter((c) => wanted.length === 0 || wanted.includes(c.lang) || wanted.includes(`${c.lang}:${c.name}`));
if (process.argv.includes('--list')) {
  for (const combo of combos) console.log(`${combo.lang}:${combo.name}  ${combo.run}  ?${queryOf(combo)}`);
  process.exit(0);
}
const templates = readTemplates();
const token = githubToken();
if (!token) {
  console.error('Set GITHUB_TOKEN (read:packages): the generated projects install the SDK from GitHub Packages');
  process.exit(1);
}
const failures = [];
for (const combo of combos) {
  const started = Date.now();
  try {
    await runCombo(combo, templates, token);
    console.log(`ok    ${combo.lang}:${combo.name} (${combo.run}${combo.fe ? ` + ${combo.fe}` : ''}) ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (error) {
    failures.push(`${combo.lang}:${combo.name}`);
    console.log(`FAIL  ${combo.lang}:${combo.name}\n${error.message}\n`);
  }
}
console.log(failures.length === 0 ? `All ${combos.length} combinations pass` : `${failures.length} of ${combos.length} failed: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
