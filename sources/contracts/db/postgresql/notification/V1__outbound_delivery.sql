-- egradx-notification: outbound messages and their per-recipient deliveries.
--
-- Applied by EgradxNotificationSchemaMigrator with its own history table
-- (egradx_notification_schema_history), alongside - never inside - the host application's.
-- Later phases add further tables in V2, V3, ...; applied files are never edited.
--
-- No foreign key to egradx-auth's organization table, deliberately: this library must work in an
-- application that doesn't use egradx-auth.

-- One row per send request. The rendered content lives here once, not once per recipient.
CREATE TABLE egradx_notification_message (
    id                UUID          PRIMARY KEY,
    organization_id   UUID,                         -- null for a platform-level message
    channel           VARCHAR(50)   NOT NULL,
    notification_key  VARCHAR(150),
    subject           TEXT,
    body              TEXT          NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL
);

CREATE INDEX idx_egradx_notification_message_org_created
    ON egradx_notification_message (organization_id, created_at);

-- One row per message per recipient address: the delivery log, and the dispatcher's work queue.
--
-- A row is PENDING until it is SENT or DEAD. While a dispatcher holds it, it stays PENDING with
-- next_attempt_at pushed forward by the lease duration and attempts already incremented, so an
-- instance that dies mid-send simply lets the lease lapse and another instance retries it.
CREATE TABLE egradx_notification_delivery (
    id                   UUID          PRIMARY KEY,
    message_id           UUID          NOT NULL REFERENCES egradx_notification_message (id) ON DELETE CASCADE,
    address              VARCHAR(512)  NOT NULL,
    status               VARCHAR(20)   NOT NULL,
    attempts             INTEGER       NOT NULL DEFAULT 0,
    next_attempt_at      TIMESTAMPTZ   NOT NULL,
    last_error           TEXT,
    provider_message_id  VARCHAR(255),
    created_at           TIMESTAMPTZ   NOT NULL,
    updated_at           TIMESTAMPTZ   NOT NULL,
    sent_at              TIMESTAMPTZ,
    CONSTRAINT ck_egradx_notification_delivery_status CHECK (status IN ('PENDING', 'SENT', 'DEAD')),
    CONSTRAINT uq_egradx_notification_delivery_address UNIQUE (message_id, address)
);

-- The dispatcher's claim query: PENDING rows that are due, oldest due first. Partial, so the index
-- stays the size of the backlog rather than of the whole history.
CREATE INDEX idx_egradx_notification_delivery_due
    ON egradx_notification_delivery (next_attempt_at)
    WHERE status = 'PENDING';

-- Retention cleanup, and "what's dead" queries for operations.
CREATE INDEX idx_egradx_notification_delivery_status_updated
    ON egradx_notification_delivery (status, updated_at);
