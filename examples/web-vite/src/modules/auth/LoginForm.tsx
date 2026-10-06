'use client';

import { useState, type FormEvent } from 'react';
import { EgradxApiError } from '@babulvaibhav/egradx-client';
import { useAuth } from '@babulvaibhav/egradx-react';

interface OrganizationChoice {
  organizationId: string;
  name: string;
  status: string;
}

// docs:region web-sign-in
/** Sign-in, with the choice of organization the SDK asks for when someone belongs to several. */
export function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [organizations, setOrganizations] = useState<OrganizationChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice] = useState(() => {
    const reason = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem('signedOutReason');
    if (reason) sessionStorage.removeItem('signedOutReason');
    return reason;
  });

  async function signIn(organizationId?: string) {
    setError(null);
    try {
      await login({ username, password, organizationId });
      onSignedIn();
    } catch (e) {
      if (e instanceof EgradxApiError && e.code === 'ORG_SELECTION_REQUIRED') {
        setOrganizations((e.details as { organizations: OrganizationChoice[] }).organizations);
      } else if (e instanceof EgradxApiError && e.code === 'AUTH_INVALID_CREDENTIALS') {
        setError('That email and password do not match.');
      } else {
        setError(e instanceof Error ? e.message : 'Signing in failed.');
      }
    }
  }
  // docs:end

  if (organizations) {
    return (
      <main className="card narrow">
        <h1>Choose an organization</h1>
        {organizations.map((organization) => (
          <button
            key={organization.organizationId}
            className="choice"
            disabled={organization.status !== 'ACTIVE'}
            onClick={() => void signIn(organization.organizationId)}
          >
            {organization.name}
          </button>
        ))}
      </main>
    );
  }

  return (
    <main className="card narrow">
      <h1>Sign in</h1>
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void signIn();
        }}
      >
        <label>
          Email
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="submit">Sign in</button>
      </form>
      <p className="muted">The demo: ada@example.com / demo-password</p>
    </main>
  );
}
