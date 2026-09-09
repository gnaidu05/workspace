# CampusRoute on Vercel

This repository's Vercel project serves the planner from one serverless
function, alongside the Drive app that already lives here:

| Path | What it is |
| --- | --- |
| `/campusroute` | the planner page (the single-file build, with its API base pointed at `/campusroute/api`) |
| `/campusroute/api/*` | the plan API: health, create, read, update, delete |
| everything else | unchanged — still the Drive app in `api/index.js` |

The pieces:

- **`api/campusroute.js`** — the function (CommonJS, like `api/index.js`).
- **`api/_campusroute-bundle.js`** — generated: the built page plus the
  validation half of the engine, in one CommonJS file. The function therefore
  depends on nothing outside `api/`: no cross-package ES modules for the bundler
  to trace, and nothing read off disk at runtime. An ESM function that imported
  those files across packages deployed cleanly and then failed at module load in
  production with no way to see why, which is what this avoids.
- **`vercel.json`** — two rewrites ahead of the existing catch-all, passing the
  sub-path as `?path=` so the function never has to guess the original URL.

## Storage

Serverless functions have no disk, so plans live in **libSQL/Turso** — the same
database driver this project already depends on — in their own
`campusroute_plans` table, created on first use. The function reads:

| Variable | Purpose |
| --- | --- |
| `CAMPUSROUTE_DATABASE_URL` | database URL — preferred |
| `CAMPUSROUTE_AUTH_TOKEN` | its auth token |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | fallback: this project's existing pair |

`CAMPUSROUTE_*` wins when both are present, so the planner can point at its own
database without disturbing anything else in the project.

**With no database configured the planner still runs** — every view, every
calculation, exports and imports — it just stays in local-draft mode and says
so, because publishing a shared link needs somewhere to put the plan.
`GET /campusroute/api/health` reports `{"db": false}` in that state.

## Deploying

Vercel builds this repository automatically:

- a push to the **default branch** updates production (the public URL);
- a push to any other branch creates a **preview** deployment, which is behind
  Vercel's SSO unless deployment protection is turned off — so a preview URL is
  not a public link.

After a deploy, check `https://<host>/campusroute/api/health`:

```json
{ "ok": true, "db": true, "page": true, "engine": true, "credentials": "CAMPUSROUTE_DATABASE_URL" }
```

`credentials` names the variable the deployment picked up (never its value),
`db` says whether that database actually answered, and `page`/`engine` confirm
the generated bundle shipped. With `"db": false` the
planner runs in local-draft mode and hides Publish; an `error` field appears if
the variables are set but the database refused the connection.

## Checking a deployment

```bash
node campusroute/deploy/vercel/check.mjs https://<host>/campusroute
```

It reads health, serves the page, then publishes a throwaway plan and walks the
whole cycle — public read, edit-key unlock, refused write, saved write, stale
conflict, invalid plan, delete — and cleans up after itself. With no plan store
configured it reports that and stops after the page checks.

## Rebuilding after a change

```bash
cd campusroute && npm run build:vercel
```

That regenerates `docs/campusroute.html` and `api/_campusroute-bundle.js`.
Commit both — the deployment serves exactly what is committed.

## Differences from the Node server

- Rate limiting is left to the platform edge instead of being counted in-app.
- A 5,000-plan cap guards the shared database; `MAX_PLANS`, `PLAN_TTL_DAYS` and
  `WRITE_LIMIT` have no equivalent here.
- Everything else — validation, revisions, 403/409 semantics, hashed edit keys —
  is the same code path.
