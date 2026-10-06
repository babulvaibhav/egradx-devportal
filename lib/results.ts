import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * What the example applications answered, recorded by scripts/capture.mjs into content/results/<name>.json: results on
 * a page are never typed, they are captured from the code the page shows.
 */
export interface RecordedStep {
  name: string;
  /** The step in the page's words. */
  title?: string;
  request: { method: string; path: string; as?: string; body?: unknown };
  response: { status: number; body: unknown };
}

export interface RecordedRun {
  capturedAt: string;
  sdkVersion: string;
  languages: Record<string, RecordedStep[]>;
}

export function readRun(name: string): RecordedRun {
  const file = path.join(process.cwd(), 'content', 'results', `${name}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RecordedRun;
  } catch {
    throw new Error(`No recorded results ${file}: run scripts/capture.mjs`);
  }
}

export const LANGUAGE_LABELS: Record<string, string> = { java: 'Java', node: 'Node', python: 'Python' };

