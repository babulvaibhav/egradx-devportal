'use client';

import { useRouter } from 'next/navigation';
import { Notes } from '@/modules/notes/Notes';

export default function NotesPage() {
  const router = useRouter();
  return <Notes onSignedOut={() => router.replace('/login')} />;
}
