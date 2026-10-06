import { readFileSync, readdirSync } from 'node:fs';
import { repoFile } from '@/lib/snippets';

export const revalidate = false;
export const dynamicParams = false;

/** The copy-in screens' shadcn registry, built in sdks/web/packages/ui and copied into sources/ by sync-sources. */
const REGISTRY = 'sdks/web/packages/ui/public/r';

export function generateStaticParams() {
  return readdirSync(repoFile(REGISTRY))
    .filter((name) => name.endsWith('.json'))
    .map((item) => ({ item }));
}

/**
 * One registry item, for `npx shadcn@latest add <portal>/r/notification-bell.json`: the item's files are inside it,
 * so the CLI needs nothing else from here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ item: string }> }) {
  const { item } = await params;
  return new Response(readFileSync(repoFile(`${REGISTRY}/${item}`), 'utf8'), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
