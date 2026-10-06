import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Code shown on the portal is cut from real files in this repository, never typed into a page, so it is always the code
 * that compiles and runs. A file marks what the portal may show with comments:
 *
 *   // docs:region create-product        (# in Python)
 *   …
 *   // docs:end
 *
 * A region that is missing or empty fails the build: a refactor cannot silently break a page.
 */

/** This app's folder: builds run from it (locally and on Netlify). */
const appRoot = process.cwd();
const APP_PATH = 'apps/egradx-devportal/';

/**
 * A file named by its path in the monorepo (egradx-v1-workspace). This app's own files are read where they are; the rest
 * from sources/, where scripts/sync-sources.mjs copies them, so the portal also builds in a repository of its own.
 */
export function repoFile(file: string): string {
  const absolute = file.startsWith(APP_PATH)
    ? path.resolve(appRoot, file.slice(APP_PATH.length))
    : path.resolve(appRoot, 'sources', file);
  if (!absolute.startsWith(appRoot + path.sep)) {
    throw new Error(`A file must be named by its path in the repository: ${file}`);
  }
  return absolute;
}

export interface Region {
  code: string;
  /** 1-based line of the region's first line of code. */
  line: number;
}

const START = /docs:region\s+([A-Za-z0-9_-]+)/;
const END = /docs:end\b/;

export function readRegion(file: string, name: string): Region {
  let text: string;
  try {
    text = readFileSync(repoFile(file), 'utf8');
  } catch {
    throw new Error(`Snippet file not found: ${file} (region ${name}); outside this app, run scripts/sync-sources.mjs`);
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => START.exec(line)?.[1] === name);
  if (start < 0) {
    throw new Error(`No "docs:region ${name}" in ${file}: the page that shows it needs it`);
  }
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (END.test(lines[i]!)) {
      if (body.every((line) => line.trim() === '')) {
        throw new Error(`The region ${name} in ${file} is empty`);
      }
      return { code: dedent(body).join('\n'), line: start + 2 };
    }
    body.push(lines[i]!);
  }
  throw new Error(`The region ${name} in ${file} has no "docs:end"`);
}

/** A whole file (for one too short to mark, or whose format has no comments, such as a message template). */
export function readWhole(file: string): Region {
  let text: string;
  try {
    text = readFileSync(repoFile(file), 'utf8');
  } catch {
    throw new Error(`Snippet file not found: ${file}; outside this app, run scripts/sync-sources.mjs`);
  }
  const code = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (!code.trim()) throw new Error(`${file} is empty`);
  return { code, line: 1 };
}

/** Removes the indentation every non-blank line shares. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)![0].length);
  const common = Math.min(...indents);
  return lines.map((line) => line.slice(common));
}

/** The GitHub link to a line (the repository is private, so it opens for its members). */
export function sourceUrl(file: string, line: number, repo: { user: string; repo: string; branch: string }): string {
  return `https://github.com/${repo.user}/${repo.repo}/blob/${repo.branch}/${file}#L${line}`;
}
