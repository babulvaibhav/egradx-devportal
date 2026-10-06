// Refreshes everything the portal generates, in order, after an SDK or template change — then builds the site:
//
//   1. examples   regenerate examples/* from the Initializr's templates
//   2. prepare    package the Java example, install the Node and web ones, fetch the Python wheels and sync
//   3. check      type-check the web examples (their recipe files included)
//   4. capture    run the three examples and record what they answer (content/results/)
//   5. api        the Node, web, Python and Java API references (scripts/build-api-reference.mjs)
//   6. screens    copy OIM's browser-test screenshots, if a run left them
//   7. build      npm run build: sources, contract references, the site, the link check
//
//   node scripts/refresh.mjs                 every step
//   node scripts/refresh.mjs capture build   only these steps
//
// In the monorepo only. Needs what each step needs: Maven, uv (the monorepo's .tools/uv, or on the PATH), a local
// PostgreSQL, and a token that can read the SDK's packages — GITHUB_TOKEN, or the egradx-sdk-github server in
// ~/.m2/settings.xml. The token is passed to the commands that need it and never printed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const monorepo = path.resolve(app, '..', '..');
const windows = process.platform === 'win32';
const STEPS = ['examples', 'prepare', 'check', 'capture', 'api', 'screens', 'build'];
const wanted = process.argv.slice(2);
const unknown = wanted.filter((step) => !STEPS.includes(step));
if (unknown.length) {
  console.error(`Unknown step: ${unknown.join(', ')}. Steps: ${STEPS.join(', ')}`);
  process.exit(2);
}
if (!existsSync(path.join(monorepo, 'sdks'))) {
  console.error('Run this in the monorepo (egradx-v1-workspace).');
  process.exit(1);
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const settings = path.join(homedir(), '.m2', 'settings.xml');
  if (!existsSync(settings)) return undefined;
  const server = /<server>\s*<id>egradx-sdk-github<\/id>[\s\S]*?<password>([^<]+)<\/password>/.exec(readFileSync(settings, 'utf8'));
  return server?.[1]?.startsWith('${') ? undefined : server?.[1];
}

const token = githubToken();
const mask = (text) => (token ? text.split(token).join('***') : text).replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '***');
const workspaceUv = path.join(monorepo, '.tools', 'uv', windows ? 'Scripts/uv.exe' : 'bin/uv');
const uv = existsSync(workspaceUv) ? workspaceUv : 'uv';
const uvEnv = existsSync(workspaceUv) ? { UV_CACHE_DIR: path.join(monorepo, '.cache', 'uv') } : {};

/** Runs one command; its output is shown only when it fails (masked), and a failure stops the refresh. */
function run(label, command, args, { cwd = app, env = {} } = {}) {
  process.stdout.write(`  ${label} … `);
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, shell: windows, encoding: 'utf8' });
  if (result.status !== 0) {
    console.log('failed');
    console.error(mask(`${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`).split('\n').slice(-40).join('\n'));
    process.exit(1);
  }
  console.log('done');
}

const needToken = () => {
  if (!token) {
    console.error('No token: set GITHUB_TOKEN, or the egradx-sdk-github server in ~/.m2/settings.xml (get-started/access).');
    process.exit(1);
  }
  return { GITHUB_TOKEN: token };
};
const examples = (name) => path.join(app, 'examples', name);

const steps = {
  examples() {
    run('regenerate examples/*', 'node', ['scripts/generate-examples.mjs']);
  },
  prepare() {
    const env = needToken();
    run('Java: package', 'mvn', ['-B', '-q', '-f', path.join(examples('java'), 'pom.xml'), 'clean', 'package', '-DskipTests']);
    run('Node: install', 'npm', ['install', '--no-audit', '--no-fund'], { cwd: examples('node'), env });
    run('Node: prisma generate', 'npx', ['prisma', 'generate'], { cwd: examples('node') });
    run('Python: wheels', 'python', ['scripts/get_wheels.py'], { cwd: examples('python'), env });
    run('Python: sync', uv, ['sync'], { cwd: examples('python'), env: uvEnv });
    for (const web of ['web-vite', 'web-next']) run(`${web}: install`, 'npm', ['install', '--no-audit', '--no-fund'], { cwd: examples(web), env });
  },
  check() {
    for (const web of ['web-vite', 'web-next']) run(`${web}: type-check`, 'npx', ['tsc', '--noEmit', '-p', '.'], { cwd: examples(web) });
  },
  capture() {
    run('run the examples and record their answers', 'node', ['scripts/capture.mjs']);
  },
  api() {
    run('API references (Node, web, Python, Java)', 'node', ['scripts/build-api-reference.mjs']);
  },
  screens() {
    const results = path.join(monorepo, 'apps', 'egradx-oim', 'e2e', 'results');
    if (!existsSync(results)) {
      console.log('  screenshots … skipped: no browser-test run in apps/egradx-oim/e2e/results');
      return;
    }
    run('screenshots from the browser tests', 'node', ['scripts/import-screens.mjs']);
  },
  build() {
    run('build the site and check its links', 'npm', ['run', 'build']);
  },
};

for (const step of STEPS) {
  if (wanted.length && !wanted.includes(step)) continue;
  console.log(step);
  steps[step]();
}
console.log('Refreshed. Review the changes (examples/, content/, public/reference/java, data/java-configuration.json) and commit them.');
