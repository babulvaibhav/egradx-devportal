'use client';

import { useRouter } from 'next/navigation';
import { Notes } from '../Notes';

export default function NotesPage() {
  const router = useRouter();
  return <Notes onSignedOut={() => router.replace('/login')} />;
}
