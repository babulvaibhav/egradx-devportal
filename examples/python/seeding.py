"""This application's permissions, and a demo organization to sign in to."""

from collections.abc import Callable

from egradx.sdk import EgradxAuthorityDefinition, EgradxSdk

NOTE_READ = "note.read"
NOTE_WRITE = "note.write"
DEMO_ADMIN = "ada@example.com"


# docs:region seed-permission
async def seed(sdk: EgradxSdk, demo_password: str) -> None:
    """The application's permissions in the SDK's catalog, and a demo organization to sign in to (once)."""
    known = {authority["name"] for authority in await sdk.auth.roles.list_authorities()}
    if NOTE_READ not in known:
        await sdk.auth.roles.create_authority(EgradxAuthorityDefinition(NOTE_READ, "See the organization's notes", "note"))
    if NOTE_WRITE not in known:
        await sdk.auth.roles.create_authority(EgradxAuthorityDefinition(NOTE_WRITE, "Create, change and delete notes", "note"))
    if not await sdk.auth.people.user_id_by_username(DEMO_ADMIN):
        await sdk.auth.provisioning.provision_organization("Demo", DEMO_ADMIN, demo_password, "Ada Admin", admin_username=DEMO_ADMIN)


def grant_note_permissions_to_new_organizations(sdk: Callable[[], EgradxSdk]):
    """Every new organization's Admin role gets the application's permissions, in the same transaction."""
    async def listener(created, _connection) -> None:
        await sdk().auth.roles.add_authorities_to_role(created.organization_id, created.admin_role_name, [NOTE_READ, NOTE_WRITE])

    return listener
# docs:end
