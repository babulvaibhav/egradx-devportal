import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import type { ReactNode } from 'react';

/** The SDK's languages, in the order every page shows them. */
export const LANGUAGES = ['Java', 'Node', 'Python'] as const;

/**
 * Tabs per language. Every set on a page switches together, and the choice is remembered in the browser, so a reader
 * picks their language once.
 *
 *   <Languages>
 *     <Tab value="Java">…</Tab>
 *     <Tab value="Node">…</Tab>
 *     <Tab value="Python">…</Tab>
 *   </Languages>
 */
export function Languages({ children, items = [...LANGUAGES] }: { children: ReactNode; items?: string[] }) {
  return (
    <Tabs groupId="language" persist items={items}>
      {children}
    </Tabs>
  );
}

export { Tab };
