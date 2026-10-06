import type { Capability, LanguageId, Manifest, Selection } from './types.ts';

const ARTIFACT = /^[a-z][a-z0-9-]{0,40}$/;
const GROUP = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export function defaultSelection(manifest: Manifest): Selection {
  return {
    language: 'java',
    group: 'com.example',
    artifact: 'demo',
    name: 'demo',
    description: 'An application on the EGRADX SDK',
    packageName: '',
    capabilities: [],
    options: Object.fromEntries(
      manifest.capabilities.flatMap((capability) =>
        (capability.options ?? []).map((option) => [`${capability.id}.${option.id}`, option.default]),
      ),
    ),
    frontend: 'none',
    extras: manifest.extras.filter((extra) => extra.default).map((extra) => extra.id),
  };
}

/** The capabilities a language offers. */
export function capabilitiesFor(manifest: Manifest, language: LanguageId): Capability[] {
  return manifest.capabilities.filter((capability) => !capability.languages || capability.languages.includes(language));
}

/** Java's package: the one set, or group + artifact made a valid identifier. */
export function packageNameOf(selection: Selection): string {
  if (selection.packageName) return selection.packageName;
  return `${selection.group}.${selection.artifact.replace(/-/g, '')}`.replace(/\.\d/g, (m) => `._${m.slice(1)}`);
}

/** What is wrong with the selection, field by field; empty when it can be generated. */
export function problems(selection: Selection): Record<string, string> {
  const found: Record<string, string> = {};
  if (!ARTIFACT.test(selection.artifact)) found.artifact = 'Lower-case letters, digits and dashes, starting with a letter';
  if (selection.language === 'java') {
    if (!GROUP.test(selection.group)) found.group = 'Like com.example: lower-case words separated by dots';
    if (selection.packageName && !GROUP.test(selection.packageName)) found.packageName = 'Like com.example.demo';
  }
  if (!selection.name.trim()) found.name = 'Give the project a name';
  return found;
}

export interface Resolved {
  selection: Selection;
  /** Capabilities added because another one needs them, with why. */
  added: { id: string; by: string; reason: string }[];
  /** Capabilities dropped because the language does not offer them. */
  dropped: string[];
}

/**
 * Makes a selection consistent: drops what the language lacks, adds what chosen capabilities require (repeatedly),
 * and orders the result as the manifest does.
 */
export function resolve(manifest: Manifest, selection: Selection): Resolved {
  const offered = new Map(capabilitiesFor(manifest, selection.language).map((c) => [c.id, c]));
  const dropped = selection.capabilities.filter((id) => !offered.has(id));
  const chosen = new Set(selection.capabilities.filter((id) => offered.has(id) && !offered.get(id)!.always));
  const added: Resolved['added'] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...chosen]) {
      for (const requirement of offered.get(id)?.requires ?? []) {
        const needed = offered.get(requirement.id);
        if (needed && !needed.always && !chosen.has(requirement.id)) {
          chosen.add(requirement.id);
          added.push({ id: requirement.id, by: id, reason: requirement.reason });
          changed = true;
        }
      }
    }
  }
  const order = manifest.capabilities.map((c) => c.id);
  return {
    selection: { ...selection, capabilities: [...chosen].sort((a, b) => order.indexOf(a) - order.indexOf(b)) },
    added,
    dropped,
  };
}

/** The capabilities that require this one (so removing it removes them too). */
export function dependents(manifest: Manifest, selection: Selection, id: string): string[] {
  return manifest.capabilities
    .filter((c) => selection.capabilities.includes(c.id) && c.requires?.some((r) => r.id === id))
    .map((c) => c.id);
}

/** The selection as a query string, leaving out what is at its default, so shared links stay short. */
export function toQuery(manifest: Manifest, selection: Selection): string {
  const defaults = defaultSelection(manifest);
  const params = new URLSearchParams();
  params.set('lang', selection.language);
  for (const key of ['group', 'artifact', 'name', 'description', 'packageName'] as const) {
    if (selection[key] !== defaults[key]) params.set(key === 'packageName' ? 'package' : key, selection[key]);
  }
  if (selection.capabilities.length > 0) {
    params.set(
      'caps',
      selection.capabilities
        .map((id) => {
          const options = Object.entries(selection.options)
            .filter(([key, value]) => key.startsWith(`${id}.`) && value !== defaults.options[key])
            .map(([key, value]) => `${key.slice(id.length + 1)}=${value}`);
          return options.length > 0 ? `${id}:${options.join(':')}` : id;
        })
        .join(','),
    );
  }
  if (selection.frontend !== 'none') params.set('fe', selection.frontend);
  if ([...selection.extras].sort().join() !== [...defaults.extras].sort().join()) params.set('extras', selection.extras.join(','));
  return params.toString();
}

/** A selection from a query string; anything unknown or malformed falls back to the default. */
export function fromQuery(manifest: Manifest, query: string): Selection {
  const params = new URLSearchParams(query);
  const selection = defaultSelection(manifest);
  const language = params.get('lang');
  if (manifest.languages.some((l) => l.id === language)) selection.language = language as LanguageId;
  for (const [param, key] of [
    ['group', 'group'],
    ['artifact', 'artifact'],
    ['name', 'name'],
    ['description', 'description'],
    ['package', 'packageName'],
  ] as const) {
    const value = params.get(param);
    if (value !== null) selection[key] = value.slice(0, 200);
  }
  const known = new Map(manifest.capabilities.map((c) => [c.id, c]));
  for (const entry of (params.get('caps') ?? '').split(',').filter(Boolean)) {
    const [id, ...options] = entry.split(':');
    const capability = known.get(id!);
    if (!capability || capability.always) continue;
    selection.capabilities.push(capability.id);
    for (const option of options) {
      const [optionId, value] = option.split('=');
      const definition = capability.options?.find((o) => o.id === optionId);
      if (definition?.values.some((v) => v.id === value)) selection.options[`${capability.id}.${optionId}`] = value!;
    }
  }
  const frontend = params.get('fe');
  if (manifest.frontends.some((f) => f.id === frontend)) selection.frontend = frontend as Selection['frontend'];
  if (params.has('extras')) {
    const extras = new Set(manifest.extras.map((e) => e.id));
    selection.extras = (params.get('extras') ?? '').split(',').filter((id) => extras.has(id));
  }
  return resolve(manifest, selection).selection;
}

/**
 * Capabilities matching a search, best first: a name that starts with the words, then a keyword, then the
 * description. Every word must match somewhere.
 */
export function searchCapabilities(capabilities: Capability[], query: string): Capability[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return capabilities;
  const scored = capabilities.map((capability) => {
    const name = capability.name.toLowerCase();
    const keywords = capability.keywords.map((k) => k.toLowerCase());
    const text = `${name} ${capability.group} ${capability.description} ${keywords.join(' ')} ${capability.id}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (!text.includes(word)) return { capability, score: -1 };
      if (name.startsWith(word)) score += 8;
      else if (name.includes(word)) score += 5;
      if (keywords.some((k) => k === word)) score += 6;
      else if (keywords.some((k) => k.startsWith(word))) score += 3;
      score += 1;
    }
    return { capability, score };
  });
  return scored
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.capability);
}
