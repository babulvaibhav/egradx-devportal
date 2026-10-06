# Notes

The developer portal's example application

Built on the [EGRADX SDK](https://github.com/babulvaibhav/egradx-v1-workspace) 1.0.0: sign-in and permissions,
the audit trail and notifications come from the SDK, so this code is the application's own business only. It starts
with a sample feature, *notes*, that uses each capability you chose; keep it as a pattern or delete it.

## What is where

```
notes/
├── README.md                      this file
├── docker-compose.yml, docker/    the services it needs locally: PostgreSQL, Mailpit, Jaeger, Prometheus
└── backend/                       the API (Node, Express): backend/README.md
```

Inside `backend/`, the code is grouped **by feature**: everything about notes is in one `note/` folder, and the wiring
around the SDK in `common/`. A new feature is a new folder beside `note/`, built the same way.

```
backend/
├── package.json, tsconfig.json
├── .env.example                   the settings it reads
├── Dockerfile
├── prisma/schema.prisma           maps this application's tables (the SDK's are not in it)
├── migrations/                    this application's tables (SQL, run at start-up after the SDK's)
├── notification-templates/        the email's templates
├── src/
│   ├── main.ts                    starts the server (telemetry first)
│   ├── app.ts                     builds the application: the SDK, migrations, routes, the error handler
│   ├── config.ts                  everything read from the environment
│   ├── common/                    setup.ts: this application's permissions, and the demo organization; telemetry.ts; logging.ts
│   └── note/                      the sample feature
│       ├── routes.ts              the endpoints: permission, organization, audit record, notice
│       ├── audit-actions.ts       the words the audit screen shows for its actions
│       ├── notifications.ts       the email's type
│       └── stats-handler.ts       handles the event a new note publishes
└── test/note.test.ts
```

## Where to look

| To | Look in |
|---|---|
| add an endpoint, or change who may call it | `backend/src/note/routes.ts` |
| add a feature | a new folder beside `src/note/`, wired into `src/app.ts` |
| add a permission | `backend/src/common/setup.ts` |
| add a column or a table | a new file in `backend/migrations/`, then `prisma/schema.prisma` and `npx prisma generate` |
| change an email | `backend/notification-templates/` (`email.subject.txt`, `email.body.html`) |
| change a setting | `backend/.env.example` lists them; set them in the environment |

## Run it

1. **Access to the SDK's packages.** They are on GitHub Packages, which asks for a token even to read. Create a token
   (classic) with the scope `read:packages` and keep it in `GITHUB_TOKEN`. `backend/README.md` says how npm reads it.
2. **The services:** `docker compose up -d`, from this folder.
3. **The backend:** see `backend/README.md`. It answers on http://localhost:8080.

On the first start the SDK creates its tables, then this application's, generates its signing keys in `backend/keys`,
and creates the platform's administrator. The application then adds its permissions (`note.read`, `note.write`) and a
demo organization, *Demo*, whose administrator is **ada@example.com** / **demo-password**.

The email to a note's author is in Mailpit: <http://localhost:8025>.

Traces are in Jaeger (<http://localhost:16686>), metrics in Prometheus (<http://localhost:9090>).

Learn more on the EGRADX Developer Portal: guides for each capability, recipes, and the reference.
