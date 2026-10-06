import Link from 'next/link';
import { aiContextZip, edition } from '@/lib/shared';

const LANGUAGES = [
  { name: 'Java', stack: 'Spring Boot 3.4 · Maven', href: '/docs/get-started/quickstart-java' },
  { name: 'Node', stack: 'Express 5 · TypeScript · Prisma', href: '/docs/get-started/quickstart-node' },
  { name: 'Python', stack: 'FastAPI · SQLAlchemy · uv', href: '/docs/get-started/quickstart-python' },
];

const CAPABILITIES = [
  ['Sign-in & identity', 'Users, organizations, roles and permissions, invitations, password reset, profiles, sessions.'],
  ['Audit trail', 'Append-only records written with the change, filters, history, export, retention.'],
  ['Notifications', 'In-app inbox with a live bell, email, Slack, SMS, WhatsApp, templates, preferences.'],
  ['Events', 'CloudEvents through a transactional outbox; in-process, RabbitMQ or Kafka by configuration.'],
  ['Observability', 'Request ids, traces, metrics and log shipping, the same names in every language.'],
  ['Web', 'Client, React hooks, a Next.js backend-for-frontend, and copy-in screens.'],
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-6 py-16">
      <section className="flex flex-col gap-5">
        <p className="text-sm font-medium text-fd-muted-foreground">EGRADX SDK {edition.sdkVersion}</p>
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Build business logic. The SDK does the rest.</h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          Sign-in, permissions, audit, notifications, events and observability, as libraries inside your Java, Node or
          Python application — one database, no extra services to run. Learn it here, see how OIM uses it, and copy what
          works.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/docs/get-started" className="rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground">
            Get started
          </Link>
          <Link href="/start" className="rounded-lg border px-5 py-2.5 font-medium">
            Generate a project
          </Link>
          <Link href="/docs" className="rounded-lg border px-5 py-2.5 font-medium">
            Read the docs
          </Link>
          <a href={aiContextZip} download className="rounded-lg border px-5 py-2.5 font-medium">
            Download the AI context pack
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Pick your language</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {LANGUAGES.map((language) => (
            <Link key={language.name} href={language.href} className="rounded-xl border bg-fd-card p-5 transition-colors hover:bg-fd-accent">
              <div className="text-lg font-semibold">{language.name}</div>
              <div className="text-sm text-fd-muted-foreground">{language.stack}</div>
              <div className="mt-3 text-sm font-medium">Quickstart →</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">What the SDK gives every application</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(([title, text]) => (
            <div key={title} className="rounded-xl border p-5">
              <div className="font-semibold">{title}</div>
              <p className="mt-1 text-sm text-fd-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-fd-card p-6">
        <h2 className="text-xl font-semibold">Working with an AI assistant?</h2>
        <p className="mt-2 text-fd-muted-foreground">
          Download the AI context pack into your project: the SDK&apos;s rules, every page of this portal as Markdown, and
          the contracts. Claude Code, Copilot and Cursor then build on the SDK instead of re-implementing it.{' '}
          <Link href="/docs/ai-assistants" className="underline underline-offset-2">
            How to use it
          </Link>
        </p>
      </section>

      <footer className="text-sm text-fd-muted-foreground">
        SDK {edition.sdkVersion} · built {edition.builtAt} from {edition.commit}
      </footer>
    </main>
  );
}
