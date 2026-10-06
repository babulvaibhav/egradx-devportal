import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { aiContextZip, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-semibold">
          EGRADX <span className="font-normal text-fd-muted-foreground">Developer Portal</span>
        </span>
      ),
    },
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'Get started', url: '/docs/get-started' },
      { text: 'Initializr', url: '/start' },
      { text: 'AI context pack', url: aiContextZip, external: true },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
