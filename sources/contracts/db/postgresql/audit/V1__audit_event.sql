-- egradx-audit: the audit trail. One row per recorded event, never changed once written.
--
-- organization_id is who may see the record (NULL: platform administrators only). No foreign keys on
-- purpose: a record must outlive what it is about — a deleted user, an organization removed — and must
-- be writable for things that do not exist (a failed sign-in as someone unknown).

CREATE TABLE egradx_audit_event (
    id                    UUID          PRIMARY KEY,
    -- The order records were stored in, for a forwarder reading them once each.
    seq                   BIGINT        GENERATED ALWAYS AS IDENTITY,
    occurred_at           TIMESTAMPTZ   NOT NULL,
    recorded_at           TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
    organization_id       UUID,
    -- "C" collation: a category or action-prefix filter is a range scan on the index.
    category              VARCHAR(64)   COLLATE "C" NOT NULL,
    action                VARCHAR(128)  COLLATE "C" NOT NULL,
    outcome               VARCHAR(16)   NOT NULL,
    reason                VARCHAR(128),
    actor_type            VARCHAR(16)   NOT NULL,
    actor_id              UUID,
    actor_organization_id UUID,
    actor_label           VARCHAR(320),
    entity_type           VARCHAR(64)   COLLATE "C",
    entity_id             VARCHAR(256),
    entity_label          VARCHAR(512),
    before_state          JSONB,
    after_state           JSONB,
    changed_fields        TEXT[],
    details               JSONB,
    client_address        VARCHAR(64),
    user_agent            VARCHAR(512),
    request_id            VARCHAR(64),
    trace_id              VARCHAR(64),
    CONSTRAINT ck_egradx_audit_outcome    CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED')),
    CONSTRAINT ck_egradx_audit_actor_type CHECK (actor_type IN ('USER', 'ANONYMOUS', 'SYSTEM', 'UNKNOWN')),
    CONSTRAINT ck_egradx_audit_category   CHECK (starts_with(action, category || '.')),
    CONSTRAINT ck_egradx_audit_entity     CHECK (entity_id IS NULL OR entity_type IS NOT NULL)
);

CREATE INDEX ix_egradx_audit_org_time   ON egradx_audit_event (organization_id, occurred_at DESC, id DESC);
CREATE INDEX ix_egradx_audit_time       ON egradx_audit_event (occurred_at DESC, id DESC);
CREATE INDEX ix_egradx_audit_entity     ON egradx_audit_event (entity_type, entity_id, occurred_at DESC, id DESC)
    WHERE entity_id IS NOT NULL;
CREATE INDEX ix_egradx_audit_actor      ON egradx_audit_event (actor_id, occurred_at DESC, id DESC)
    WHERE actor_id IS NOT NULL;
CREATE INDEX ix_egradx_audit_org_action ON egradx_audit_event (organization_id, action, occurred_at DESC);
CREATE INDEX ix_egradx_audit_request    ON egradx_audit_event (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX ix_egradx_audit_trace      ON egradx_audit_event (trace_id) WHERE trace_id IS NOT NULL;

-- Append-only. Every UPDATE, DELETE and TRUNCATE is refused, with one exception: the library's
-- retention purge, which sets egradx.audit.purge_before for its own transaction and may then delete
-- rows older than that — and only those, checked row by row here, so no bug in the purge can take
-- newer ones.
--
-- This stops mistakes and casual edits by the application or anyone using its connection. It does not
-- stop the table's owner or a superuser, who can disable triggers; tamper evidence against them would
-- need a hash chain or a separate owning role.
CREATE FUNCTION egradx_audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    purge_before TEXT := current_setting('egradx.audit.purge_before', true);
BEGIN
    IF TG_OP = 'DELETE' AND purge_before IS NOT NULL AND purge_before <> ''
       AND OLD.occurred_at < purge_before::timestamptz THEN
        RETURN OLD;
    END IF;
    -- restrict_violation (23001): an integrity rule, which is what this is — and what an application's
    -- data-access layer reports it as (Spring: DataIntegrityViolationException), not a grammar error.
    RAISE EXCEPTION 'egradx_audit_event is append-only; % refused', TG_OP
        USING ERRCODE = 'restrict_violation',
              HINT = 'Audit records are removed only by egradx-audit''s retention purge.';
END $$;

CREATE TRIGGER egradx_audit_event_no_update_delete
    BEFORE UPDATE OR DELETE ON egradx_audit_event
    FOR EACH ROW EXECUTE FUNCTION egradx_audit_event_append_only();

CREATE TRIGGER egradx_audit_event_no_truncate
    BEFORE TRUNCATE ON egradx_audit_event
    FOR EACH STATEMENT EXECUTE FUNCTION egradx_audit_event_append_only();
