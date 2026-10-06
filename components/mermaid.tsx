'use client';

import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

/**
 * A Mermaid diagram (sequence diagrams for sign-in, refresh, the outbox, the bell), drawn in the browser in the
 * reader's theme. Mermaid is loaded only on pages that have one.
 *
 *   <Mermaid chart={`sequenceDiagram
 *     Browser->>API: POST /egradx/auth/login`} />
 */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        fontFamily: 'inherit',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
      });
      try {
        const { svg: drawn } = await mermaid.render(`mermaid-${id}`, chart.replaceAll('\\n', '\n'));
        if (!cancelled) setSvg(drawn);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (error) {
    return <pre className="my-6 overflow-auto rounded-xl border p-4 text-sm">{chart}</pre>;
  }
  return (
    <figure
      className="not-prose my-6 flex justify-center overflow-x-auto rounded-xl border bg-fd-card p-4 [&_svg]:max-w-full"
      // Mermaid's own SVG output, rendered with securityLevel 'strict' from a chart written in this repository.
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label="Diagram"
    />
  );
}
