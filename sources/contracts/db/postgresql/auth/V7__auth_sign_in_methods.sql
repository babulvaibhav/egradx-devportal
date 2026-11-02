-- egradx-auth: sign-up, emailed sign-in codes and OpenID Connect providers (docs/auth/sign-in-methods.md).

-- An account may have no password: one made by a code, a provider or an invitation signs in those ways.
ALTER TABLE egradx_user ALTER COLUMN password_hash DROP NOT NULL;

-- A code emailed to an address, for signing in (SIGN_IN) or confirming a sign-up (SIGN_UP). One per address and
-- purpose: asking again replaces it. Only an Argon2 hash of the code is kept. email is lower-cased. A sign-up keeps what
-- the person typed until the code confirms it.
CREATE TABLE egradx_email_code (
    email                     VARCHAR(255) NOT NULL,
    purpose                   VARCHAR(20)  NOT NULL,
    code_hash                 VARCHAR(255) NOT NULL,
    expires_at                TIMESTAMP(6) NOT NULL,
    attempts                  INTEGER      NOT NULL,
    created_at                TIMESTAMP(6) NOT NULL,
    signup_name               VARCHAR(255),
    signup_organization_name  VARCHAR(255),
    signup_password_hash      VARCHAR(255),
    PRIMARY KEY (email, purpose)
);
CREATE INDEX idx_egradx_email_code_expires_at ON egradx_email_code(expires_at);

-- A person at an OpenID Connect provider, linked to an account. (issuer, subject) is the provider's own id for them;
-- provider is the configured id (google, zoho, ...); email is what the provider said when it was linked.
CREATE TABLE egradx_user_identity (
    id            UUID PRIMARY KEY,
    user_id       UUID         NOT NULL REFERENCES egradx_user(id) ON DELETE CASCADE,
    provider      VARCHAR(64)  NOT NULL,
    issuer        VARCHAR(512) NOT NULL,
    subject       VARCHAR(255) NOT NULL,
    email         VARCHAR(255),
    created_at    TIMESTAMP(6) NOT NULL,
    last_used_at  TIMESTAMP(6),
    CONSTRAINT uk_egradx_user_identity UNIQUE (issuer, subject)
);
CREATE INDEX idx_egradx_user_identity_user_id ON egradx_user_identity(user_id);

-- One round trip to a provider. Started with the state (only its SHA-256 kept), nonce and PKCE verifier; after the
-- callback it holds the provider's answer and a one-time result code (selector, and the verifier's SHA-256) the
-- frontend exchanges. link_user_id: started from a signed-in profile, to link rather than sign in.
CREATE TABLE egradx_oidc_flow (
    id                    UUID PRIMARY KEY,
    state_hash            VARCHAR(64)   NOT NULL UNIQUE,
    provider              VARCHAR(64)   NOT NULL,
    nonce                 VARCHAR(128)  NOT NULL,
    code_verifier         VARCHAR(128)  NOT NULL,
    return_to             VARCHAR(1024),
    link_user_id          UUID,
    created_at            TIMESTAMP(6)  NOT NULL,
    expires_at            TIMESTAMP(6)  NOT NULL,
    result_selector       VARCHAR(64)   UNIQUE,
    result_verifier_hash  VARCHAR(64),
    issuer                VARCHAR(512),
    subject               VARCHAR(255),
    email                 VARCHAR(255),
    email_verified        BOOLEAN,
    name                  VARCHAR(255)
);
CREATE INDEX idx_egradx_oidc_flow_expires_at ON egradx_oidc_flow(expires_at);
