# EGRADX AI context pack

Markdown for AI coding assistants (Claude Code, Copilot, Cursor, and others), so they build on the EGRADX SDK instead of re-implementing what it already does.

## Put it in your project

1. Unzip this folder into the root of your application, as `egradx-sdk-docs/`.
2. Point your assistant at it. Add one line to the file your assistant reads (create it if there is none):
   - Claude Code: `CLAUDE.md`
   - Codex and others: `AGENTS.md`
   - Cursor: `.cursor/rules/egradx.md` (or `.cursorrules`)
   - GitHub Copilot: `.github/copilot-instructions.md`

   ```
   This application is built on the EGRADX SDK. Before writing code, read egradx-sdk-docs/AGENTS.md and follow it.
   Use egradx-sdk-docs/docs/ for how to use the SDK, and egradx-sdk-docs/contracts/ for its API, errors and events.
   ```

3. Commit the folder, so everyone's assistant follows the same rules. Download a new pack when the portal changes; the date and commit it was built from are below.

## What is inside

| Path | What it is |
|---|---|
| `AGENTS.md` | The rules: what the SDK does, what the application must never write, how each language does each task |
| `docs/` | Every page of the developer portal, as Markdown |
| `contracts/` | The SDK's language-neutral contracts: the HTTP API (OpenAPI), the error envelope and codes, token claims, headers, events (AsyncAPI) |
