import type { Egradx } from '@babulvaibhav/egradx-sdk';

export const NOTE_READ = 'note.read';
export const NOTE_WRITE = 'note.write';
export const DEMO_ADMIN = 'ada@example.com';

// docs:region seed-permission
/** The application's permissions in the SDK's catalog, and a demo organization to sign in to (once). */
export async function seed(egradx: Egradx, demoPassword: string): Promise<void> {
  const known = new Set((await egradx.auth.roles.listAuthorities()).map((authority) => authority.name));
  if (!known.has(NOTE_READ)) {
    await egradx.auth.roles.createAuthority({ name: NOTE_READ, description: "See the organization's notes", category: 'note' });
  }
  if (!known.has(NOTE_WRITE)) {
    await egradx.auth.roles.createAuthority({ name: NOTE_WRITE, description: 'Create, change and delete notes', category: 'note' });
  }
  if (!(await egradx.auth.people.userIdByUsername(DEMO_ADMIN))) {
    await egradx.auth.provisioning.provisionOrganization({
      name: 'Demo',
      admin: { username: DEMO_ADMIN, email: DEMO_ADMIN, password: demoPassword, name: 'Ada Admin' },
    });
  }
}

/** Every new organization's Admin role gets the application's permissions, in the same transaction. */
export function grantNotePermissionsToNewOrganizations(egradx: () => Egradx) {
  return async (created: { organizationId: string; adminRoleName: string }) => {
    await egradx().auth.roles.addAuthoritiesToRole(created.organizationId, created.adminRoleName, [NOTE_READ, NOTE_WRITE]);
  };
}
// docs:end
