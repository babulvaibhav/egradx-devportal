import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { source } from '@/lib/source';
import { edition } from '@/lib/shared';
import { repoFile } from '@/lib/snippets';
import { plainMarkdown } from '@/lib/markdown';

export const revalidate = false;

/** The contracts an assistant needs to call the SDK's API and read its errors and events. */
const CONTRACTS = [
  'schemas/error.json',
  'schemas/error-codes.json',
  'schemas/jwt-claims.json',
  'schemas/headers.md',
  'schemas/enums.json',
  'openapi/auth.yaml',
  'openapi/audit.yaml',
  'openapi/notification.yaml',
  'events/asyncapi.yaml',
  'events/schemas/cloudevent.json',
  'events/schemas/egradx.log.record.v1.json',
];

/**
 * The AI context pack: the rules (ai-pack/AGENTS.md), every page of the portal as Markdown, and the contracts, in one
 * folder a developer unzips into their project. Built with the site, so it always matches it.
 */
export async function GET() {
  const zip = new JSZip();
  const folder = zip.folder('egradx-sdk-docs')!;
  const stamp = `SDK ${edition.sdkVersion} · built ${edition.builtAt} from ${edition.commit}`;
  const pack = path.join(process.cwd(), 'ai-pack');
  folder.file('README.md', `${readFileSync(path.join(pack, 'README.md'), 'utf8')}\n---\n${stamp}\n`);
  folder.file('AGENTS.md', `${readFileSync(path.join(pack, 'AGENTS.md'), 'utf8')}\n---\n${stamp}\n`);
  for (const page of source.getPages()) {
    const name = page.slugs.length === 0 ? 'index' : page.slugs.join('/');
    const description = page.data.description ? `\n${page.data.description}\n` : '';
    folder.file(`docs/${name}.md`, `# ${page.data.title}\n${description}\n${plainMarkdown(await page.data.getText('processed'))}`);
  }
  for (const contract of CONTRACTS) {
    folder.file(`contracts/${contract}`, readFileSync(repoFile(`contracts/${contract}`), 'utf8'));
  }
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return new Response(bytes, {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="egradx-ai-context.zip"' },
  });
}
