-- egradx-platform-events: the events an application publishes, and the ones it has handled.
--
-- The outbox holds each event from the moment the change it reports is committed (it is written in the same
-- transaction) until a relay has handed it to the transport. The inbox holds, per handler, the events it has already
-- handled, so a second delivery of one (every transport delivers at least once) changes nothing.

CREATE TABLE egradx_event_outbox (
    -- The CloudEvents id: a UUID v7, so ids sort by when they were made.
    id               UUID          PRIMARY KEY,
    type             VARCHAR(200)  NOT NULL,
    source           VARCHAR(200)  NOT NULL,
    subject          VARCHAR(400),
    occurred_at      TIMESTAMPTZ   NOT NULL,
    organization_id  UUID,
    -- The trace and request the change was made in (W3C traceparent and tracestate, and the request id, as
    -- egradx-observability serializes them), so a handler continues them.
    trace_context    VARCHAR(1024),
    data             JSONB         NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
    attempts         INTEGER       NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
    sent_at          TIMESTAMPTZ,
    -- Set when the relay gave up on it: it stays, for someone to look at and send again.
    dead_at          TIMESTAMPTZ,
    last_error       VARCHAR(2000)
);

-- What the relay looks for: unsent, not given up on, due.
CREATE INDEX egradx_event_outbox_due ON egradx_event_outbox (next_attempt_at) WHERE sent_at IS NULL AND dead_at IS NULL;
-- For clearing out what was sent long ago.
CREATE INDEX egradx_event_outbox_sent ON egradx_event_outbox (sent_at) WHERE sent_at IS NOT NULL;

CREATE TABLE egradx_event_inbox (
    event_id     UUID          NOT NULL,
    -- The handler's name: each handler of a type sees each event once.
    handler      VARCHAR(200)  NOT NULL,
    type         VARCHAR(200)  NOT NULL,
    handled_at   TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (event_id, handler)
);

CREATE INDEX egradx_event_inbox_handled ON egradx_event_inbox (handled_at);
