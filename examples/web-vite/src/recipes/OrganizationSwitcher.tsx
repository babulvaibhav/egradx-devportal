import { callAs, createQuery, type AuthApi } from '@babulvaibhav/egradx-client';
import { useAuth, useStore } from '@babulvaibhav/egradx-react';

type MyOrganization = AuthApi.components['schemas']['EgradxMyOrganizationDto'];

// docs:region switch-organization
/**
 * The organizations the signed-in person belongs to, and a switch between them. Switching issues new tokens; every SDK
 * hook starts over for the new organization. Clear your own caches too (sessionScope(session) changes).
 */
export function OrganizationSwitcher({ onSwitched }: { onSwitched: () => void }) {
  const { session, switchOrganization } = useAuth();
  const { snapshot } = useStore(
    (client) => createQuery(client, () => callAs<MyOrganization[]>(client.auth.GET('/egradx/auth/my/organizations'))),
    'my-organizations',
  );
  const organizations = snapshot.data ?? [];
  if (organizations.length < 2) return null;
  return (
    <select
      value={session?.organizationId ?? ''}
      onChange={(event) => void switchOrganization(event.target.value).then(onSwitched)}
    >
      {organizations.map((organization) => (
        <option key={organization.organizationId} value={organization.organizationId ?? ''} disabled={organization.status !== 'ACTIVE'}>
          {organization.name}
        </option>
      ))}
    </select>
  );
}
// docs:end
