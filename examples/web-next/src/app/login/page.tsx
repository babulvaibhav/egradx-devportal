'use client';

import { useRouter } from 'next/navigation';
import { LoginForm } from '@/modules/auth/LoginForm';

export default function LoginPage() {
  const router = useRouter();
  return (
    <LoginForm
      onSignedIn={() => {
        // Back where the proxy sent them from, if that was a page of this application.
        const next = new URLSearchParams(window.location.search).get('next');
        router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      }}
    />
  );
}
