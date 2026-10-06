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
└── backend/                       the API (Java, Spring Boot): backend/README.md
```

Inside `backend/`, the code is grouped **by feature**: everything about notes is in one `note/` folder, and the wiring
around the SDK in `common/`. A new feature is a new folder beside `note/`, built the same way.

```
backend/
├── pom.xml, mvnw                  the build (Maven)
├── .env.example                   the settings it reads
├── Dockerfile
└── src/
    ├── main/java/com/acme/notes/
    │   ├── NotesApplication.java          starts the application
    │   ├── common/
    │   │   ├── config/Setup.java          this application's permissions, and the demo organization
    │   │   └── exception/ApiExceptionHandler.java   its errors in the SDK's envelope
    │   └── note/                          the sample feature
    │       ├── api/                       NoteController: the endpoints, and the permission each needs
    │       ├── application/               NoteService: the logic, with its audit record, email and notice and event;
    │       │                              NoteDtos, NoteAuditActions, NoteNotifications
    │       ├── domain/                    Note: the table's entity
    │       ├── infrastructure/            NoteRepository: every query scoped to the caller's organization
    │       └── events/                    NoteStatsHandler: handles the event a new note publishes
    ├── main/resources/
    │   ├── application.yml                the configuration
    │   ├── notification-templates/        the email's templates
    │   └── db/migration/                  this application's tables (Flyway)
    └── test/java/com/acme/notes/note/NoteApiTest.java
```

## Where to look

| To | Look in |
|---|---|
| add an endpoint, or change who may call it | `backend/src/main/java/com/acme/notes/note/api/` |
| change what happens when a note is saved | `note/application/NoteService.java` |
| add a feature | a new folder beside `note/`, with the same four (`api`, `application`, `domain`, `infrastructure`) |
| add a permission | `common/config/Setup.java` |
| add a column or a table | a new file in `backend/src/main/resources/db/migration/` |
| change an email | `backend/src/main/resources/notification-templates/` (`email.subject.txt`, `email.body.html`) |
| change a setting | `backend/.env.example` lists them; set them in the environment |

## Run it

1. **Access to the SDK's packages.** They are on GitHub Packages, which asks for a token even to read. Create a token
   (classic) with the scope `read:packages` and keep it in `GITHUB_TOKEN`. `backend/README.md` says how Maven reads it.
2. **The services:** `docker compose up -d`, from this folder.
3. **The backend:** see `backend/README.md`. It answers on http://localhost:8080.

On the first start the SDK creates its tables, then this application's, generates its signing keys in `backend/keys`,
and creates the platform's administrator. The application then adds its permissions (`note.read`, `note.write`) and a
demo organization, *Demo*, whose administrator is **ada@example.com** / **demo-password**.

The email to a note's author is in Mailpit: <http://localhost:8025>.

Traces are in Jaeger (<http://localhost:16686>), metrics in Prometheus (<http://localhost:9090>).

Learn more on the EGRADX Developer Portal: guides for each capability, recipes, and the reference.
