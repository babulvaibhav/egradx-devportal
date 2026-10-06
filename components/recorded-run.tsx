import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import { LANGUAGE_LABELS, readRun } from '@/lib/results';
import { Languages, Tab } from './languages';

/**
 * What the example applications actually answered, per language, as recorded by scripts/capture.mjs:
 *
 *   <RecordedRun name="first-endpoint" />
 */
export async function RecordedRun({ name, steps }: { name: string; steps?: string[] }) {
  const run = readRun(name);
  const languages = Object.keys(run.languages);
  return (
    <div className="my-4">
      <Languages items={languages.map((language) => LANGUAGE_LABELS[language] ?? language)}>
        {languages.map((language) => (
          <Tab key={language} value={LANGUAGE_LABELS[language] ?? language}>
            {run.languages[language]!.filter((step) => !steps || steps.includes(step.name)).map((step) => (
              <div key={step.name} className="mb-4">
                <p className="mb-1 text-sm font-medium">{step.title ?? step.name}</p>
                <p className="mb-1 font-mono text-xs text-fd-muted-foreground">
                  {step.request.method} {step.request.path}
                  {step.request.as ? ` — as ${step.request.as}` : ''} → {step.response.status}
                </p>
                <ServerCodeBlock lang="json" code={JSON.stringify(step.response.body, null, 2)} />
              </div>
            ))}
          </Tab>
        ))}
      </Languages>
      <p className="mt-1 text-xs text-fd-muted-foreground">
        Recorded from the example applications on {run.capturedAt.slice(0, 10)} (SDK {run.sdkVersion}) — the same answers in every
        language, checked by the capture script.
      </p>
    </div>
  );
}
