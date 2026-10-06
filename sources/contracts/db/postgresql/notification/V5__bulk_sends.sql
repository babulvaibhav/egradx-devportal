-- egradx-notification: bulk sends — one outbound message to every member of an organization, or to
-- every user.
--
-- The caller's thread writes only the row below. The dispatcher then expands it into deliveries a
-- page of recipients at a time, one transaction per page, recording how far it has got in
-- expanded_through. An instance dying mid-expansion rolls back the page it was on; the next one
-- carries on from the last committed page. Nothing is sent twice and nobody is skipped.

CREATE TABLE egradx_notification_bulk_send (
    id                         UUID          PRIMARY KEY,
    organization_id            UUID,                 -- whose channel configuration and templates apply
    channel                    VARCHAR(50)   NOT NULL,
    audience                   VARCHAR(30)   NOT NULL,
    audience_organization_id   UUID,                 -- ORGANIZATION_MEMBERS only
    notification_key           VARCHAR(150),
    model                      JSONB,                -- templated sends: rendered per recipient language on expansion
    subject                    TEXT,                 -- ready-made content sends
    body                       TEXT,
    body_format                VARCHAR(10),
    reply_to                   VARCHAR(512),
    status                     VARCHAR(20)   NOT NULL,
    expanded_through           UUID,                 -- the last user id expanded; pages continue after it
    recipients_expanded        INTEGER       NOT NULL DEFAULT 0,
    unreachable                INTEGER       NOT NULL DEFAULT 0,
    last_error                 TEXT,
    created_at                 TIMESTAMPTZ   NOT NULL,
    updated_at                 TIMESTAMPTZ   NOT NULL,
    CONSTRAINT ck_egradx_notification_bulk_send_status CHECK (status IN ('EXPANDING', 'COMPLETE', 'FAILED')),
    CONSTRAINT ck_egradx_notification_bulk_send_audience CHECK (
        (audience = 'ORGANIZATION_MEMBERS' AND audience_organization_id IS NOT NULL) OR
        (audience = 'ALL_USERS' AND audience_organization_id IS NULL)),
    CONSTRAINT ck_egradx_notification_bulk_send_content CHECK (model IS NOT NULL OR body IS NOT NULL)
);

CREATE INDEX idx_egradx_notification_bulk_send_expanding
    ON egradx_notification_bulk_send (created_at) WHERE status = 'EXPANDING';

-- A bulk send becomes one message per language among its recipients, filled page by page.
ALTER TABLE egradx_notification_message
    ADD COLUMN bulk_send_id UUID REFERENCES egradx_notification_bulk_send (id) ON DELETE CASCADE,
    ADD COLUMN locale VARCHAR(35);

CREATE UNIQUE INDEX uq_egradx_notification_message_bulk_locale
    ON egradx_notification_message (bulk_send_id, locale) WHERE bulk_send_id IS NOT NULL;
