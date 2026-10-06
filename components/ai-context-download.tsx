import { aiContextZip, edition } from '@/lib/shared';

/** The download button for the AI context pack. */
export function AiContextDownload() {
  return (
    <div className="not-prose my-4 flex flex-wrap items-center gap-3 rounded-xl border bg-fd-card p-4">
      <a
        href={aiContextZip}
        download
        className="inline-flex items-center rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
      >
        Download egradx-ai-context.zip
      </a>
      <span className="text-sm text-fd-muted-foreground">
        SDK {edition.sdkVersion} · built {edition.builtAt} from {edition.commit}
      </span>
    </div>
  );
}
