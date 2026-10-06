import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import type { MDXComponents } from 'mdx/types';
import { Languages, Tab } from './languages';
import { RepoSnippet } from './repo-snippet';
import { AiContextDownload } from './ai-context-download';
import { RecordedRun } from './recorded-run';
import { Screenshot } from './screenshot';
import { Mermaid } from './mermaid';
import { Parity, ParityMatrix } from './parity';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Languages,
    Tab,
    Steps,
    Step,
    RepoSnippet,
    AiContextDownload,
    RecordedRun,
    Screenshot,
    Mermaid,
    Parity,
    ParityMatrix,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
