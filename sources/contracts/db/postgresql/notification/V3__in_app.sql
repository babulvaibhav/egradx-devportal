-- egradx-notification: in-app notifications — the notifications section of an application's UI.
--
-- One row per notification, whatever its audience. Who sees it is decided when the inbox is read,
-- from the scope on the row, so a platform-wide announcement is one row, not one per user.

CREATE TABLE egradx_notification (
    id                 UUID          PRIMARY KEY,
    scope              VARCHAR(20)   NOT NULL,
    organization_id    UUID,                        -- USER: optional; ORGANIZATION: required; PLATFORM: null
    recipient_user_id  UUID,                        -- USER only
    notification_key   VARCHAR(150),
    title              VARCHAR(500)  NOT NULL,
    body               TEXT,
    metadata           JSONB         NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ   NOT NULL,
    CONSTRAINT ck_egradx_notification_scope CHECK (
        (scope = 'USER'         AND recipient_user_id IS NOT NULL) OR
        (scope = 'ORGANIZATION' AND organization_id IS NOT NULL AND recipient_user_id IS NULL) OR
        (scope = 'PLATFORM'     AND organization_id IS NULL     AND recipient_user_id IS NULL))
);

-- One index per branch of the inbox query, each partial on its scope, newest first.
CREATE INDEX idx_egradx_notification_user
    ON egradx_notification (recipient_user_id, created_at DESC) WHERE scope = 'USER';
CREATE INDEX idx_egradx_notification_organization
    ON egradx_notification (organization_id, created_at DESC) WHERE scope = 'ORGANIZATION';
CREATE INDEX idx_egradx_notification_platform
    ON egradx_notification (created_at DESC) WHERE scope = 'PLATFORM';

-- Read state, created lazily: no row means unread. A user marking a notification read writes a row
-- for that user alone, so it never hides the notification from anyone else — the defect in the
-- demo app, whose single "read" flag was effectively shared by the whole organization.
--
-- The primary key serves the unread count's NOT EXISTS probe.
CREATE TABLE egradx_notification_recipient_state (
    notification_id  UUID         NOT NULL REFERENCES egradx_notification (id) ON DELETE CASCADE,
    user_id          UUID         NOT NULL,
    read_at          TIMESTAMPTZ  NOT NULL,
    PRIMARY KEY (notification_id, user_id)
);
