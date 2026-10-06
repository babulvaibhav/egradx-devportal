# Notes: the backend

The API, in Node with Express and Prisma, on the EGRADX SDK 1.0.0. The project's
[README](../README.md) shows what is where. Run everything below from this folder.

## Access to the SDK's packages

Create a GitHub token (classic) with the scope `read:packages` and keep it in `GITHUB_TOKEN`:

```sh
export GITHUB_TOKEN=ghp_...            # Windows PowerShell: $env:GITHUB_TOKEN = "ghp_..."
```

`.npmrc` already reads it, so `npm install` works as it is.

## Run it

Start the services first, from the project's folder: `docker compose up -d`.
`.env.example` lists every setting; only `EGRADX_KEY_PASSPHRASE` has no default.

```sh
npm install
npx prisma generate
EGRADX_KEY_PASSPHRASE=change-me npm run dev
```

## Try it

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

## Tests

The tests run the application over HTTP against the `notes_test` database (docker compose creates it;
`TEST_DB_URL` points elsewhere).

```sh
npm test
```

## Docker image

```sh
docker build --secret id=github-token,env=GITHUB_TOKEN -t notes .
```

Every instance must share one `keys` volume, and the first start must finish before a second instance starts: it is
the one that creates the keys.
