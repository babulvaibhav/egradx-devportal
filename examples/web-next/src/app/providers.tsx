'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { EgradxProvider } from '@babulvaibhav/egradx-react';
import { egradx } from '@/lib/egradx';

/** The SDK client for every screen. The screens render in the browser only: the session lives there. */
export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <EgradxProvider client={egradx}>{children}</EgradxProvider>;
}
