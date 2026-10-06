import { Fragment } from 'react';
import Link from 'next/link';
import parity from '@/data/parity.json';
import { cn } from '@/lib/cn';

export type Status = 'yes' | 'partial' | 'planned' | 'no' | 'na';
export interface ParityEntry {
  id: string;
  name: string;
  area: string;
  java: Status;
  node: Status;
  python: Status;
  web: Status;
  /** Why a language is partial, planned or missing. */
  notes?: Partial<Record<'java' | 'node' | 'python' | 'web', string>>;
}

export const entries = parity.capabilities as ParityEntry[];
export const LANGUAGES = [
  ['java', 'Java'],
  ['node', 'Node'],
  ['python', 'Python'],
  ['web', 'Web'],
] as const;

const LOOK: Record<Status, { label: string; mark: string; className: string }> = {
  yes: { label: 'Available', mark: '✓', className: 'border-green-600/30 bg-green-600/10 text-green-800 dark:text-green-300' },
  partial: { label: 'Partial', mark: '◐', className: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300' },
  planned: { label: 'Planned', mark: '○', className: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300' },
  no: { label: 'Not available', mark: '✕', className: 'border-fd-border bg-fd-muted text-fd-muted-foreground' },
  na: { label: 'Not applicable', mark: '–', className: 'border-fd-border text-fd-muted-foreground' },
};

export function StatusMark({ status, note }: { status: Status; note?: string }) {
  const look = LOOK[status];
  return (
    <span
      title={note ? `${look.label}: ${note}` : look.label}
      className={cn('inline-flex min-w-7 items-center justify-center rounded-md border px-1.5 text-sm', look.className)}
    >
      {look.mark}
      <span className="sr-only"> {look.label}</span>
    </span>
  );
}

/**
 * The capability's status in each language, at the top of a guide: `<Parity id="notifications.email" />`. The data is
 * data/parity.json, which the parity page shows whole.
 */
export function Parity({ id }: { id: string }) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No parity entry "${id}" in data/parity.json`);
  const shown = LANGUAGES.filter(([key]) => entry[key] !== 'na');
  return (
    <div className="not-prose my-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {shown.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <StatusMark status={entry[key]} note={entry.notes?.[key]} />
          {label}
        </span>
      ))}
      <Link href="/docs/reference/parity" className="text-fd-muted-foreground underline underline-offset-4">
        What the marks mean
      </Link>
    </div>
  );
}

/** The whole matrix, by area. */
export function ParityMatrix() {
  const areas = [...new Set(entries.map((e) => e.area))];
  return (
    <div className="not-prose my-6 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Capability</th>
            {LANGUAGES.map(([key, label]) => (
              <th key={key} className="px-2 py-2 text-center font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => (
            <Fragment key={area}>
              <tr>
                <td colSpan={5} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-fd-muted-foreground">
                  {area}
                </td>
              </tr>
              {entries
                .filter((e) => e.area === area)
                .map((entry) => (
                  <tr key={entry.id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      {entry.name}
                      {entry.notes ? (
                        <ul className="mt-1 text-xs text-fd-muted-foreground">
                          {Object.entries(entry.notes).map(([language, note]) => (
                            <li key={language}>
                              <span className="font-medium capitalize">{language}:</span> {note}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    {LANGUAGES.map(([key]) => (
                      <td key={key} className="px-2 py-2 text-center">
                        <StatusMark status={entry[key]} note={entry.notes?.[key]} />
                      </td>
                    ))}
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
