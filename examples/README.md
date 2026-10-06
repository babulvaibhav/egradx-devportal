# The portal's example applications

The same small application, *notes*, in each language, plus its two frontends. These are [the Initializr](../initializr)'s own output with every capability chosen, built on the **published** SDK 1.0.0 as a developer would start one. The portal's pages cut their code from these files (`docs:region` / `docs:end` markers), and `scripts/capture.mjs` runs the three backends and records what they answer. So every snippet on the portal compiles, and every result shown was produced by that code.

| Folder | What |
|---|---|
| `java/`, `node/`, `python/` | a whole generated project: its `README.md`, `docker-compose.yml`, and the API in `backend/`, grouped by feature (`note/`, with the wiring around the SDK in `common/`) |
| `web-vite/`, `web-next/` | the `frontend/` folder of a generated project, on its own: React with Vite, or Next.js with its backend-for-frontend |
| `recipes/` folders | not generated: code for the recipes the sample feature doesn't cover. Compiled and type-checked with its example, kept when the examples are regenerated |

The recipes are in `java/backend/src/main/java/com/acme/notes/recipes/`, `node/backend/src/recipes/`,
`python/backend/src/notes/recipes/` and `web-vite/src/recipes/`.

Each backend seeds a demo organization, *Demo*, whose administrator is `ada@example.com` / `demo-password` (`DEMO_PASSWORD`).

Don't edit the generated files: change the templates in `initializr/templates/`, then regenerate (`node scripts/generate-examples.mjs`). `--check` fails if an example differs from what the templates make.

## Prepare them

You need [access to the packages](../content/docs/get-started/access.mdx): `GITHUB_TOKEN` with `read:packages`.

```sh
node scripts/refresh.mjs prepare check
```

That packages the Java example, installs the Node and web ones, fetches the Python wheels and syncs, then type-checks the web examples. By hand, see each backend's README (`*/backend/README.md`).

## Record what they answer

```sh
node scripts/capture.mjs        # all three; or name some: java node
```

The script creates a fresh database per language, starts each application with an SMTP server of its own, and walks every scenario the pages show. It checks every answer against what the pages say, and that the three languages answer alike. Then it writes `content/results/*.json`. If any answer is wrong, it fails and writes nothing.

## Everything at once

`node scripts/refresh.mjs` regenerates, prepares, checks, captures, rebuilds the API references and builds the site.
