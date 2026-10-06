// The portal's recipes for the browser (type-checked with the example frontend; not part of the generated project).
import { useState, type FormEvent } from 'react';
import { EgradxApiError, unwrap } from '@babulvaibhav/egradx-client';
import { egradx } from '../lib/egradx';

// docs:region forgot-password
/** "Forgot your password?": always the same answer, so it reveals no accounts. The email links to /reset-password. */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    unwrap(await egradx.auth.POST('/egradx/auth/password/forgot', { body: { email } }));
    setSent(true);
  }
  if (sent) return <p>If an account uses that address, a link to choose a new password is on its way.</p>;
  return (
    <form onSubmit={(event) => void submit(event)}>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <button type="submit">Send the link</button>
    </form>
  );
}
// docs:end

// docs:region reset-password
/** /reset-password?token=…: a new password, which ends every session; then sign in again. */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      unwrap(await egradx.auth.POST('/egradx/auth/password/reset', { body: { token, newPassword: password } }));
      onDone();
    } catch (e) {
      const code = e instanceof EgradxApiError ? e.code : '';
      setError(code === 'PASSWORD_RESET_EXPIRED' ? 'This link has expired: ask for a new one.'
        : code === 'PASSWORD_RESET_INVALID' ? 'This link has been used or replaced: ask for a new one.'
        : code === 'PASSWORD_INVALID' ? 'Use 8 to 128 characters.'
        : (e as Error).message);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit">Save it</button>
    </form>
  );
}
// docs:end
