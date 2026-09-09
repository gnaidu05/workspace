# The hosted deployment

**Live: https://campusroute-planner.higgsfield.app** — the landing page, with the
planner itself at **/planner**.

That host runs a single Cloudflare Worker (React 19 + TanStack Start, server
rendered) with a D1 database, so the public site is the *whole* app: plans are
published, shared by link and edited by whoever holds the edit key, exactly as
in the Node version.

## How the same program runs in two places

| | `campusroute/` (Node) | the Worker |
| --- | --- | --- |
| Front end | `public/*` as ES modules | `docs/campusroute.html`, the single-file build of those same modules, served verbatim at `/planner` |
| Planning engine | `public/engine.js` | the same file, copied in and imported by the API route so both ends validate identically |
| API | `src/api.js` + `src/store.js` (JSON files) | `api-route.ts` (D1) — same five endpoints, same status codes, same optimistic concurrency |
| Plan storage | one JSON file per plan, atomic writes | one `plans` row per plan (`schema.sql`) |
| Edit keys | SHA-256 hash on disk | SHA-256 hash in D1 |

The files here are the deployed sources, kept in the repo so the hosting is
reproducible and reviewable:

- `api-route.ts` — the `/api/*` splat route: health, create, read, update
  (revision-checked), delete. Authorises before it validates, and never stores a
  plan the engine rejects.
- `planner-route.ts` — serves the single-file build at `/planner`.
- `schema.sql` — the `plans` table.

## Redeploying it

1. `npm run build:single` in `campusroute/` — regenerates `docs/campusroute.html`.
2. Copy that file into the site repo as `app/src/planner-page.html`, and
   `public/engine.js`, `public/geography.js`, `public/data/{airports,cities}.js`
   into `app/src/planner/` (the API route imports `validateState` from there).
3. Copy the two route files here into `app/src/routes/api/$.ts` and
   `app/src/routes/planner.ts`, keep `app/app.manifest.json` at `"db": true`,
   and keep the `plans` table in `app/migrations/0001_init.sql`.
4. Push the site repo and deploy it.

## What differs from the Node version

- Per-IP write rate limiting is left to the platform edge rather than counted in
  the app.
- A plan cap of 5,000 rows guards the shared database; the Node server's
  `MAX_PLANS`, `PLAN_TTL_DAYS` and `WRITE_LIMIT` knobs have no equivalent here.
- Everything else — validation, revisions, 403/409 semantics, hashed keys — is
  the same code path.
