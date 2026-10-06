import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import { readRegion, readWhole, sourceUrl } from '@/lib/snippets';
import { gitConfig } from '@/lib/shared';

const LANGUAGES: Record<string, string> = {
  java: 'java', ts: 'ts', tsx: 'tsx', py: 'python', yml: 'yaml', yaml: 'yaml', sql: 'sql', xml: 'xml', toml: 'toml', prisma: 'prisma',
  html: 'html', txt: 'text', json: 'json', md: 'md', css: 'css', mjs: 'js', js: 'js',
};

/**
 * A region of a file in this repository, highlighted at build time, with where it comes from:
 *
 *   <RepoSnippet file="apps/egradx-oim/backend-node/src/products.ts" region="create-product" />
 *
 * Without a region, the whole file.
 */
export async function RepoSnippet({ file, region, lang, title }: { file: string; region?: string; lang?: string; title?: string }) {
  const { code, line } = region ? readRegion(file, region) : readWhole(file);
  const extension = file.split('.').pop() ?? '';
  return (
    <figure className="not-prose my-4">
      <ServerCodeBlock code={code} lang={lang ?? LANGUAGES[extension] ?? 'text'} codeblock={{ title: title ?? file }} />
      <figcaption className="mt-1 text-xs text-fd-muted-foreground">
        From{' '}
        <a className="underline underline-offset-2" href={sourceUrl(file, line, gitConfig)}>
          {file}:{line}
        </a>{' '}
        — cut from the code at build time, so it is what runs.
      </figcaption>
    </figure>
  );
}
