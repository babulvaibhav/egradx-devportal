-- egradx-notification: where each message came from.
--
-- A message is delivered later, on the dispatcher's own threads, long after the request that
-- submitted it has returned. So the request's trace travels with the row:
--   trace_id       the trace id, when the application has a tracer — the id shown in its tracing UI;
--   request_id     the X-Request-ID of the submitting request (or one made for it) — the id in its
--                  logs and error messages;
--   trace_context  everything the tracer's propagator wrote (W3C traceparent and tracestate), so the
--                  delivery's span continues the submitting request's trace.
-- Either id finds every delivery a request produced. A bulk send carries the same columns and hands
-- them on to the messages it is expanded into.
ALTER TABLE egradx_notification_message
    ADD COLUMN trace_id VARCHAR(64),
    ADD COLUMN request_id VARCHAR(64),
    ADD COLUMN trace_context VARCHAR(1024);

CREATE INDEX idx_egradx_notification_message_trace
    ON egradx_notification_message (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX idx_egradx_notification_message_request
    ON egradx_notification_message (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE egradx_notification_bulk_send
    ADD COLUMN trace_id VARCHAR(64),
    ADD COLUMN request_id VARCHAR(64),
    ADD COLUMN trace_context VARCHAR(1024);
