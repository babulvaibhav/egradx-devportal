import { useEffect, useState, type FormEvent } from 'react';
import { callAs, createQuery, EgradxApiError, unwrap, type AuthApi } from '@babulvaibhav/egradx-client';
import { Can, useAuth, useStore } from '@babulvaibhav/egradx-react';
import { egradx } from '../egradx';

type Role = AuthApi.components['schemas']['EgradxRoleDto'];
type InvitationPreview = AuthApi.components['schemas']['EgradxInvitationPreviewDto'];

// docs:region invite-someone
/** An administrator invites someone by email, with the role they will have. The SDK emails them a link. */
export function InviteSomeone() {
  const { snapshot } = useStore((client) => createQuery(client, () => callAs<Role[]>(client.auth.GET('/egradx/auth/my/roles'))), 'roles');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [result, setResult] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      unwrap(await egradx.auth.POST('/egradx/auth/my/invitations', { body: { email, roleId } }));
      setResult(`Invitation sent to ${email}.`);
    } catch (e) {
      const code = e instanceof EgradxApiError ? e.code : '';
      setResult(code === 'INVITATION_ALREADY_MEMBER' ? `${email} is already a member.`
        : code === 'INVITATION_DELIVERY_UNAVAILABLE' ? 'Email is not set up, so no invitation can be sent.'
        : (e as Error).message);
    }
  }
  return (
    <Can authority="egradx.user.manage">
      <form onSubmit={(event) => void submit(event)}>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Choose a role</option>
          {(snapshot.data ?? []).map((role) => <option key={role.id} value={role.id ?? ''}>{role.name}</option>)}
        </select>
        <button type="submit" disabled={!email || !roleId}>Invite</button>
        {result ? <p role="status">{result}</p> : null}
      </form>
    </Can>
  );
}
// docs:end

// docs:region accept-invitation
/**
 * /accept-invite?token=…: what the invitation is for, then joining. Someone new chooses a name and password; someone
 * with an account signs in as the invited address first, and joins with no body. Either way they get a session there.
 */
export function AcceptInvitation({ token, onJoined }: { token: string; onJoined: () => void }) {
  const { isAuthenticated, adopt } = useAuth();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    egradx.auth.GET('/egradx/auth/invitations/{token}', { params: { path: { token } } })
      .then((response) => setPreview(unwrap(response)))
      .catch((e: unknown) => setProblem(e instanceof EgradxApiError && e.code === 'INVITATION_EXPIRED'
        ? 'This invitation has expired: ask for a new one.' : 'This invitation is no longer valid.'));
  }, [token]);
  async function join(event: FormEvent) {
    event.preventDefault();
    const body = preview?.accountExists ? undefined : { name, password };
    try {
      adopt(unwrap(await egradx.auth.POST('/egradx/auth/invitations/{token}/accept', { params: { path: { token } }, body })));
      onJoined();
    } catch (e) {
      setProblem((e as Error).message);
    }
  }
  if (problem) return <p role="alert">{problem}</p>;
  if (!preview) return null;
  if (preview.accountExists && !isAuthenticated) {
    return <p>{preview.inviterName} invited {preview.email} to {preview.organizationName}. Sign in as {preview.email} to accept.</p>;
  }
  return (
    <form onSubmit={(event) => void join(event)}>
      <p>{preview.inviterName} invited you to {preview.organizationName} as {preview.roleName}.</p>
      {preview.accountExists ? null : (
        <>
          <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        </>
      )}
      <button type="submit">Join {preview.organizationName}</button>
    </form>
  );
}
// docs:end
