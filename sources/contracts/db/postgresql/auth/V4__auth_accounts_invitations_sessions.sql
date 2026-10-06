-- egradx-auth migration, applied by the library itself into egradx_auth_schema_history (EgradxAuthSchemaMigrator).
-- Formerly the OIM application's V9__egradx_auth_accounts_invitations_sessions.sql, when applications had to create these tables themselves.

-- egradx-auth: password reset, invitations, ending every session, and changing the sign-in email
-- (egradx-auth roadmap items 1.2, 1.3, 1.6 in part, and profiles' "change login email").
--
-- Mirrors EgradxUserEntity.sessionsValidAfter, EgradxPasswordResetEntity, EgradxInvitationEntity and
-- EgradxEmailChangeEntity. Like V1 and V6, this lives here only because egradx-auth does not yet ship
-- its own migrations; ddl-auto=validate is what keeps it honest.

-- Access tokens issued before this instant, and refresh tokens created before it, are refused: set
-- when the password is changed or reset, or the person signs out everywhere. NULL: never.
ALTER TABLE egradx_user ADD COLUMN sessions_valid_after TIMESTAMP(6);

-- At most one outstanding reset link per user; a new request replaces it. The link carries
-- selector.verifier: the selector finds the row, only the verifier's SHA-256 is stored.
CREATE TABLE egradx_password_reset (
    user_id        UUID          PRIMARY KEY REFERENCES egradx_user(id) ON DELETE CASCADE,
    selector       VARCHAR(64)   NOT NULL UNIQUE,
    verifier_hash  VARCHAR(64)   NOT NULL,
    expires_at     TIMESTAMP(6)  NOT NULL,
    created_at     TIMESTAMP(6)  NOT NULL
);

-- Invitations to join an organization. status is PENDING, ACCEPTED or REVOKED; "expired" is derived
-- from expires_at, not stored. email is stored lower-cased.
CREATE TABLE egradx_invitation (
    id                UUID          PRIMARY KEY,
    organization_id   UUID          NOT NULL REFERENCES egradx_organization(id) ON DELETE CASCADE,
    email             VARCHAR(255)  NOT NULL,
    role_id           UUID          NOT NULL REFERENCES egradx_role(id) ON DELETE CASCADE,
    invited_by        UUID          REFERENCES egradx_user(id) ON DELETE SET NULL,
    status            VARCHAR(20)   NOT NULL,
    selector          VARCHAR(64)   NOT NULL UNIQUE,
    verifier_hash     VARCHAR(64)   NOT NULL,
    expires_at        TIMESTAMP(6)  NOT NULL,
    last_sent_at      TIMESTAMP(6)  NOT NULL,
    accepted_at       TIMESTAMP(6),
    accepted_user_id  UUID          REFERENCES egradx_user(id) ON DELETE SET NULL,
    created_at        TIMESTAMP(6)  NOT NULL,
    updated_at        TIMESTAMP(6)  NOT NULL
);

-- One pending invitation per organization and address: inviting again replaces it. The service keeps
-- to this as well; the index is what holds under two admins inviting the same address at once.
CREATE UNIQUE INDEX uk_egradx_invitation_pending ON egradx_invitation (organization_id, email)
    WHERE status = 'PENDING';
CREATE INDEX idx_egradx_invitation_organization ON egradx_invitation (organization_id, status, created_at);

-- At most one email change under way per user; only the code's hash is stored.
CREATE TABLE egradx_email_change (
    user_id     UUID          PRIMARY KEY REFERENCES egradx_user(id) ON DELETE CASCADE,
    new_email   VARCHAR(255)  NOT NULL,
    code_hash   VARCHAR(255)  NOT NULL,
    expires_at  TIMESTAMP(6)  NOT NULL,
    attempts    INTEGER       NOT NULL,
    created_at  TIMESTAMP(6)  NOT NULL
);
