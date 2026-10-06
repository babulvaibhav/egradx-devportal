# Notes: the frontend

The web app, React with Vite and `@babulvaibhav/egradx-react`. The project's [README](../README.md) shows what is where. Run everything below from this folder.

The packages are on GitHub Packages: `.npmrc` reads the token in `GITHUB_TOKEN` (see `../backend/README.md`).

```sh
npm install
npm run dev                            # http://localhost:5173
```

Start the backend first: in development, Vite sends `/api` and `/egradx` to it at http://localhost:8080
(`VITE_PROXY_TARGET` changes that). Sign in as ada@example.com / demo-password.

```sh
npm run build                          # what CI runs: type-check and build
```
