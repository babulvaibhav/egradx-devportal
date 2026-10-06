# Notes

The developer portal's example application

Built on the [EGRADX SDK](https://github.com/babulvaibhav/egradx-v1-workspace) 1.0.0: sign-in and permissions,
the audit trail and notifications come from the SDK, so this code is the application's own business only. It starts
with a sample feature, *notes*, that uses each capability you chose; keep it as a pattern or delete it.

## 1. Access to the SDK's packages

The packages are on GitHub Packages, which asks for a token even to read. Create a token (classic) with the scope
`read:packages` and keep it in `GITHUB_TOKEN`:

```sh
export GITHUB_TOKEN=ghp_...            # Windows PowerShell: $env:GITHUB_TOKEN = "ghp_..."
```

The Python packages are wheels on the GitHub release `python-v1.0.0`. Download them into `egradx-wheels/`
(`pyproject.toml` installs from there):

```sh
python scripts/get_wheels.py           # or: gh release download python-v1.0.0 -R babulvaibhav/egradx-v1-workspace -p "*.whl" -D egradx-wheels
```

## 2. Run it

```sh
docker compose up -d                   # PostgreSQL, Mailpit, Jaeger, Prometheus
```

```sh
uv sync
EGRADX_KEY_PASSPHRASE=change-me uv run python main.py
```

On the first start the SDK creates its tables, then this application's, generates its signing keys in `./keys`, and
creates the platform's administrator. The application then adds its permissions (`note.read`, `note.write`) and a
demo organization, *Demo*, whose administrator is **ada@example.com** / **demo-password**.

## 3. Try it

```sh
# Sign in
TOKEN=$(curl -s -X POST http://localhost:8080/egradx/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"ada@example.com","password":"demo-password"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')

# Create a note
curl -s -X POST http://localhost:8080/api/notes -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"First note"}'

# Its audit record, and the notice in everyone's bell
curl -s "http://localhost:8080/egradx/audit/events?action=notes.note.created" -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:8080/egradx/notifications -H "Authorization: Bearer $TOKEN"

# The count an event handler keeps, a moment after the commit
curl -s http://localhost:8080/api/notes/stats -H "Authorization: Bearer $TOKEN"
```

The email to the note's author is in Mailpit: <http://localhost:8025>.

Traces are in Jaeger (<http://localhost:16686>), metrics in Prometheus (<http://localhost:9090>).

## Tests

The tests run the application over HTTP against the `notes_test` database (docker compose creates it;
`TEST_DB_URL` points elsewhere).

```sh
uv run pytest
```

## Docker image

```sh
python scripts/get_wheels.py && docker build -t notes .
```

Every instance must share one `keys` volume, and the first start must finish before a second instance starts: it is
the one that creates the keys.

## Where things are

| | |
|---|---|
| `notes.py` | the endpoints and the business logic: permission, organization, audit record, notice |
| `seeding.py` | this application's permissions, and the demo organization |
| `main.py` | the SDK wired in, migrations first |
| `events.py` | an event handler |
| `migrations/` | this application's tables |

Learn more on the EGRADX Developer Portal: guides for each capability, recipes, and the reference.
