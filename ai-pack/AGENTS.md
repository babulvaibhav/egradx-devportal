# EGRADX SDK: rules for AI coding assistants

You are working on an application built on the **EGRADX SDK** (Java with Spring Boot, Node with Express, or Python with FastAPI). The SDK already provides the cross-cutting parts of the application. **Write business logic only**, and use the SDK for everything below. The full documentation is in `docs/` beside this file; the language-neutral contracts are in `contracts/`.

## How to decide what to write

For each part of a task:
1. **The SDK provides it** (see the list below and `docs/`): use the SDK's API. Do not write an alternative, a helper that re-implements it, or a wrapper that changes its behaviour.
2. **The SDK plans it but has not built it yet:** write the smallest interface in the application and mark it, so it can be swapped later:
   `// EGRADX-PLANNED: <capability>` (`#` in Python).
3. **Business logic** (domain model, rules, repositories, use cases, the app's own endpoints): this is the application's job. Write it.

If you are not sure whether the SDK covers something, **assume it does**, read `docs/`, and ask the developer before writing infrastructure code.

## Never write these (the SDK does them)

- Sign-in, token issuing, refresh, JWT parsing or verification, JWKS fetching, password hashing.
- A holder for the current user, organization, request id or locale (`ThreadLocal`, `AsyncLocalStorage`, `ContextVar`).
- User, organization, role, permission, invitation, session or profile tables and their endpoints.
- Audit tables, entity listeners for auditing, or audit endpoints.
- Notification tables, an SSE or WebSocket server for notifications, an outbox for messages, or calls to SMTP, Slack, Twilio or WhatsApp.
- An outbox, a message relay, broker client wrappers, retry loops or dead-letter handling for events.
- Request-id filters, tracing setup for the SDK's operations, or log shippers.
- Error bodies built by hand, or a handler that maps the SDK's exceptions itself. (Java needs exactly one advice for the application's own endpoints, extending `EgradxExceptionHandlerSupport`: projects from the Initializr have it as `ApiExceptionHandler`. Node uses `app.use(...egradxErrors())`, Python `sdk.install(app)`.)
- RSA keys, JWK sets or certificates (only an auth server uses the SDK's key provider).
- Copies of the SDK's enums or error codes.

## Always do these

| | Java (Spring Boot) | Node (Express) | Python (FastAPI) |
|---|---|---|---|
| One dependency | `com.egradx:egradx-sdk` (versions from `com.egradx:egradx-bom`) | `@babulvaibhav/egradx-sdk` | `egradx-sdk` |
| Migrate the SDK's tables | automatic at startup, before the app's Flyway | `migrateEgradx(url, { application })` | `await migrate_egradx(url, application=...)` |
| Protect an endpoint | `@PreAuthorize("hasAuthority('orders.write')")` | `requireAuthority('orders.write')` | `dependencies=[require_authority("orders.write")]` |
| Current user / organization | `EgradxTenantContextAccessor.current()` | `currentCaller()` (`userId`, `organizationId`, `authorities`) | `signed_in_user()` (`user_id`, `organization_id`) |
| Errors | throw `com.egradx.core.exception.*` | throw the core exceptions (`NotFoundException`, `ValidationException`, …) | raise the core exceptions |
| Audit a change | `auditor.record(EgradxAuditEvent.of(action)…build())` inside the change's transaction | `auditor.record(...)` inside `egradxTransaction` | `await auditor.record(...)` inside `egradx_transaction` |
| In-app notification | `EgradxNotificationPublisher.publishToUser / publishToOrganization` | `notifications.publishToUser / ToOrganization` | `notifications.publish_to_user / _to_organization` |
| Email, Slack, SMS, WhatsApp | `EgradxMessenger.send(...)` | `notifications.messenger.send(...)` | `notifications.messenger.send(...)` |
| Business events (a package of its own) | `egradx-platform-events`: `EgradxEventPublisher.publish(type, subject, organizationId, data)` + `EgradxEventHandler` beans | `@babulvaibhav/egradx-events`: `events.publish(type, data, { subject, organizationId })` + handlers; `migrateEvents`, `events.start()` | `egradx-events`: `await events.publish(type, data, subject=..., organization_id=...)` + handlers; `migrate_events`, `await events.start()` |

Rules that apply in every language:
- **Tenant isolation is the application's job in its own queries.** The SDK tells you the caller's organization; every query on the app's own tables must filter by it.
- **Changes worth auditing record an audit event in the same transaction as the change,** with before and after state.
- **Event types are named `<area>.<entity>.<what-happened>.v<N>`** in lower case, with a JSON object as data. Handlers must cope with seeing an event twice and late: no order is promised.
- **Error responses use the SDK's envelope** (`contracts/schemas/error.json`), and its codes (`contracts/schemas/error-codes.json`).
- **Configuration:** Java uses the SDK's `egradx.*` keys (`docs/reference/configuration.md`). Node and Python pass options in code (`createEgradx({...})`, `SdkOptions(...)`), read from the application's own environment variables. Never hard-code secrets: the keys passphrase above all.
- **Java with its own `SecurityFilterChain`** must add the SDK's `egradxAuthenticationFilter` before `UsernamePasswordAuthenticationFilter`. Otherwise no request is signed in.
- **Starting a new application:** generate it at the portal's `/start` (the Initializr) rather than writing the wiring by hand.
- **The version is 1.0.0 everywhere.** Do not suggest other versions of `com.egradx:*`, `@babulvaibhav/egradx-*` or `egradx-*` packages.
- **Don't patch around an SDK bug in application code.** Tell the developer, so it is fixed in the SDK.

## Before you finish

- [ ] No code from the "Never write these" list.
- [ ] Every endpoint of the application's own checks a permission, or is deliberately public.
- [ ] Every query on the application's own tables filters by the caller's organization.
- [ ] Changes worth auditing record an audit event in their transaction.
- [ ] Errors are the SDK's exceptions; no hand-built error bodies.
- [ ] Anything the SDK only plans is behind an interface marked `EGRADX-PLANNED`.
