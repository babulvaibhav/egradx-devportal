-- egradx-auth migration, applied by the library itself into egradx_auth_schema_history (EgradxAuthSchemaMigrator).
-- Formerly the OIM application's V6__egradx_auth_profiles.sql, when applications had to create these tables themselves.

-- egradx-auth: user profiles — personal details, contact addresses per channel, verification codes
-- and communication preferences (egradx-auth roadmap item 1.8).
--
-- Mirrors EgradxUserProfileEntity, EgradxUserContactEntity, EgradxContactVerificationEntity and
-- EgradxCommunicationPreferenceEntity. Like V1, this lives here only because egradx-auth does not
-- yet ship its own migrations; ddl-auto=validate is what keeps it honest.

-- One per user, created on first save.
CREATE TABLE egradx_user_profile (
    user_id              UUID          PRIMARY KEY REFERENCES egradx_user(id) ON DELETE CASCADE,
    first_name           VARCHAR(100),
    last_name            VARCHAR(100),
    job_title            VARCHAR(150),
    photo_url            VARCHAR(1024),
    locale               VARCHAR(35),
    time_zone            VARCHAR(64),
    address_line1        VARCHAR(255),
    address_line2        VARCHAR(255),
    address_city         VARCHAR(120),
    address_region       VARCHAR(120),
    address_postal_code  VARCHAR(32),
    address_country      VARCHAR(2),
    attributes           TEXT,              -- JSON, as text: portable across PostgreSQL, MySQL and H2
    created_at           TIMESTAMP(6)  NOT NULL,
    updated_at           TIMESTAMP(6)  NOT NULL
);

-- One row per address. organization_id NULL means the address applies in every organization.
CREATE TABLE egradx_user_contact (
    id               UUID          PRIMARY KEY,
    user_id          UUID          NOT NULL REFERENCES egradx_user(id) ON DELETE CASCADE,
    organization_id  UUID          REFERENCES egradx_organization(id) ON DELETE CASCADE,
    channel          VARCHAR(50)   NOT NULL,
    address          VARCHAR(512)  NOT NULL,
    label            VARCHAR(100),
    is_primary       BOOLEAN       NOT NULL,
    verified_at      TIMESTAMP(6),
    created_at       TIMESTAMP(6)  NOT NULL,
    updated_at       TIMESTAMP(6)  NOT NULL
);

CREATE INDEX idx_egradx_user_contact_user ON egradx_user_contact (user_id, channel);

-- At most one outstanding code per contact; only its hash is stored.
CREATE TABLE egradx_contact_verification (
    contact_id  UUID          PRIMARY KEY REFERENCES egradx_user_contact(id) ON DELETE CASCADE,
    code_hash   VARCHAR(255)  NOT NULL,
    expires_at  TIMESTAMP(6)  NOT NULL,
    attempts    INTEGER       NOT NULL,
    created_at  TIMESTAMP(6)  NOT NULL
);

-- Opt-outs. notification_key NULL: every kind of message; organization_id NULL: everywhere.
CREATE TABLE egradx_communication_preference (
    id                UUID          PRIMARY KEY,
    user_id           UUID          NOT NULL REFERENCES egradx_user(id) ON DELETE CASCADE,
    organization_id   UUID          REFERENCES egradx_organization(id) ON DELETE CASCADE,
    channel           VARCHAR(50)   NOT NULL,
    notification_key  VARCHAR(150),
    enabled           BOOLEAN       NOT NULL,
    updated_at        TIMESTAMP(6)  NOT NULL
);

CREATE INDEX idx_egradx_communication_preference_user ON egradx_communication_preference (user_id);
