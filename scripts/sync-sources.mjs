// The portal builds from its own folder only, so it can live in a repository of its own as well as in the monorepo.
// Everything it reads from the rest of the monorepo is copied into sources/<path in the monorepo> by this script, and
// committed:
//   - every file a page cuts code from (<RepoSnippet file="…"/> outside this app: OIM's backends, SDK sources);
//   - contracts/ (the AI context pack and the references are built from it);
//   - the inputs of the generated references (see scripts/build-reference.mjs).
//
// Run by `npm run build` first. In the monorepo it refreshes sources/ (and removes what is no longer used). Elsewhere
// it only checks that every file the pages need is there, and fails the build if one is missing.
//
//   node scripts/sync-sources.mjs          refresh in the monorepo, check elsewhere
//   node scripts/sync-sources.mjs --check  only check
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = path.join(app, 'sources');
const monorepo = path.resolve(app, '..', '..');
const APP_PATH = 'apps/egradx-devportal/';

/** Folders copied whole, as paths in the monorepo. */
export const FOLDERS = [
  'contracts',
  // The copy-in screens (a shadcn registry), served at /r/<item>.json by app/r/[item]/route.ts.
  'sdks/web/packages/ui/public/r',
];

/** Single files copied besides the snippet files, as paths in the monorepo (the reference generators' inputs). */
export const FILES = [];

const inMonorepo =
  existsSync(path.join(monorepo, 'contracts', 'schemas', 'error.json')) &&
  path.relative(monorepo, app).split(path.sep).join('/') === APP_PATH.slice(0, -1);

/** Every file a page cuts code from that lies outside this app. */
function snippetFiles() {
  const files = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.mdx?$/.test(entry.name)) {
        for (const match of readFileSync(full, 'utf8').matchAll(/<RepoSnippet[^>]*\bfile="([^"]+)"/g)) {
          if (!match[1].startsWith(APP_PATH)) files.add(match[1]);
        }
      }
    }
  };
  walk(path.join(app, 'content'));
  return [...files].sort();
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

const needed = [...snippetFiles(), ...FILES];
const check = process.argv.includes('--check') || !inMonorepo;

if (check) {
  const missing = [...needed, ...FOLDERS].filter((file) => !existsSync(path.join(sources, file)));
  if (missing.length > 0) {
    console.error(
      `sources/ lacks ${missing.length} file(s) the pages need:\n  ${missing.join('\n  ')}\n` +
        'Run `node scripts/sync-sources.mjs` in the monorepo (egradx-v1-workspace) and commit sources/.',
    );
    process.exit(1);
  }
  console.log(`sources/: all ${needed.length} file(s) and ${FOLDERS.length} folder(s) present${inMonorepo ? '' : ' (standalone build)'}`);
} else {
  for (const entry of readdirSync(sources, { withFileTypes: true }).filter((e) => e.name !== 'README.md')) {
    rmSync(path.join(sources, entry.name), { recursive: true, force: true });
  }
  for (const file of needed) {
    const from = path.join(monorepo, file);
    if (!existsSync(from)) {
      console.error(`A page cuts code from ${file}, which does not exist in the monorepo`);
      process.exit(1);
    }
    mkdirSync(path.dirname(path.join(sources, file)), { recursive: true });
    cpSync(from, path.join(sources, file));
  }
  for (const folder of FOLDERS) {
    cpSync(path.join(monorepo, folder), path.join(sources, folder), { recursive: true });
  }
  const count = listFiles(sources).filter((file) => path.basename(file) !== 'README.md').length;
  const bytes = listFiles(sources).reduce((sum, file) => sum + statSync(file).size, 0);
  writeFileSync(
    path.join(sources, 'files.txt'),
    `${listFiles(sources)
      .map((file) => path.relative(sources, file).split(path.sep).join('/'))
      .filter((file) => file !== 'README.md' && file !== 'files.txt')
      .sort()
      .join('\n')}\n`,
  );
  console.log(`sources/: ${count} file(s), ${(bytes / 1024).toFixed(0)} KiB, copied from the monorepo`);
}
