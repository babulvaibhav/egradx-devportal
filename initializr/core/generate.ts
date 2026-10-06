import Handlebars from 'handlebars';
import { packageNameOf, resolve } from './selection.ts';
import type { GeneratedFile, Manifest, Selection, TemplateFile } from './types.ts';

/** What every template sees. */
export interface TemplateContext {
  sdkVersion: string;
  language: Selection['language'];
  project: {
    group: string;
    artifact: string;
    name: string;
    description: string;
    /** Java: com.example.demo */
    packageName: string;
    /** Java: com/example/demo */
    packagePath: string;
    /** Python's module, and the prefix of the project's own tables: demo, my_app */
    module: string;
    /** The prefix of its audit actions, event types and message keys, letters and digits only: demo, myapp */
    area: string;
    /** DemoApplication */
    className: string;
    /** Demo */
    title: string;
  };
  /** capability id → true, for {{#if cap.events}} */
  cap: Record<string, boolean>;
  /** capability id → option id → value, for {{#if (eq option.events.transport "kafka")}} */
  option: Record<string, Record<string, string>>;
  frontend: Selection['frontend'] | false;
  extra: Record<string, boolean>;
}

const handlebars = Handlebars.create();
handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(Boolean));
handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
handlebars.registerHelper('not', (a: unknown) => !a);

function pascal(words: string): string {
  return words
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');
}

export function contextOf(manifest: Manifest, chosen: Selection): TemplateContext {
  const selection = resolve(manifest, chosen).selection;
  const packageName = packageNameOf(selection);
  const moduleName = selection.artifact.replace(/-/g, '_');
  const cap: Record<string, boolean> = {};
  for (const capability of manifest.capabilities) {
    const offered = !capability.languages || capability.languages.includes(selection.language);
    cap[capability.id] = offered && (capability.always === true || selection.capabilities.includes(capability.id));
  }
  const option: Record<string, Record<string, string>> = {};
  for (const [key, value] of Object.entries(selection.options)) {
    const [capability, id] = key.split('.') as [string, string];
    (option[capability] ??= {})[id] = value;
  }
  return {
    sdkVersion: manifest.sdkVersion,
    language: selection.language,
    project: {
      group: selection.group,
      artifact: selection.artifact,
      name: selection.name.trim(),
      description: selection.description.trim(),
      packageName,
      packagePath: packageName.replace(/\./g, '/'),
      module: moduleName,
      area: selection.artifact.replace(/[^a-z0-9]/g, '') || 'app',
      className: `${pascal(selection.artifact) || 'Demo'}Application`,
      title: pascal(selection.artifact) || 'Demo',
    },
    cap,
    option,
    frontend: selection.frontend === 'none' ? false : selection.frontend,
    extra: Object.fromEntries(manifest.extras.map((e) => [e.id, selection.extras.includes(e.id)])),
  };
}

/** Whether a file's conditions hold. */
export function applies(file: TemplateFile, context: TemplateContext): boolean {
  return (file.when ?? []).every((condition) => {
    const negated = condition.startsWith('!');
    const [kind, value] = (negated ? condition.slice(1) : condition).split(':') as [string, string];
    let holds: boolean;
    switch (kind) {
      case 'cap':
        holds = context.cap[value] === true;
        break;
      case 'option': {
        const [path, expected] = value.split('=') as [string, string];
        const [capability, id] = path.split('.') as [string, string];
        holds = context.cap[capability] === true && context.option[capability]?.[id] === expected;
        break;
      }
      case 'frontend':
        holds = value === 'any' ? context.frontend !== false : context.frontend === value;
        break;
      case 'extra':
        holds = context.extra[value] === true;
        break;
      default:
        throw new Error(`Unknown condition "${condition}" on ${file.from}`);
    }
    return negated ? !holds : holds;
  });
}

const compiled = new Map<string, HandlebarsTemplateDelegate>();
function render(name: string, source: string, context: TemplateContext): string {
  let template = compiled.get(source);
  if (!template) {
    try {
      template = handlebars.compile(source, { noEscape: true, strict: false });
    } catch (error) {
      throw new Error(`Template ${name}: ${(error as Error).message}`);
    }
    compiled.set(source, template);
  }
  return template(context);
}

/**
 * Handlebars already drops a block tag standing on its own line; this collapses what two adjacent false blocks can
 * leave: never more than two blank lines in a row (Python's spacing between definitions).
 */
function tidy(text: string): string {
  return `${text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').replace(/^\n+/, '').trimEnd()}\n`;
}

/** A line that only marks a region for the developer portal: "// docs:region x", "# docs:end", "<!-- docs:end -->". */
const DOCS_MARKER = /^[ \t]*(?:\/\/|#|<!--|\{\/\*|--)[ \t]*docs:(?:region[ \t]+[A-Za-z0-9_-]+|end)\b.*\n/gm;

export interface GenerateOptions {
  /**
   * Keep the "docs:region" lines the portal cuts its code with. Only the portal's own example applications keep them;
   * a downloaded project has none.
   */
  keepDocsRegions?: boolean;
}

/**
 * The project for a selection: every file of the language's set (under backend/), the frontend's (under frontend/) and
 * the common one (at the root) whose conditions hold, rendered with the selection. `templates` maps each template's
 * `from` to its text.
 */
export function generate(
  manifest: Manifest,
  selection: Selection,
  templates: Record<string, string>,
  options: GenerateOptions = {},
): GeneratedFile[] {
  const context = contextOf(manifest, selection);
  const sets: [string, string][] = [
    ['common', ''],
    [context.language, 'backend/'],
  ];
  if (context.frontend) sets.push([`frontend-${context.frontend}`, 'frontend/']);
  const files = new Map<string, GeneratedFile>();
  for (const [set, prefix] of sets) {
    for (const file of manifest.files[set] ?? []) {
      if (!applies(file, context)) continue;
      const source = templates[file.from];
      if (source === undefined) throw new Error(`The manifest names a template that does not exist: ${file.from}`);
      const path = (file.root ? '' : prefix) + render(`${file.from} (path)`, file.to, context);
      let content = file.raw ? source : tidy(render(file.from, source, context));
      if (!options.keepDocsRegions) content = content.replace(DOCS_MARKER, '');
      // Windows batch files need CRLF for their labels; the templates are kept in LF like the rest of the repository.
      if (/\.(cmd|bat)$/.test(path)) content = content.replace(/\r?\n/g, '\r\n');
      files.set(path, { path, content, ...(file.executable ? { executable: true } : {}) });
    }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
