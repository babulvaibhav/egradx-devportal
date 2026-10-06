// Checks every link inside the built site (out/): each internal href or src must name a file the site serves, and each
// #anchor must name an id on the page it points to. External links are not fetched (the build must not depend on the
// network); they are only counted. Run by `npm run build` last; fails the build on a broken link.
//
//   node scripts/check-links.mjs [out]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'out');

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

/** The file a site path is served from, as a static host (Netlify) resolves it. */
function resolveTarget(sitePath) {
  const clean = decodeURIComponent(sitePath.replace(/\/+$/, '')) || '/';
  const candidates =
    clean === '/'
      ? ['index.html']
      : [clean.slice(1), `${clean.slice(1)}.html`, `${clean.slice(1)}/index.html`];
  for (const candidate of candidates) {
    const full = path.join(out, candidate);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

const idsCache = new Map();
function idsOf(file) {
  if (!idsCache.has(file)) {
    const html = readFileSync(file, 'utf8');
    idsCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
}

/** Path of a page in the site, from its file: out/docs/a.html → /docs/a */
function pageUrl(file) {
  const relative = path.relative(out, file).split(path.sep).join('/');
  return `/${relative.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '')}`;
}

const broken = [];
let checked = 0;
let external = 0;
// The Java API (javadoc) is generated as it is, with its own relative links: only links into it are checked.
const GENERATED_SITES = [path.join(out, 'reference', 'java') + path.sep];
for (const file of htmlFiles(out)) {
  if (GENERATED_SITES.some((prefix) => file.startsWith(prefix))) continue;
  const html = readFileSync(file, 'utf8');
  const from = pageUrl(file);
  for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const link = match[1].replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(link) || link.startsWith('//')) {
      external++;
      continue;
    }
    // Next.js's own assets and prefetch data are produced by the build itself.
    if (link.startsWith('/_next/')) continue;
    checked++;
    const [target, anchor] = link.split('#');
    const withoutQuery = (target ?? '').split('?')[0];
    const sitePath = withoutQuery === '' ? from : withoutQuery.startsWith('/') ? withoutQuery : path.posix.join(path.posix.dirname(from), withoutQuery);
    const resolved = withoutQuery === '' ? file : resolveTarget(sitePath);
    if (!resolved) {
      broken.push(`${from}: ${link} (no such file)`);
    } else if (anchor && resolved.endsWith('.html') && !idsOf(resolved).has(decodeURIComponent(anchor))) {
      broken.push(`${from}: ${link} (no element with id "${anchor}")`);
    }
  }
}

const unique = [...new Set(broken)];
if (unique.length > 0) {
  console.error(`Broken links: ${unique.length}\n  ${unique.join('\n  ')}`);
  process.exit(1);
}
console.log(`Links: ${checked} internal links checked, all resolve (${external} external links not fetched)`);
