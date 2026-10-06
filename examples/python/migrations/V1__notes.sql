-- docs:region migration
-- The application's own table. Its migrations run after the SDK's sign-in tables exist, so it may reference them.
CREATE TABLE notes_note (
    id              UUID PRIMARY KEY,
    organization_id UUID         NOT NULL REFERENCES egradx_organization (id),
    title           VARCHAR(200) NOT NULL,
    body            TEXT
);
CREATE INDEX notes_note_organization ON notes_note (organization_id);
-- docs:end
