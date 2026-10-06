import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const revalidate = false;

/**
 * Every Initializr template, as { "java/pom.xml.hbs": "…" }, built into one static file. The /start page fetches it
 * when a developer first generates or explores a project.
 */
export function GET() {
  const root = path.join(process.cwd(), 'initializr', 'templates');
  const templates: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else templates[path.relative(root, full).split(path.sep).join('/')] = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    }
  };
  walk(root);
  return Response.json(templates);
}
