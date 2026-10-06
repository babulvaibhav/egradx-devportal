import type { Metadata } from 'next';
import Link from 'next/link';
import { Initializr } from '@/components/initializr/initializr';

export const metadata: Metadata = {
  title: 'Start a project',
  description: 'Generate a Java, Node or Python project on the EGRADX SDK, with the capabilities you choose, ready to run.',
};

export default function StartPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Start a project</h1>
        <p className="max-w-3xl text-fd-muted-foreground">
          Choose a language and what the application needs, and download a project that builds, starts against
          PostgreSQL and signs you in, with a sample feature using each capability. You need{' '}
          <Link href="/docs/get-started/access" className="font-medium text-fd-foreground underline underline-offset-4">
            access to the packages
          </Link>{' '}
          first. Everything is generated in your browser; nothing is sent anywhere.
        </p>
      </header>
      <Initializr />
    </main>
  );
}
