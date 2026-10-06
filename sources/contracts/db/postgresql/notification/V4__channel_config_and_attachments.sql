-- egradx-notification: per-organization channel configuration, reply-to, and attachments.

ALTER TABLE egradx_notification_message ADD COLUMN reply_to VARCHAR(512);

-- One file attached to an outbound message, stored once and shared by every delivery of it.
-- Read back only when a delivery is actually sent, never while claiming a batch.
CREATE TABLE egradx_notification_attachment (
    id            UUID          PRIMARY KEY,
    message_id    UUID          NOT NULL REFERENCES egradx_notification_message (id) ON DELETE CASCADE,
    position      INTEGER       NOT NULL,
    filename      VARCHAR(255)  NOT NULL,
    content_type  VARCHAR(255)  NOT NULL,
    size_bytes    BIGINT        NOT NULL,
    content       BYTEA         NOT NULL,
    CONSTRAINT uq_egradx_notification_attachment_position UNIQUE (message_id, position)
);

-- How a channel reaches its provider, per organization: SMTP host and sender for email, and so on.
-- A row with no organization_id applies to every organization that has no row of its own.
--
-- settings holds everything that is not secret. The one secret — a password, an API token — is
-- stored envelope-encrypted (see EncryptionUtil in egradx-core): ciphertext under a per-row data
-- key, the data key under a key derived from the application's passphrase, and that derivation's
-- salt. A database dump reveals no credential without the passphrase.
CREATE TABLE egradx_notification_channel_config (
    id                 UUID          PRIMARY KEY,
    organization_id    UUID,
    channel            VARCHAR(50)   NOT NULL,
    enabled            BOOLEAN       NOT NULL,
    settings           JSONB         NOT NULL DEFAULT '{}',
    secret_ciphertext  TEXT,
    secret_dek         TEXT,
    secret_kek_salt    TEXT,
    created_at         TIMESTAMPTZ   NOT NULL,
    updated_at         TIMESTAMPTZ   NOT NULL,
    CONSTRAINT ck_egradx_notification_channel_config_secret CHECK (
        (secret_ciphertext IS NULL AND secret_dek IS NULL AND secret_kek_salt IS NULL) OR
        (secret_ciphertext IS NOT NULL AND secret_dek IS NOT NULL AND secret_kek_salt IS NOT NULL))
);

CREATE UNIQUE INDEX uq_egradx_notification_channel_config_org
    ON egradx_notification_channel_config (organization_id, channel) WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX uq_egradx_notification_channel_config_all_orgs
    ON egradx_notification_channel_config (channel) WHERE organization_id IS NULL;
