-- egradx-auth migration, applied by the library itself into egradx_auth_schema_history (EgradxAuthSchemaMigrator).
-- Formerly the OIM application's V1__egradx_auth_schema.sql, when applications had to create these tables themselves.

-- Schema for the tables owned by com.egradx:egradx-auth.
--
-- Applications run with spring.jpa.hibernate.ddl-auto=validate, so the DDL below has to match the
-- library's entities exactly — and validate is what makes that safe: if an entity changes without a
-- migration, startup fails loudly instead of drifting silently.
--
-- Mirrors (as of egradx-auth 1.0.0):
--   EgradxOrganizationEntity, EgradxUserEntity, EgradxAuthorityEntity, EgradxRoleEntity,
--   EgradxOrganizationMembershipEntity, EgradxRefreshTokenEntity, and the role↔authority join.

-- =====================================================================================
-- Organizations (tenants)
-- =====================================================================================
CREATE TABLE egradx_organization (
    id         UUID PRIMARY KEY,
    name       VARCHAR(255) NOT NULL UNIQUE,
    status     VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL
);

-- =====================================================================================
-- Users. organization membership is NOT here — see egradx_organization_membership.
-- =====================================================================================
CREATE TABLE egradx_user (
    id                 UUID PRIMARY KEY,
    username           VARCHAR(255) NOT NULL UNIQUE,
    email              VARCHAR(255) NOT NULL UNIQUE,
    display_name       VARCHAR(255),
    password_hash      VARCHAR(255) NOT NULL,
    primary_account_id UUID         NOT NULL,
    active_account_id  UUID         NOT NULL,
    active             BOOLEAN      NOT NULL,
    platform_owner     BOOLEAN      NOT NULL,
    created_at         TIMESTAMP(6) NOT NULL
);

-- =====================================================================================
-- Authorities: the global permission vocabulary (not organization-scoped)
-- =====================================================================================
CREATE TABLE egradx_authority (
    id          UUID PRIMARY KEY,
    name        VARCHAR(255) NOT NULL UNIQUE,
    description VARCHAR(255),
    category    VARCHAR(255)
);

-- =====================================================================================
-- Roles: named bundles of authorities, scoped to one organization.
-- organization_id NULL marks the single global platform-owner role.
-- =====================================================================================
CREATE TABLE egradx_role (
    id              UUID PRIMARY KEY,
    organization_id UUID,
    name            VARCHAR(255) NOT NULL,
    description     VARCHAR(255),
    is_system       BOOLEAN      NOT NULL,
    CONSTRAINT uk_egradx_role_org_name UNIQUE (organization_id, name)
);
CREATE INDEX idx_egradx_role_organization_id ON egradx_role(organization_id);

CREATE TABLE egradx_role_authority (
    role_id      UUID NOT NULL REFERENCES egradx_role(id) ON DELETE CASCADE,
    authority_id UUID NOT NULL REFERENCES egradx_authority(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, authority_id)
);

-- =====================================================================================
-- Membership: which single role a user holds in a given organization.
-- A user may belong to several organizations, but only one role in each — that is what
-- the unique constraint enforces. organization_id NULL is the platform-owner assignment.
-- =====================================================================================
CREATE TABLE egradx_organization_membership (
    id              UUID PRIMARY KEY,
    user_id         UUID         NOT NULL REFERENCES egradx_user(id),
    organization_id UUID         REFERENCES egradx_organization(id),
    role_id         UUID         NOT NULL REFERENCES egradx_role(id),
    created_at      TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_egradx_membership_user_org UNIQUE (user_id, organization_id)
);
CREATE INDEX idx_egradx_membership_user_id ON egradx_organization_membership(user_id);
CREATE INDEX idx_egradx_membership_organization_id ON egradx_organization_membership(organization_id);
CREATE INDEX idx_egradx_membership_role_id ON egradx_organization_membership(role_id);

-- =====================================================================================
-- Refresh tokens: opaque strings, checked against this table on every refresh so that
-- revoking one (logout) takes effect immediately. organization_id pins the session to the
-- organization it was issued for.
-- =====================================================================================
CREATE TABLE egradx_refresh_token (
    id              UUID PRIMARY KEY,
    user_id         UUID         NOT NULL,
    organization_id UUID,
    token           VARCHAR(512) NOT NULL UNIQUE,
    expiry_date     TIMESTAMP(6) NOT NULL,
    created_at      TIMESTAMP(6) NOT NULL,
    revoked_at      TIMESTAMP(6)
);
CREATE INDEX idx_egradx_refresh_token_user_id ON egradx_refresh_token(user_id);
