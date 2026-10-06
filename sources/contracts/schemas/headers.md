# HTTP headers

Every EGRADX SDK reads and writes these headers the same way.

## Requests into an EGRADX application

| Header | Meaning |
|---|---|
| `Authorization: Bearer <access token>` | The caller. Claims: [jwt-claims.json](jwt-claims.json). A request without it is anonymous. |
| `X-Request-ID` | The caller's id for this request. It is used when well-formed, and generated otherwise. |
| `X-Trace-Id` | Older name for the same id. It is read only when `X-Request-ID` is absent. |
| `traceparent`, `tracestate` | W3C trace context. The request joins the caller's trace. |
| `Accept-Language` | The caller's locale, used for messages and templates. |
| `User-Agent` | Recorded with audit events. |

Java defaults: `egradx.observability.correlation.request-headers` (`X-Request-ID`, `X-Trace-Id`) and `response-header` (`X-Request-ID`).

## Responses

| Header | Meaning |
|---|---|
| `X-Request-ID` | Every response carries it. It is the same id as `error.requestId` in [error.json](error.json) and appears on every log line of the request. |
| `X-Egradx-Audit-Truncated`, `X-Egradx-Audit-Row-Limit` | Sent on the audit CSV export when the row limit cut it short. |

## Outbound webhooks (notification webhook channel)

| Header | Meaning |
|---|---|
| `X-Egradx-Delivery-Id` | The id of the delivery. Receivers use it to de-duplicate retries. |
| `X-Egradx-Timestamp` | Unix seconds when the delivery was sent. |
| `X-Egradx-Signature: sha256=<hex>` | Sent only when a signing secret is configured. It is the HMAC-SHA256 of `"<timestamp>.<body>"`. Receivers must reject stale timestamps to prevent replays. |
