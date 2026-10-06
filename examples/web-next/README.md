# Notes: the frontend

The web app, Next.js with `@babulvaibhav/egradx-next`, whose backend-for-frontend keeps the tokens in
HttpOnly cookies. The project's [README](../README.md) shows what is where. Run everything below from this folder.

The packages are on GitHub Packages: `.npmrc` reads the token in `GITHUB_TOKEN` (see `../backend/README.md`).

```sh
npm install
npm run dev                            # http://localhost:3000
```

Start the backend first: the backend-for-frontend calls it at http://localhost:8080 (`EGRADX_API_URL` changes
that). Sign in as ada@example.com / demo-password.

```sh
npm run build                          # what CI runs: type-check and build
```
