'use client';
import { useMemo } from 'react';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import type { SortedResult } from 'fumadocs-core/search';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import searchSynonyms from '@/data/search-synonyms.json';

const SYNONYMS = searchSynonyms.synonyms as Record<string, string[]>;
const MAX_QUERIES = 4;

/** The query as typed, then with each word that has synonyms replaced by each of them. */
function expand(query: string): string[] {
  const words = query.trim().split(/\s+/);
  const queries = [query];
  words.forEach((word, i) => {
    for (const other of SYNONYMS[word.toLowerCase()] ?? []) {
      queries.push([...words.slice(0, i), other, ...words.slice(i + 1)].join(' '));
    }
  });
  return queries.slice(0, MAX_QUERIES);
}

/** Where a page ranks: guides and recipes before reference prose, and the generated API pages last. */
function rank(url: string): number {
  if (/^\/docs\/(get-started|guides)(\/|$)/.test(url)) return 0;
  if (/^\/docs\/recipes(\/|$)/.test(url)) return 1;
  if (/^\/docs\/reference\/(node|python|web|java)(\/|$)/.test(url)) return 4;
  if (/^\/docs\/reference(\/|$)/.test(url)) return 3;
  return 2;
}

/**
 * Results come as groups: a page, then its matching sections. Keeps the first group seen for each page, then orders
 * the groups: pages whose title has a searched word first, then by rank, then in the search's own order (the words
 * typed before their synonyms).
 */
function merge(lists: SortedResult[][], queries: string[]): SortedResult[] {
  const words = [...new Set(queries.flatMap((q) => q.toLowerCase().split(/\s+/)).filter((w) => w.length > 2))];
  const inTitle = (title: unknown) => words.some((w) => String(title).toLowerCase().includes(w));
  const seen = new Set<string>();
  const groups: SortedResult[][] = [];
  for (const list of lists) {
    let group: SortedResult[] | null = null;
    for (const item of list) {
      if (item.type === 'page') {
        group = seen.has(item.url) ? null : [];
        seen.add(item.url);
        if (group) groups.push(group);
      }
      group?.push(item);
    }
  }
  return groups
    .map((group, order) => ({ group, order, rank: rank(group[0]!.url) - (inTitle(group[0]!.content) ? 10 : 0) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .flatMap(({ group }) => group);
}

export default function DefaultSearchDialog(props: SharedProps) {
  const { locale } = useI18n(); // (optional) for i18n
  const client = useMemo(() => {
    const base = staticClient({ locale });
    return {
      deps: base.deps,
      async search(query: string) {
        const queries = expand(query);
        return merge(await Promise.all(queries.map((q) => base.search(q))), queries);
      },
    };
  }, [locale]);
  const { search, setSearch, query } = useDocsSearch({ client });

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
