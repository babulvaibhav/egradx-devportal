-- egradx-notification: bulk sends that honour recipients' opt-outs.
--
-- Preferences themselves are not stored here — egradx-auth owns them, and this library asks through
-- EgradxRecipientPreferences. What a bulk send records is whether it honours them, and how many
-- recipients it skipped for that reason, beside the count skipped for having no address.
ALTER TABLE egradx_notification_bulk_send
    ADD COLUMN respect_preferences BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN opted_out INTEGER NOT NULL DEFAULT 0;
