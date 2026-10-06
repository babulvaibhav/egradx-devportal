-- egradx-notification: templates stored in the database, and the body format of each message.

-- Existing messages were all plain text: V1 had no way to say otherwise.
ALTER TABLE egradx_notification_message
    ADD COLUMN body_format VARCHAR(10) NOT NULL DEFAULT 'TEXT',
    ADD CONSTRAINT ck_egradx_notification_message_body_format CHECK (body_format IN ('TEXT', 'HTML'));

-- Overrides of the templates shipped on the classpath. A row with an organization_id applies to
-- that organization; a row without one applies to every organization that has no row of its own.
--
-- locale is a BCP 47 tag ('fr', 'pt-BR'); 'und' ("undetermined", BCP 47's own word for it) is the
-- template used when no locale-specific one matches. A real value rather than NULL so that it can
-- take part in the uniqueness rules below.
CREATE TABLE egradx_notification_template (
    id                UUID          PRIMARY KEY,
    organization_id   UUID,
    notification_key  VARCHAR(150)  NOT NULL,
    channel           VARCHAR(50)   NOT NULL,
    locale            VARCHAR(35)   NOT NULL,
    subject           TEXT,
    body              TEXT          NOT NULL,
    body_format       VARCHAR(10)   NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL,
    updated_at        TIMESTAMPTZ   NOT NULL,
    CONSTRAINT ck_egradx_notification_template_body_format CHECK (body_format IN ('TEXT', 'HTML'))
);

-- One template per (organization, key, channel, locale). Two partial indexes rather than one
-- unique constraint, because a unique constraint treats NULLs as distinct and would allow any
-- number of all-organizations rows for the same key. (PostgreSQL 15 has NULLS NOT DISTINCT; this
-- works on older versions too.)
CREATE UNIQUE INDEX uq_egradx_notification_template_org
    ON egradx_notification_template (organization_id, notification_key, channel, locale)
    WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX uq_egradx_notification_template_all_orgs
    ON egradx_notification_template (notification_key, channel, locale)
    WHERE organization_id IS NULL;
