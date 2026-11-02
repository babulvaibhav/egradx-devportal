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
- Sign-up, sign-in codes sent by email, "Sign in with Google/Zoho" or any OAuth/OpenID Connect login, account linking, or a passwordless flow. The SDK serves them all under `/egradx/auth/**`; never add Passport, NextAuth/Auth.js, Authlib, Spring Security OAuth2 Client or a provider's SDK for sign-in. Never write an OAuth or OpenID Connect callback endpoint, a sign-up or code endpoint, state, PKCE or nonce handling, or account linking, and never keep a provider's tokens. A provider the SDK lacks (GitHub, a company's identity server) is **one class**: implement `EgradxSignInProvider` (or extend `EgradxOidcSignInProvider` for an OpenID Connect provider with a quirk) and register it; no other code changes.
- A holder for the current user, organization, request id or locale (`ThreadLocal`, `AsyncLocalStorage`, `ContextVar`).
- User, organization, role, permission, invitation, session or profile tables and their endpoints.
- Audit tables, entity listeners for auditing, or audit endpoints.
- Notification tables, an SSE or WebSocket server for notifications, an outbox for messages, or calls to SMTP, Slack, Twilio or WhatsApp.
- An outbox, a message relay, broker client wrappers, retry loops or dead-letter handling for events.
- An upload or download endpoint, a files or attachments table, multipart parsing, S3/MinIO/R2 client code (AWS SDK calls, pre-signed URLs), profile-photo storage, or a folder of uploads of the application's own. `egradx-file-storage` serves `/egradx/files/**` and `/egradx/auth/my/profile/photo`; never add multer, `UploadFile` handlers or `MultipartFile` endpoints for files people upload.
- Request-id filters, tracing setup for the SDK's operations, or log shippers.
- Error bodies built by hand, or a handler that maps the SDK's exceptions itself. (Java: `egradx-sdk` registers a lowest-precedence fallback advice, `EgradxApplicationExceptionHandler`, that answers the application's own endpoints, so none is needed. An advice of the application's own answers first, for its own answers only; Initializr projects have one, `ApiExceptionHandler`, which is optional. A catch-all `@ExceptionHandler(Exception.class)` must also handle `AccessDeniedException`, or refusals become 500s. Node uses `app.use(...egradxErrors())`, Python `sdk.install(app)`.)
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
| Files people upload (a package of its own) | `egradx-file-storage` beside `egradx-sdk`; an `EgradxFileAccessPolicy` bean per kind of record | `@babulvaibhav/egradx-file-storage`: `createEgradx({ files: createFileStorage({ policies: [fileAccessPolicy(...)] }) })` | `egradx-sdk[files]`: `SdkOptions(files=FilesOptions(policies=[EgradxFileAccessPolicy(...)]))` |
| Business events (a package of its own) | `egradx-platform-events`: `EgradxEventPublisher.publish(type, subject, organizationId, data)` + `EgradxEventHandler` beans | `@babulvaibhav/egradx-events`: `events.publish(type, data, { subject, organizationId })` + handlers; tables by `migrateEgradx` once installed, `events.start()` | `egradx-events`: `await events.publish(type, data, subject=..., organization_id=...)` + handlers; tables by `migrate_egradx` once installed, `await events.start()` |

Rules that apply in every language:
- **Tenant isolation is the application's job in its own queries.** The SDK tells you the caller's organization; every query on the app's own tables must filter by it.
- **Changes worth auditing record an audit event in the same transaction as the change,** with before and after state.
- **Event types are named `<area>.<entity>.<what-happened>.v<N>`** in lower case, with a JSON object as data. Handlers must cope with seeing an event twice and late: no order is promised.
- **Error responses use the SDK's envelope** (`contracts/schemas/error.json`), and its codes (`contracts/schemas/error-codes.json`).
- **Configuration:** Java uses the SDK's `egradx.*` keys (`docs/reference/configuration.md`). Node and Python pass options in code (`createEgradx({...})`, `SdkOptions(...)`), read from the application's own environment variables. Never hard-code secrets: the keys passphrase above all.
- **Sign-up and sign-in methods are configuration.** Who may make an account is `egradx.auth.signup.mode` (`invitation`, the default, or `organization`: anyone may sign up and administers a new organization; Node `auth: { signup }`, Python `SignupSettings`). Emailed codes are `email-code.*`. Providers are `egradx.auth.oidc.callback-base-url` plus `oidc.providers.<id>` with `type: google|zoho`, or `issuer` and `name` for any other OpenID Connect provider (`type: oidc`, the default) (Node `auth: { oidc }`, Python `OidcSettings`/`OidcProviderSettings(type=...)`). The setting is `type`; never write `preset`, its old name. **A provider that is not built in is one class:** an `EgradxSignInProvider` with `id`, `name`, `trustEmail`, `authorizationUrl(request)` and `complete(callback)` returning `{ issuer, subject, email, emailVerified, name }` (a fixed issuer such as `https://github.com` for a provider that is not OpenID Connect), failing with `EgradxSignInProviderException`. Register the object (Java: a bean; Node `oidc.extraProviders`; Python `OidcSettings(extra_providers=[...])`), or a factory for a new `type` (Java: an `EgradxSignInProviderFactory` bean; Node `oidc.providerFactories`; Python `provider_factories`) and configure it under `providers` like Google. An OpenID Connect provider with a quirk extends `EgradxOidcSignInProvider` and overrides `issuerFor` (Python `issuer_for`), as Zoho's does. Never change or copy the SDK's provider classes. See `docs/recipes/add-a-sign-in-provider.md`. Client ids and secrets come from the environment. The redirect URI registered with a provider is exactly `{callback-base-url}/egradx/auth/oidc/{id}/callback`, and the browser comes back to the frontend's `{links.base-url}/auth/callback`. To choose which methods a sign-in page shows, use `SignInMethodsPicker` (copy-in `sign-in-methods-picker`) or `useSignInMethodList({ methods, order, labels })`; never hard-code a provider the server may have off. In the browser use the client's `signInOptions`, `requestEmailCode`/`verifyEmailCode`, `startSignup`/`confirmSignup`, `providerSignInUrl`/`exchangeProviderCode`/`signUpWithProvider`, `useSignInMethods`, or the copy-in `sign-in`, `sign-up`, `auth-callback` and `sign-in-methods` screens. Never call the deprecated `POST /egradx/auth/register`. Never set `trust-email: true` on a provider that does not verify emails. See `docs/guides/sign-in-methods.md`.
- **Files go through `egradx-file-storage`.** Files are attached to the application's records by `attachedType` and `attachedId` (`order` / its id); keep no files table of the app's own (a record may hold a file's id). **Register an access policy for every kind of record that has files** (Java `EgradxFileAccessPolicy` bean, Node `fileAccessPolicy(type, decide)`, Python `EgradxFileAccessPolicy(type, decide)`): it answers `ALLOW`, `DENY` or `DEFAULT` (the `egradx.file.*` permissions decide), and must check that the record exists in the caller's organization. The backend is configuration: `egradx.files.backend` `local` (`local.root`) or `s3` (`s3.bucket`, `.endpoint`, `.path-style`, keys from the environment; Java adds `software.amazon.awssdk:s3`, Node `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, Python `egradx-file-storage[s3]`). A virus scanner is an `EgradxFileScanner`. In the browser use `client.files`, `useAttachments`, `useFileUpload`, `useFileObjectUrl` (never a plain `<img src>` with tokens in the browser) and `useProfilePhoto`, or the copy-in `file-upload`, `attachments` and `avatar-upload` screens. Profile photos are set with `PUT /egradx/auth/my/profile/photo`, not by storing a URL. A proxy in front needs a body limit above `max-size`. Resumable uploads don't exist yet: don't build them; mark the need `EGRADX-PLANNED: resumable upload`. See `docs/guides/files.md`.
- **Sessions are the SDK's.** Every refresh returns a new refresh token, and a replaced one sent again after a 30-second grace ends the whole session (`SESSION_REVOKED`). In the browser use `@babulvaibhav/egradx-client` / `-react` / `-next`, which handle this; never keep a refresh token of your own. People list and end their sessions at `GET` / `DELETE /egradx/auth/my/sessions[/{sessionId}]`: build a screen on those, not a sessions table.
- **Java with its own `SecurityFilterChain`** must add the SDK's `egradxAuthenticationFilter` before `UsernamePasswordAuthenticationFilter`. Otherwise no request is signed in.
- **Starting a new application:** generate it at the portal's `/start` (the Initializr) rather than writing the wiring by hand.
- **The version is 1.0.0 everywhere.** Do not suggest other versions of `com.egradx:*`, `@babulvaibhav/egradx-*` or `egradx-*` packages.
- **Don't patch around an SDK bug in application code.** Tell the developer, so it is fixed in the SDK.

## Before you finish

- [ ] No code from the "Never write these" list.
- [ ] Every endpoint of the application's own checks a permission, or is deliberately public.
- [ ] Every query on the application's own tables filters by the caller's organization.
- [ ] Changes worth auditing record an audit event in their transaction.
- [ ] No sign-up, code sign-in, OAuth/OIDC callback or provider login code; providers are configuration, or one `EgradxSignInProvider` class.
- [ ] Every kind of record with files has an access policy; no upload or download endpoint, files table, multipart handling or S3 code of the app's own.
- [ ] Errors are the SDK's exceptions; no hand-built error bodies.
- [ ] Anything the SDK only plans is behind an interface marked `EGRADX-PLANNED`.
