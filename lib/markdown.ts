import { readRegion, readWhole } from './snippets';
import { aiContextZip } from './shared';
import { LANGUAGE_LABELS, readRun } from './results';
import parity from '@/data/parity.json';

const MARKS: Record<string, string> = { yes: 'yes', partial: 'partly', planned: 'planned', no: 'no', na: 'n/a' };
interface ParityRow {
  id: string;
  name: string;
  area: string;
  java: string;
  node: string;
  python: string;
  web: string;
  notes?: Record<string, string>;
}
const PARITY = parity.capabilities as ParityRow[];

function parityLine(id: string): string {
  const row = PARITY.find((entry) => entry.id === id);
  if (!row) return '';
  const parts = (['java', 'node', 'python', 'web'] as const)
    .filter((key) => row[key] !== 'na')
    .map((key) => `${key[0]!.toUpperCase()}${key.slice(1)}: ${MARKS[row[key]]}${row.notes?.[key] ? ` (${row.notes[key]})` : ''}`);
  return `Available in — ${parts.join('; ')}.`;
}

function parityTable(): string[] {
  const lines = ['| Capability | Java | Node | Python | Web |', '|---|---|---|---|---|'];
  for (const row of PARITY) {
    lines.push(`| ${row.area}: ${row.name} | ${MARKS[row.java]} | ${MARKS[row.node]} | ${MARKS[row.python]} | ${MARKS[row.web]} |`);
  }
  return lines;
}

/**
 * A page's processed Markdown, made plain for AI tools and the context pack: the MDX components become Markdown —
 * language tabs become labelled sections, OIM excerpts become code blocks, callouts become quotes — and the
 * indentation the components added is removed, so code blocks are code blocks again.
 */
export function plainMarkdown(text: string): string {
  const out: string[] = [];
  const open: string[] = [];
  let inFence = false;
  // A Mermaid chart's lines, while its <Mermaid chart={`…`} /> is being read.
  let mermaid: string[] | undefined;
  const chartEnd = /`\}\s*\/>\s*$/;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (mermaid) {
      if (chartEnd.test(raw)) {
        out.push('```mermaid', ...mermaid, raw.replace(chartEnd, '').trimEnd(), '```');
        mermaid = undefined;
      } else {
        mermaid.push(raw);
      }
      continue;
    }
    const indent = '  '.repeat(open.length);
    const line = raw.startsWith(indent) ? raw.slice(indent.length) : raw.trimStart();
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
    }
    if (!inFence) {
      const chart = /^<Mermaid chart=\{`(.*)$/.exec(line);
      if (chart) {
        if (chartEnd.test(chart[1]!)) {
          out.push('```mermaid', chart[1]!.replace(chartEnd, ''), '```');
        } else {
          mermaid = [chart[1]!];
        }
        continue;
      }
      const card = /^<Card\s([^>]*)>(.*)<\/Card>\s*$/.exec(line);
      if (card) {
        out.push(`- **[${attribute(card[1]!, 'title')}](${attribute(card[1]!, 'href')})**: ${card[2]!.trim()}`);
        continue;
      }
      const opening = /^<(Steps|Step|Languages|Tab|Cards|Card|Callout)(\s[^>]*)?>\s*$/.exec(line);
      if (opening) {
        open.push(opening[1]!);
        const attributes = opening[2] ?? '';
        if (opening[1] === 'Tab') {
          out.push(`**${attribute(attributes, 'value')}**`, '');
        } else if (opening[1] === 'Card') {
          out.push(`**[${attribute(attributes, 'title')}](${attribute(attributes, 'href')})**`);
        } else if (opening[1] === 'Callout') {
          const title = attribute(attributes, 'title');
          out.push(title ? `> **${title}**` : '> **Note**');
        }
        continue;
      }
      if (/^<\/(Steps|Step|Languages|Tab|Cards|Card|Callout)>\s*$/.test(line)) {
        open.pop();
        out.push('');
        continue;
      }
      const snippet = /^<RepoSnippet\s([^>]*?)\/>\s*$/.exec(line);
      if (snippet) {
        const file = attribute(snippet[1]!, 'file');
        const region = attribute(snippet[1]!, 'region');
        const { code, line: at } = region ? readRegion(file, region) : readWhole(file);
        const extension = file.split('.').pop() ?? '';
        const language =
          ({ java: 'java', py: 'python', ts: 'ts', tsx: 'tsx', xml: 'xml', yml: 'yaml', toml: 'toml', prisma: 'prisma', sql: 'sql', html: 'html', json: 'json' } as Record<string, string>)[
            extension
          ] ?? '';
        out.push(`From \`${file}\` (line ${at}):`, '', `\`\`\`${language}`, code, '```');
        continue;
      }
      const recorded = /^<RecordedRun\s([^>]*?)\/>\s*$/.exec(line);
      if (recorded) {
        // The first language's answers; the capture script checks the others answer the same.
        const run = readRun(attribute(recorded[1]!, 'name'));
        const [language, all] = Object.entries(run.languages)[0]!;
        const only = /steps=\{\[([^\]]*)\]\}/.exec(recorded[1]!)?.[1]?.match(/'[^']+'|"[^"]+"/g)?.map((name) => name.slice(1, -1));
        const steps = only ? all.filter((step) => only.includes(step.name)) : all;
        out.push(`Recorded from the example applications (${LANGUAGE_LABELS[language] ?? language} shown; the other languages answer the same):`, '');
        for (const step of steps) {
          out.push(`${step.title ?? step.name}: \`${step.request.method} ${step.request.path}\`${step.request.as ? ` as ${step.request.as}` : ''} → ${step.response.status}`,
            '', '```json', JSON.stringify(step.response.body, null, 2), '```', '');
        }
        continue;
      }
      const screenshot = /^<Screenshot\s([^>]*?)\/>\s*$/.exec(line);
      if (screenshot) {
        const caption = attribute(screenshot[1]!, 'caption');
        out.push(`![${attribute(screenshot[1]!, 'alt')}](/screens/${attribute(screenshot[1]!, 'name')}-light.png)`);
        if (caption) {
          out.push('', `*${caption}*`);
        }
        continue;
      }
      const badge = /^<Parity\s+id="([^"]+)"\s*\/>\s*$/.exec(line);
      if (badge) {
        out.push(parityLine(badge[1]!));
        continue;
      }
      if (/^<ParityMatrix\s*\/>\s*$/.test(line)) {
        out.push(...parityTable());
        continue;
      }
      if (/^<AiContextDownload\s*\/>\s*$/.test(line)) {
        out.push(`Download: ${aiContextZip}`);
        continue;
      }
    }
    const inCallout = open.includes('Callout');
    // Headings carry the site's anchor ids ("### Run it [#run-it]"): not wanted in plain Markdown.
    const cleaned = inFence ? line : line.replace(/ \[#[A-Za-z0-9_-]+\]$/, '');
    out.push(inCallout && !inFence ? `> ${cleaned}`.trimEnd() : cleaned);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function attribute(attributes: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1] ?? '';
}
