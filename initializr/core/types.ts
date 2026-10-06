/**
 * The Initializr's model. One manifest (initializr/manifest.json) drives the page, its search and the generator, so a
 * capability added there appears everywhere at once.
 */

export type LanguageId = 'java' | 'node' | 'python';
export type FrontendId = 'none' | 'vite' | 'next';

export interface Language {
  id: LanguageId;
  name: string;
  /** "Java 21 · Spring Boot 3.4 · Maven" */
  detail: string;
}

export interface CapabilityOption {
  id: string;
  name: string;
  values: { id: string; name: string; description: string }[];
  default: string;
}

export interface Capability {
  id: string;
  name: string;
  /** The heading it is listed under. */
  group: string;
  description: string;
  /** Words developers search with ("login" finds sign-in). */
  keywords: string[];
  /** Only these languages offer it; all when absent. */
  languages?: LanguageId[];
  /** Part of every project (the SDK's core): shown, never removable. */
  always?: boolean;
  /** Capabilities added with it, with the reason shown to the developer. */
  requires?: { id: string; reason: string }[];
  options?: CapabilityOption[];
  /** The portal page about it. */
  docs?: string;
}

export interface Frontend {
  id: FrontendId;
  name: string;
  description: string;
}

export interface Extra {
  id: string;
  name: string;
  description: string;
  default: boolean;
}

/**
 * A file of a template set. `when` lists conditions that must all hold:
 *   cap:<id>  !cap:<id>  option:<capability>.<option>=<value>  frontend:<id>  frontend:any  extra:<id>  !extra:<id>
 * `to` is rendered like the file's content, so it may use {{project.packagePath}}. A `raw` file is copied as it is.
 * A language's files go under backend/ and a frontend's under frontend/, unless `root` keeps one at the project's root.
 */
export interface TemplateFile {
  from: string;
  to: string;
  when?: string[];
  raw?: boolean;
  executable?: boolean;
  root?: boolean;
}

export interface Manifest {
  sdkVersion: string;
  languages: Language[];
  capabilities: Capability[];
  frontends: Frontend[];
  extras: Extra[];
  /** Template sets: one per language, one per frontend, and `common` for every project. */
  files: Record<string, TemplateFile[]>;
}

export interface Selection {
  language: LanguageId;
  /** Java's groupId; the other languages ignore it. */
  group: string;
  /** The project's folder and package name: lower case, digits and dashes. */
  artifact: string;
  name: string;
  description: string;
  /** Java's package; derived from group and artifact unless set. */
  packageName: string;
  /** Chosen capabilities, without the `always` ones. */
  capabilities: string[];
  /** capabilityId.optionId → value */
  options: Record<string, string>;
  frontend: FrontendId;
  extras: string[];
}

export interface GeneratedFile {
  path: string;
  content: string;
  executable?: boolean;
}
