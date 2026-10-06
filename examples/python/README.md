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
└── backend/                       the API (Python, FastAPI): backend/README.md
```

Inside `backend/`, the code is grouped **by feature**: everything about notes is in one `note/` folder, and the wiring
around the SDK in `common/`. A new feature is a new folder beside `note/`, built the same way.

```
backend/
├── pyproject.toml
├── .env.example                   the settings it reads
├── Dockerfile
├── scripts/get_wheels.py          downloads the SDK's wheels
├── migrations/                    this application's tables (SQL, run at start-up after the SDK's)
├── notification-templates/        the email's templates
├── src/notes/
│   ├── __main__.py                starts the server: python -m notes
│   ├── app.py                     builds the application: the SDK, migrations, routes
│   ├── config.py                  everything read from the environment
│   ├── common/                    seeding.py: this application's permissions, and the demo organization; telemetry.py
│   └── note/                      the sample feature
│       ├── routes.py              the endpoints: permission, organization, audit record, notice
│       ├── audit_actions.py       the words the audit screen shows for its actions
│       ├── notifications.py       the email's type
│       └── stats_handler.py       handles the event a new note publishes
└── tests/test_note.py
```

## Where to look

| To | Look in |
|---|---|
| add an endpoint, or change who may call it | `backend/src/notes/note/routes.py` |
| add a feature | a new folder beside `note/`, wired into `app.py` |
| add a permission | `backend/src/notes/common/seeding.py` |
| add a column or a table | a new file in `backend/migrations/` |
| change an email | `backend/notification-templates/` (`email.subject.txt`, `email.body.html`) |
| change a setting | `backend/.env.example` lists them; set them in the environment |

## Run it

1. **Access to the SDK's packages.** They are on GitHub Packages, which asks for a token even to read. Create a token
   (classic) with the scope `read:packages` and keep it in `GITHUB_TOKEN`. `backend/README.md` says how uv reads it.
2. **The services:** `docker compose up -d`, from this folder.
3. **The backend:** see `backend/README.md`. It answers on http://localhost:8080.

On the first start the SDK creates its tables, then this application's, generates its signing keys in `backend/keys`,
and creates the platform's administrator. The application then adds its permissions (`note.read`, `note.write`) and a
demo organization, *Demo*, whose administrator is **ada@example.com** / **demo-password**.

The email to a note's author is in Mailpit: <http://localhost:8025>.

Traces are in Jaeger (<http://localhost:16686>), metrics in Prometheus (<http://localhost:9090>).

Learn more on the EGRADX Developer Portal: guides for each capability, recipes, and the reference.
