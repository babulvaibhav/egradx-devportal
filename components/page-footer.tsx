import { edition, gitConfig } from '@/lib/shared';

/**
 * Under every page: which edition of the SDK it describes, and a way to report a problem with it. There is no backend,
 * so the report is a GitHub issue, opened already titled with the page.
 */
export function PageFooter({ title, url }: { title: string; url: string }) {
  const issue = new URLSearchParams({
    title: `Portal: ${title}`,
    body: `Page: ${url}\nEdition: SDK ${edition.sdkVersion}, built ${edition.builtAt} from ${edition.commit}\n\nWhat is wrong or missing:\n`,
    labels: 'devportal',
  });
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm text-fd-muted-foreground">
      <span>
        SDK {edition.sdkVersion} · built {edition.builtAt} from {edition.commit}
      </span>
      <a
        href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/issues/new?${issue.toString()}`}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4 hover:text-fd-foreground"
      >
        Report a problem with this page
      </a>
    </div>
  );
}
