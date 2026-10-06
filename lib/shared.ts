import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'EGRADX Developer Portal';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

/** The repository the SDK and this portal live in. It is private: links to it work for its members. */
export const gitConfig = {
  user: 'babulvaibhav',
  repo: 'egradx-v1-workspace',
  branch: 'main',
};

/** Where this app sits in the repository, for "edit this page" links. */
export const appPath = 'apps/egradx-devportal';

/** The one edition of the SDK (it stays 1.0.0 until the full SDK is delivered), and what this build was made from. */
export const edition = {
  sdkVersion: '1.0.0',
  builtAt: new Date().toISOString().slice(0, 10),
  // Netlify sets COMMIT_REF on every build.
  commit: (process.env.COMMIT_REF ?? '').slice(0, 7) || 'local build',
};

/** The downloadable pack of Markdown for AI coding assistants (app/downloads/…/route.ts). */
export const aiContextZip = '/downloads/egradx-ai-context.zip';

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
