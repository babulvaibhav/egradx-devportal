-- egradx-auth migration, applied by the library itself into egradx_auth_schema_history (EgradxAuthSchemaMigrator).
-- Formerly the OIM application's V5__egradx_auth_platform_organization.sql, when applications had to create these tables themselves.

-- egradx-auth: the platform is now a real organization, not a flag plus a NULL convention.
--
-- Three changes, all of which the SDK's entities now require (ddl-auto=validate would fail
-- otherwise):
--
--   1. egradx_user.platform_owner is gone. Being a platform administrator is membership of the
--      platform organization — a property of a session, resolved per request — rather than a
--      property stored on a person. The column is NOT NULL with no default, so leaving it while
--      the entity no longer maps it would break every insert.
--
--   2. organization_id becomes NOT NULL on egradx_role and egradx_organization_membership. It was
--      nullable to mean "the platform", which quietly defeated both unique constraints below:
--      SQL NULL never equals NULL, so duplicate platform roles and repeated platform memberships
--      were undetectable. With the platform being an ordinary organization, those constraints
--      finally constrain it too.
--
--   3. egradx_user.updated_at is added — the SDK now tracks it, rather than callers fabricating
--      one from created_at.
--
-- This demo database is recreated from scratch, so there is nothing to migrate. A deployment with
-- real data would need to insert its platform organization, repoint its NULL-org roles and
-- memberships at it, and backfill updated_at, all before the NOT NULL constraints below.

ALTER TABLE egradx_user DROP COLUMN platform_owner;

ALTER TABLE egradx_user ADD COLUMN updated_at TIMESTAMP(6);
UPDATE egradx_user SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE egradx_user ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE egradx_role ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE egradx_organization_membership ALTER COLUMN organization_id SET NOT NULL;
