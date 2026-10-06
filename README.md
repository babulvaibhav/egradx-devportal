# EGRADX Developer Portal

The one place to learn and use the EGRADX SDK: guides in Java, Node and Python, code cut from OIM, and the AI context pack. The plan, with what comes next, is [docs/devportal/plan.md](../../docs/devportal/plan.md).

A **static site**: Next.js 16 with `output: 'export'` and [Fumadocs](https://fumadocs.dev) (MDX, search, `llms.txt`), styled with Tailwind 4. No server and no functions; it deploys to Netlify from GitHub (`netlify.toml`, in this folder). It builds from this folder alone, so it can live in a repository of its own: what it needs from the rest of the monorepo is copied into `sources/` (see `sources/README.md`).

## Run it

```sh
cd apps/egradx-devportal
npm install
npm run dev        # http://localhost:3000, rebuilds as you edit
npm run build      # the site, in out/
npm start          # serve out/ locally
```

`npm run build` first runs `scripts/sync-sources.mjs`. In the monorepo it refreshes `sources/` from OIM's code, `contracts/` and the SDKs, and you commit the result; in the portal's own repository it only checks that `sources/` has everything.

## Where things are

| Path | What |
|---|---|
| `content/docs/` | The pages, as MDX. `meta.json` files order the sidebar |
| `components/languages.tsx` | `<Languages>` / `<Tab value="Java">`: tabs per language, switched together and remembered |
| `components/repo-snippet.tsx`, `lib/snippets.ts` | `<RepoSnippet file=… region=…/>`: code cut from a file in the repository at build time |
| `ai-pack/` | The rules and README of the AI context pack |
| `app/downloads/egradx-ai-context.zip/route.ts` | Builds the pack: the rules, every page as Markdown, and the contracts |
| `app/llms.txt`, `app/llms-full.txt`, `app/llms.mdx` | The site as Markdown for AI tools |
| `app/(home)/start/`, `components/initializr/`, `initializr/` | The Initializr at `/start`: `manifest.json` (the choices and which files each needs), `templates/**` (Handlebars), `core/` (pure TypeScript, also used by the scripts) |
| `examples/` | The Initializr's output with everything chosen, plus `recipes/` files: what the pages cut code from ([examples/README.md](examples/README.md)) |
| `content/results/` | What the examples answered, recorded by `scripts/capture.mjs`; shown by `<RecordedRun>` |
| `data/` | Parity marks, error-code meanings, search synonyms, and the Java configuration keys (generated) |
| `tools/reference/` | TypeDoc (it needs TypeScript 6, the site builds with 7) and the Python API writer |
| `public/reference/java/` | The Java javadoc (generated) |

## Showing code from the repository

Mark the region in the source file with comments, then name it on a page:

```java
// docs:region create-product-endpoint
@PostMapping
…
// docs:end
```

```mdx
<RepoSnippet file="apps/egradx-oim/backend/src/main/java/com/egradx/oim/product/api/ProductController.java" region="create-product-endpoint" />
```

A missing or empty region fails the build, so renaming or deleting the code cannot silently break a page.

## Scripts

| Script | Does | Run |
|---|---|---|
| `scripts/refresh.mjs` | everything below that is generated, in order, then the build | after an SDK or template change |
| `scripts/generate-examples.mjs` | regenerates `examples/*` from the templates (`--check` compares) | after a template change |
| `scripts/test-initializr.mjs` | generates, builds, tests and starts every Initializr combination | after a template change |
| `scripts/capture.mjs` | runs the examples and records what they answer | after an example or SDK change |
| `scripts/build-api-reference.mjs` | the Node, web, Python and Java API references, and the Java configuration keys | after an SDK change |
| `scripts/build-reference.mjs` | the contract references (HTTP, errors, events, database, configuration…) | every build |
| `scripts/sync-sources.mjs` | copies what the pages need from the monorepo into `sources/` | every build |
| `scripts/check-links.mjs` | checks every internal link and anchor of the built site | every build |
| `scripts/import-screens.mjs` | copies OIM's browser-test screenshots into `public/screens/` | after the browser tests |

The scripts that need the SDK's packages read the token from `GITHUB_TOKEN`, or from the `egradx-sdk-github` server in `~/.m2/settings.xml`, and never print it.
