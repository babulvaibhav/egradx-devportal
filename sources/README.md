# sources/

Copies of the files the portal reads from the rest of the EGRADX monorepo (`egradx-v1-workspace`), at their paths
there: OIM's code that pages cut excerpts from, `contracts/`, and the inputs of the generated references.

**Do not edit them here.** `scripts/sync-sources.mjs` writes them, and `npm run build` runs it first:

- **In the monorepo** it refreshes this folder from the real files, so commit the folder with the change that caused it.
- **In the portal's own repository** nothing is copied. The build checks that every file the pages need is here, and
  fails if one is missing.

`files.txt` lists what is here.
