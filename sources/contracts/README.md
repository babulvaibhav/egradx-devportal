# EGRADX contracts

This folder is the language-neutral source of truth that every EGRADX SDK (Java, Node, Python) and the web client implement. When an SDK and this folder disagree, the SDK is wrong.

Why the folder exists, and the rules around it, are in [docs/architecture/multi-language-sdk-plan.md](../docs/architecture/multi-language-sdk-plan.md).

```
contracts/
├── openapi/              the HTTP API each SDK serves under /egradx/**
│   ├── auth.yaml
│   ├── audit.yaml
│   └── notification.yaml
├── events/
│   ├── asyncapi.yaml     event types, the CloudEvents envelope, and how each transport carries them
│   └── schemas/          cloudevent.json (the envelope) and <type>.json (each type's data)
├── db/postgresql/        the tables each capability owns, as versioned migrations
│   ├── auth/             V1–V5
│   ├── audit/            V1
│   ├── notification/     V1–V8
│   └── events/           V1: the event outbox and inbox
├── notification-templates/  the libraries' own message templates
│   ├── egradx-notification/       the channel test
│   ├── egradx-notification-auth/  password reset, invitation, email change, contact verification
│   └── rendering-test-vectors.json  what every SDK's template renderer must produce
├── test-vectors/         values every SDK must read or produce alike
│   ├── secret-envelope.json   a sealed secret to open, as an envelope and as text
│   ├── core-utils.json        gzip to unzip, the random-string alphabet
│   ├── argon2-password.json   a password hash to accept
│   ├── tls-keystore.json      a key in both PEM formats, its certificate and JWKs
│   ├── observability.json     the stored trace context written and read; metric names and tags accepted
│   ├── events.json            CloudEvents to read and write back the same; event types to refuse
│   └── refresh-token.json     how a refresh token is stored: its SHA-256
└── schemas/
    ├── error.json        the error envelope on every non-2xx response
    ├── error-codes.json  known error.code values, per module
    ├── jwt-claims.json   access-token payload
    ├── enums.json        shared enums
    └── headers.md        request, response and webhook headers
```

## How the Java SDK uses each part

| Part | Java | Checked by |
|---|---|---|
| `events/` | `egradx-platform-events` writes and reads `schemas/cloudevent.json`'s envelope (`EgradxEvent`); `egradx-observability`'s `EgradxLogRecord` is `egradx.log.record.v1`'s data | Each SDK's own contract test with `test-vectors/events.json` (Java `EgradxEventContractTest`, Node `contract.test.ts`, Python `test_contract.py`), and each SDK's two-service tests against RabbitMQ and Kafka |
| `db/postgresql/events/` | copied into `egradx-platform-events` at `db/egradx-events/postgresql/`; packaged by `@babulvaibhav/egradx-events` (`sql/`) and `egradx-events` | the events test suites, on a real PostgreSQL |
| `db/postgresql/auth/`, `audit/`, `notification/` | copied into the jars at `db/egradx-<module>/postgresql/`, where each library's migrator reads them. egradx-auth's runs before the application's own migrations; the others run after. | the auth, audit and notification test suites, which migrate a real PostgreSQL. Auth's also validates every entity against the result. |
| `notification-templates/` | each folder copied into its library's jar (`egradx-notification`, `egradx-notification-auth`) at `egradx-notification/templates/`, the classpath location templates are read from. Node packages the same files into `@babulvaibhav/egradx-notification` and `@babulvaibhav/egradx-notification-auth`. | each SDK's startup check, which compiles every template file against its notification type |
| `notification-templates/rendering-test-vectors.json` | `EgradxRenderingContractTest` renders every case with Java's renderer | each SDK's own renderer test, case by case: Java, Node (`templates.test.ts`), Python (`test_handlebars.py`) |
| `test-vectors/` | `EncryptionUtilTest` opens the envelope and the sealed text; `EgradxCoreUtilsContractTest` unzips the gzip cases and checks the alphabet; `EgradxPasswordContractTest` checks the hash with the encoder egradx-auth registers; `EgradxTlsContractTest` reads the keystore and makes its JWKs; `EgradxObservabilityContractTest` writes and reads the trace context and checks the names and tags | the same checks in each SDK: Node core, auth, tls-provider and observability; Python core, auth, tls-provider and observability. The tls-provider tests also reproduce Java's certificate byte for byte |
| `openapi/` | generated from the libraries' controllers | `Egradx{Auth,Audit,Notification}OpenApiContractTest`, which fail when the served API differs |
| `schemas/` | written from the code: see the `description` in each file for the Java classes it mirrors | review |

The Java modules find this folder through the `egradx.contracts.dir` property in `sdks/java/pom.xml`.

The web client, [`@babulvaibhav/egradx-client`](../sdks/web/packages/client), generates its TypeScript types from `openapi/` and `schemas/error-codes.json` (`pnpm run generate` in that package). After a contract changes, regenerate them along with the Java contract files.

## Test vectors: the contract decides, not an SDK

Where every SDK must behave identically and the behaviour is easier to show than to describe (rendering a template, opening a sealed secret, checking a password hash), the expected results are written down here, and **each SDK tests its own code against them**. No SDK's tests read another SDK's files or output (decided with the user, 2026-10-02). The vectors were seeded from what the Java SDK produced, so Java passes them by construction. When a case is added, add its expected result here first, then make every SDK pass it.

## Changing a contract

1. **Database:** add a new migration file, `V<next>__<what>.sql`. Never edit an applied one; applications have already recorded its checksum.
2. **Events:** only make changes that are backward compatible under Avro rules. Add fields with defaults; don't rename or remove fields. For anything else, create a new topic version (`.v2`).
3. **HTTP API:** change the Java controller, then regenerate the OpenAPI file (below). Commit the controller and the YAML together, so reviewers see the API change.
4. **Schemas:** edit the file and the Java code in the same change.

Then record the change in each SDK that implements it. A capability is only at parity in a language when its conformance tests pass (plan step 3).

## Regenerating the OpenAPI files

Run this from the workspace root:

```bash
mvn -pl sdks/java/egradx-auth,sdks/java/egradx-audit,sdks/java/egradx-notification -am test \
    -Dtest='*OpenApiContractTest' -Dsurefire.failIfNoSpecifiedTests=false -Degradx.contracts.write=true
```

Without `-Degradx.contracts.write=true`, the same command checks the files instead of writing them. The audit and notification tests need the local PostgreSQL that their other tests use (`EGRADX_TEST_PG_*`, default `localhost:5432`, `postgres`/`postgres`).

## Format rules

- **JSON files are strict JSON:** no comments and no trailing commas. Put explanations in `description` (JSON Schema) or `doc` (Avro), so that Node's and Python's parsers accept every file.
- **Names are exact.** Enum values, error codes, claim names and header names are compared byte for byte, including existing misspellings such as `DEPLOYEMENT`.
- **In `openapi/`, a property not listed under `required` may be `null`.** The generator marks it as `type: [<type>, "null"]`, or as `anyOf` a `$ref` and `null`, because Java serializes absent values as `null`. An SDK may send `null` for such a property and must accept it; omitting it is fine too.

The [conformance suite](../conformance/README.md) checks an application against these files over HTTP.
