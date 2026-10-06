// Copies the screenshots OIM's browser tests took for the portal (apps/egradx-oim/e2e/results/<run>/results/screens)
// into public/screens/, where <Screenshot name=…/> finds them. Run after the browser tests:
//
//   node scripts/import-screens.mjs [run]        run: java (default), node, python, java-next, …
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = process.argv[2] ?? 'java';
const from = path.resolve(app, '..', 'egradx-oim', 'e2e', 'results', run, 'results', 'screens');
const to = path.join(app, 'public', 'screens');
if (!existsSync(from)) {
  console.error(`No screenshots in ${from}: run OIM's browser tests first (apps/egradx-oim/e2e/run-e2e.sh)`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
const files = readdirSync(from).filter((name) => name.endsWith('.png'));
for (const name of files) {
  copyFileSync(path.join(from, name), path.join(to, name));
}
console.log(`Copied ${files.length} screenshot(s) from the ${run} run into public/screens`);
