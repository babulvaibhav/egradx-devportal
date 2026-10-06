// The portal's example applications are the Initializr's own output: one project per language with every capability,
// generated from the same templates a developer downloads, with the "docs:region" markers the pages cut code with
// kept. So what a page shows is what /start gives, and the Initializr's test matrix guards both.
//
//   node scripts/generate-examples.mjs          regenerate examples/{java,node,python,web-vite,web-next}
//
// examples/java, node and python are whole projects (their code in backend/); web-vite and web-next are the frontend/
// folder of a project, on their own.
//   node scripts/generate-examples.mjs --check  fail if an example differs from what the templates make
//
// Build output and local state in the example folders (node_modules, .venv, target, egradx-wheels, keys) are kept.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { generate, fromQuery } = await import(pathToFileURL(path.join(app, 'initializr', 'core', 'index.ts')).href);
const manifest = JSON.parse(readFileSync(path.join(app, 'initializr', 'manifest.json'), 'utf8'));

/** Every capability, events in-process, tests and compose; no AI pack (the portal links its own). */
const EVERYTHING = 'group=com.acme&artifact=notes&name=Notes&description=The%20developer%20portal%27s%20example%20application&caps=email,events,log-shipping,tracing&extras=tests,compose,dockerfile';
const EXAMPLES = [
  { folder: 'java', query: `lang=java&${EVERYTHING}` },
  { folder: 'node', query: `lang=node&${EVERYTHING}` },
  { folder: 'python', query: `lang=python&${EVERYTHING}` },
  // The frontends come with any backend; only their frontend/ folder is kept.
  { folder: 'web-vite', query: `lang=java&${EVERYTHING}&fe=vite`, only: 'frontend/' },
  { folder: 'web-next', query: `lang=java&${EVERYTHING}&fe=next`, only: 'frontend/' },
];
// Kept: build output and local state, and the portal's recipes (code a recipe shows, compiled with the example; not in
// the generated project).
const KEEP = new Set(['node_modules', '.venv', 'target', 'egradx-wheels', 'keys', '.next', 'dist', 'uv.lock', 'package-lock.json', 'backend/src/generated', 'recipes', 'tsconfig.tsbuildinfo']);

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

/** The files of an example folder, outside what KEEP protects, as relative paths. */
function existing(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const relative = path.relative(base, full).split(path.sep).join('/');
    if (KEEP.has(relative) || KEEP.has(entry.name) || entry.name === '__pycache__' || entry.name === '.pytest_cache') return [];
    return entry.isDirectory() ? existing(full, base) : [relative];
  });
}

const templates = readTemplates();
const check = process.argv.includes('--check');
const differences = [];
for (const example of EXAMPLES) {
  const dir = path.join(app, 'examples', example.folder);
  const files = generate(manifest, fromQuery(manifest, example.query), templates, { keepDocsRegions: true })
    .filter((file) => !example.only || file.path.startsWith(example.only))
    .map((file) => ({ ...file, path: example.only ? file.path.slice(example.only.length) : file.path }));
  const wanted = new Map(files.map((file) => [file.path, file.content]));
  for (const relative of existing(dir)) {
    if (!wanted.has(relative)) {
      if (check) differences.push(`${example.folder}/${relative} is not made by the templates`);
      else rmSync(path.join(dir, relative));
    }
  }
  for (const [relative, content] of wanted) {
    const target = path.join(dir, relative);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
    if (current === content) continue;
    if (check) differences.push(`${example.folder}/${relative} differs from the templates`);
    else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }
  if (!check) console.log(`examples/${example.folder}: ${files.length} files`);
}
if (check && differences.length > 0) {
  console.error(`The examples are not what the templates make (run node scripts/generate-examples.mjs):\n  ${differences.join('\n  ')}`);
  process.exit(1);
}
if (check) console.log('The examples match the templates');
