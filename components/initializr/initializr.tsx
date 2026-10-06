'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, FileCode, Folder, Plus, Search, X } from 'lucide-react';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import {
  capabilitiesFor,
  defaultSelection,
  dependents,
  fromQuery,
  generate,
  packageNameOf,
  problems,
  resolve,
  searchCapabilities,
  toQuery,
  zipProject,
  type Capability,
  type GeneratedFile,
  type Manifest,
  type Selection,
} from '@/initializr/core';
import manifestJson from '@/initializr/manifest.json';
import { aiContextZip } from '@/lib/shared';
import { cn } from '@/lib/cn';

const manifest = manifestJson as unknown as Manifest;

/** Templates are fetched once, when first needed: the page itself stays small. */
let templatesPromise: Promise<Record<string, string>> | null = null;
function loadTemplates(): Promise<Record<string, string>> {
  templatesPromise ??= fetch('/initializr/templates.json').then((response) => {
    if (!response.ok) throw new Error(`Could not load the templates (${response.status})`);
    return response.json() as Promise<Record<string, string>>;
  });
  return templatesPromise;
}

const EXTENSIONS: Record<string, string> = {
  java: 'java', xml: 'xml', yml: 'yaml', yaml: 'yaml', properties: 'properties', sql: 'sql', md: 'md', json: 'json',
  ts: 'ts', tsx: 'tsx', mts: 'ts', js: 'js', mjs: 'js', py: 'python', toml: 'toml', prisma: 'prisma', html: 'html',
  txt: 'txt', css: 'css', sh: 'bash', cmd: 'bat', env: 'bash',
};
function languageOf(path: string): string {
  const name = path.split('/').pop()!;
  if (name === 'Dockerfile') return 'docker';
  if (name === 'mvnw') return 'bash';
  if (name.startsWith('.env')) return 'bash';
  return EXTENSIONS[name.split('.').pop() ?? ''] ?? 'txt';
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Initializr() {
  const [selection, setSelection] = useState<Selection>(() => defaultSelection(manifest));
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'generate' | 'explore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explored, setExplored] = useState<GeneratedFile[] | null>(null);
  const [copied, setCopied] = useState(false);
  const loaded = useRef(false);

  // The selection comes from the address (shared links), and goes back into it as it changes.
  useEffect(() => {
    // The address is outside React: a static page can't read it while rendering without a hydration mismatch.
    // oxlint-disable-next-line react/set-state-in-effect
    if (window.location.search) setSelection(fromQuery(manifest, window.location.search));
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    window.history.replaceState(null, '', `${window.location.pathname}?${toQuery(manifest, selection)}`);
  }, [selection]);

  const offered = useMemo(() => capabilitiesFor(manifest, selection.language), [selection.language]);
  const always = offered.filter((c) => c.always);
  const choosable = offered.filter((c) => !c.always);
  const chosen = choosable.filter((c) => selection.capabilities.includes(c.id));
  const found = searchCapabilities(
    choosable.filter((c) => !selection.capabilities.includes(c.id)),
    query,
  );
  const invalid = problems(selection);
  const canGenerate = Object.keys(invalid).length === 0;

  const update = (change: Partial<Selection>) => setSelection((current) => ({ ...current, ...change }));

  const setLanguage = (language: Selection['language']) => {
    setSelection((current) => {
      const resolved = resolve(manifest, { ...current, language });
      if (resolved.dropped.length > 0) {
        const names = resolved.dropped.map((id) => manifest.capabilities.find((c) => c.id === id)?.name ?? id);
        setNotice(`${names.join(', ')} ${resolved.dropped.length === 1 ? 'is' : 'are'} not offered in this language, and was removed.`);
      }
      return resolved.selection;
    });
  };

  const add = (capability: Capability) => {
    const resolved = resolve(manifest, { ...selection, capabilities: [...selection.capabilities, capability.id] });
    setSelection(resolved.selection);
    setNotice(
      resolved.added.length > 0
        ? resolved.added
            .map((a) => `Added ${manifest.capabilities.find((c) => c.id === a.id)?.name}: ${a.reason}`)
            .join(' ')
        : null,
    );
    setQuery('');
  };

  const remove = (id: string) => {
    const gone = new Set([id]);
    let more = true;
    while (more) {
      more = false;
      for (const other of [...gone].flatMap((g) => dependents(manifest, selection, g))) {
        if (!gone.has(other)) {
          gone.add(other);
          more = true;
        }
      }
    }
    if (gone.size > 1) {
      const names = [...gone].filter((g) => g !== id).map((g) => manifest.capabilities.find((c) => c.id === g)?.name);
      setNotice(`Also removed ${names.join(', ')}, which ${names.length === 1 ? 'needs' : 'need'} it.`);
    } else {
      setNotice(null);
    }
    update({ capabilities: selection.capabilities.filter((c) => !gone.has(c)) });
  };

  const build = useCallback(async () => generate(manifest, selection, await loadTemplates()), [selection]);

  const onGenerate = useCallback(async () => {
    if (!canGenerate || busy) return;
    setBusy('generate');
    setError(null);
    try {
      const files = await build();
      const pack = selection.extras.includes('ai-pack')
        ? await fetch(aiContextZip).then((r) => (r.ok ? r.arrayBuffer() : undefined))
        : undefined;
      download(await zipProject(selection.artifact, files, pack), `${selection.artifact}.zip`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [build, busy, canGenerate, selection.artifact, selection.extras]);

  const onExplore = useCallback(async () => {
    if (!canGenerate || busy) return;
    setBusy('explore');
    setError(null);
    try {
      setExplored(await build());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [build, busy, canGenerate]);

  const onShare = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void onGenerate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onGenerate]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-6">
          <Section title="Language">
            <div className="grid gap-2 sm:grid-cols-3">
              {manifest.languages.map((language) => (
                <Choice
                  key={language.id}
                  active={selection.language === language.id}
                  onClick={() => setLanguage(language.id)}
                  title={language.name}
                  detail={language.detail}
                />
              ))}
            </div>
          </Section>

          <Section title="Project">
            <div className="grid gap-3">
              {selection.language === 'java' ? (
                <Field label="Group" value={selection.group} error={invalid.group} onChange={(group) => update({ group })} />
              ) : null}
              <Field
                label="Artifact"
                hint="The folder and package name"
                value={selection.artifact}
                error={invalid.artifact}
                onChange={(artifact) => update({ artifact: artifact.toLowerCase(), name: selection.name === selection.artifact ? artifact.toLowerCase() : selection.name })}
              />
              <Field label="Name" value={selection.name} error={invalid.name} onChange={(name) => update({ name })} />
              <Field label="Description" value={selection.description} onChange={(description) => update({ description })} />
              {selection.language === 'java' ? (
                <Field
                  label="Package"
                  value={selection.packageName}
                  placeholder={packageNameOf({ ...selection, packageName: '' })}
                  error={invalid.packageName}
                  onChange={(packageName) => update({ packageName })}
                />
              ) : null}
            </div>
          </Section>

          <Section title="Frontend">
            <div className="grid gap-2 sm:grid-cols-3">
              {manifest.frontends.map((frontend) => (
                <Choice
                  key={frontend.id}
                  active={selection.frontend === frontend.id}
                  onClick={() => update({ frontend: frontend.id })}
                  title={frontend.name}
                  detail={frontend.description}
                />
              ))}
            </div>
          </Section>

          <Section title="Also include">
            <div className="grid gap-2">
              {manifest.extras.map((extra) => {
                const on = selection.extras.includes(extra.id);
                return (
                  <label key={extra.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-fd-accent">
                    <input
                      type="checkbox"
                      className="mt-1 accent-fd-primary"
                      checked={on}
                      onChange={() =>
                        update({ extras: on ? selection.extras.filter((e) => e !== extra.id) : [...selection.extras, extra.id] })
                      }
                    />
                    <span>
                      <span className="font-medium">{extra.name}</span>
                      <span className="block text-sm text-fd-muted-foreground">{extra.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Capabilities">
            <p className="mb-3 text-sm text-fd-muted-foreground">
              Every project has the SDK's core. Add what else it needs; the generated project wires each one and uses it in
              its sample feature.
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              {always.map((capability) => (
                <span
                  key={capability.id}
                  title={capability.description}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-fd-secondary px-3 py-1 text-sm"
                >
                  <Check className="size-3.5" /> {capability.name}
                </span>
              ))}
            </div>

            {chosen.length > 0 ? (
              <ul className="mb-4 flex flex-col gap-2">
                {chosen.map((capability) => (
                  <li key={capability.id} className="flex items-start justify-between gap-3 rounded-lg border bg-fd-card p-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {capability.name} <span className="text-xs font-normal text-fd-muted-foreground">{capability.group}</span>
                      </div>
                      <div className="text-sm text-fd-muted-foreground">{capability.description}</div>
                      {(capability.options ?? []).map((option) => (
                        <div key={option.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-fd-muted-foreground">{option.name}:</span>
                          {option.values.map((value) => {
                            const key = `${capability.id}.${option.id}`;
                            const active = (selection.options[key] ?? option.default) === value.id;
                            return (
                              <button
                                key={value.id}
                                type="button"
                                title={value.description}
                                onClick={() => update({ options: { ...selection.options, [key]: value.id } })}
                                className={cn(
                                  'rounded-md border px-2 py-0.5',
                                  active ? 'border-fd-primary bg-fd-primary text-fd-primary-foreground' : 'hover:bg-fd-accent',
                                )}
                              >
                                {value.name}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${capability.name}`}
                      onClick={() => remove(capability.id)}
                      className="rounded-md p-1 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {notice ? (
              <p className="mb-3 rounded-lg border border-fd-primary/30 bg-fd-primary/5 p-3 text-sm" role="status">
                {notice}
              </p>
            ) : null}

            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fd-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search capabilities: login, email, kafka, tracing…"
                className="w-full rounded-lg border bg-fd-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-fd-primary/40"
              />
            </div>
            <ul className="flex flex-col gap-1">
              {found.map((capability) => (
                <li key={capability.id}>
                  <button
                    type="button"
                    onClick={() => add(capability)}
                    className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-fd-accent"
                  >
                    <Plus className="mt-0.5 size-4 shrink-0 text-fd-muted-foreground" />
                    <span>
                      <span className="font-medium">{capability.name}</span>{' '}
                      <span className="text-xs text-fd-muted-foreground">{capability.group}</span>
                      <span className="block text-sm text-fd-muted-foreground">{capability.description}</span>
                    </span>
                  </button>
                </li>
              ))}
              {found.length === 0 ? (
                <li className="p-2.5 text-sm text-fd-muted-foreground">
                  {query ? `Nothing matches “${query}”.` : 'Every capability is in the project.'}
                </li>
              ) : null}
            </ul>
          </Section>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center gap-3 border-t bg-fd-background/95 px-2 py-4 backdrop-blur">
        <button
          type="button"
          disabled={!canGenerate || busy !== null}
          onClick={() => void onGenerate()}
          className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground disabled:opacity-50"
        >
          <Download className="size-4" /> {busy === 'generate' ? 'Generating…' : 'Generate'}
          <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-xs opacity-70 sm:inline">Ctrl ⏎</kbd>
        </button>
        <button
          type="button"
          disabled={!canGenerate || busy !== null}
          onClick={() => void onExplore()}
          className="inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 font-medium disabled:opacity-50"
        >
          <FileCode className="size-4" /> {busy === 'explore' ? 'Opening…' : 'Explore'}
        </button>
        <button type="button" onClick={() => void onShare()} className="inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 font-medium">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Link copied' : 'Share'}
        </button>
        {!canGenerate ? <span className="text-sm text-fd-muted-foreground">Fix the fields marked above first.</span> : null}
      </div>

      {explored ? <Explorer files={explored} folder={selection.artifact} onClose={() => setExplored(null)} /> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Choice({ active, onClick, title, detail }: { active: boolean; onClick: () => void; title: string; detail: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors',
        active ? 'border-fd-primary bg-fd-primary/5 ring-1 ring-fd-primary' : 'hover:bg-fd-accent',
      )}
    >
      <div className="font-medium">{title}</div>
      <div className="text-xs text-fd-muted-foreground">{detail}</div>
    </button>
  );
}

function Field(props: {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">
        {props.label} {props.hint ? <span className="font-normal text-fd-muted-foreground">· {props.hint}</span> : null}
      </span>
      <input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.error ? true : undefined}
        className={cn(
          'rounded-lg border bg-fd-background px-3 py-2 outline-none focus:ring-2 focus:ring-fd-primary/40',
          props.error && 'border-red-500',
        )}
      />
      {props.error ? <span className="text-xs text-red-600 dark:text-red-400">{props.error}</span> : null}
    </label>
  );
}

function Explorer({ files, folder, onClose }: { files: GeneratedFile[]; folder: string; onClose: () => void }) {
  const first = files.find((f) => /README\.md$/.test(f.path)) ?? files[0]!;
  const [open, setOpen] = useState(first.path);
  const current = files.find((f) => f.path === open) ?? first;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="The generated project"
        className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-fd-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-medium">
            <Folder className="size-4" /> {folder} <span className="text-sm font-normal text-fd-muted-foreground">· {files.length} files</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 hover:bg-fd-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ul className="max-h-40 overflow-auto border-b p-2 text-sm md:max-h-none md:border-b-0 md:border-r">
            {files.map((file) => {
              const depth = file.path.split('/').length - 1;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => setOpen(file.path)}
                    title={file.path}
                    style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
                    className={cn(
                      'w-full truncate rounded-md py-1 pr-2 text-left',
                      file.path === current.path ? 'bg-fd-primary/10 font-medium text-fd-primary' : 'hover:bg-fd-accent',
                    )}
                  >
                    {depth > 0 ? <span className="text-fd-muted-foreground">{file.path.split('/').slice(0, -1).join('/')}/</span> : null}
                    {file.path.split('/').pop()}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="min-h-0 overflow-auto p-3">
            <DynamicCodeBlock lang={languageOf(current.path)} code={current.content} codeblock={{ title: current.path }} />
          </div>
        </div>
      </div>
    </div>
  );
}
