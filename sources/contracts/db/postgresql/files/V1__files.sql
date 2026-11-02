-- egradx-file-storage: files an application's users upload (docs/files/design.md). Applied by the library itself into
-- egradx_files_schema_history.
--
-- A file belongs to an organization. Its bytes live in a backend (local disk or S3-compatible) under storage_key; this
-- row is what the application reads and checks access against. attached_type/attached_id tie it to a record of the
-- application's own (an order, a ticket) whose access check the application may plug in. A delete sets deleted_at and
-- removes the bytes; bytes_removed_at records that they are gone, so the clean-up retries a removal that failed.

CREATE TABLE egradx_file (
    id                UUID PRIMARY KEY,
    organization_id   UUID          NOT NULL,
    uploaded_by       UUID,
    purpose           VARCHAR(64)   NOT NULL,
    attached_type     VARCHAR(64),
    attached_id       VARCHAR(128),
    name              VARCHAR(255)  NOT NULL,
    content_type      VARCHAR(255)  NOT NULL,
    size_bytes        BIGINT        NOT NULL,
    sha256            VARCHAR(64)   NOT NULL,
    backend           VARCHAR(16)   NOT NULL,
    storage_key       VARCHAR(512)  NOT NULL,
    created_at        TIMESTAMP(6)  NOT NULL,
    deleted_at        TIMESTAMP(6),
    bytes_removed_at  TIMESTAMP(6)
);
CREATE INDEX idx_egradx_file_attached ON egradx_file (organization_id, attached_type, attached_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_egradx_file_uploader ON egradx_file (organization_id, uploaded_by, purpose) WHERE deleted_at IS NULL;
CREATE INDEX idx_egradx_file_bytes_pending ON egradx_file (deleted_at) WHERE deleted_at IS NOT NULL AND bytes_removed_at IS NULL;
