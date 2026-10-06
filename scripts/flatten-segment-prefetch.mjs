// Next.js 16's static export writes each page's prefetch segments as nested folders
// (docs/x/__next.docs/$oc$slug/__PAGE__.txt), while its client asks for them by a flat name
// (docs/x/__next.docs.$oc$slug.__PAGE__.txt). A static host (Netlify, `serve`) then answers 404 and every link
// becomes a full page load. This writes the flat-named copy beside each nested file, after `next build`.
import { copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'out');
let copied = 0;

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (!statSync(full).isDirectory()) {
      continue;
    }
    if (name.startsWith('__next.')) {
      flatten(directory, name, full);
    } else {
      walk(full);
    }
  }
}

/** Every file under `<parent>/<segment>/…` gets a copy at `<parent>/<segment>.<…joined with dots>`. */
function flatten(parent, segment, directory, prefix = segment) {
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      flatten(parent, segment, full, `${prefix}.${name}`);
    } else {
      copyFileSync(full, path.join(parent, `${prefix}.${name}`));
      copied += 1;
    }
  }
}

walk(out);
console.log(`Prefetch segments: ${copied} flat-named copies written in ${path.relative(process.cwd(), out) || out}`);
