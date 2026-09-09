# CampusRoute — a public assessment travel planner

Plan multi-stop college visits for travelling teams: group fixed-date visits
into shared tours, work out road, air and rail travel around them, count
overnight stays, assign teams and named people, and see what the grouping saves
against sending someone on a separate trip per visit.

**No accounts.** A plan starts as a local draft in your browser. Publish it and
you get two links — a **view link** to circulate and an **edit link** to keep.
Anyone holding the view link can read the plan and fork their own copy; anyone
holding the edit link can change it.

This is a public rebuild of a private, single-owner planner. The teardown of the
original and every difference is documented in
**[docs/how-it-works.md](docs/how-it-works.md)**.

---

## Run it

```bash
cd campusroute
npm start            # http://localhost:3000 — no dependencies to install
npm test             # 45 tests: engine, rosters, imports, API
```

Node 20+ . There are **no runtime dependencies**: the server is `node:http`, the
front end is plain ES modules, and plans are JSON files on disk.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | where to listen |
| `DATA_DIR` | `./data` | where plan files are written |
| `MAX_PLAN_BYTES` | `2000000` | largest plan the API will accept |
| `MAX_PLANS` | `20000` | cap on stored plans |
| `PLAN_TTL_DAYS` | `0` (keep for ever) | delete plans untouched for this long |
| `WRITE_LIMIT` | `120` | writes per IP per minute |

Health check: `GET /api/health` → `{"ok":true}`.

### Deploy

Any host that runs Node and gives it a writable directory works. With Docker:

```bash
docker build -t campusroute .
docker run -d -p 3000:3000 -v campusroute-data:/data -e DATA_DIR=/data campusroute
```

For a host with no disk, mount a volume at `/data` (Fly.io, Railway, Render with
a persistent disk) — a plan that cannot be written cannot be shared.

### No server at all

```bash
npm run build:single      # -> docs/campusroute.html
```

One self-contained file: the whole planner, no modules, no API. Open it from
disk or host it anywhere static (GitHub Pages, an intranet share). Plans then
live only in the visitor's own browser storage — publishing and shared links are
unavailable, everything else works.

---

## Using it

1. **Colleges & dates** — add colleges, then search OpenStreetMap for the actual
   campus and confirm the pin. Without a pin, travel is priced from the city
   reference point and the app says so on every row.
2. **Teams** — set each team's size, base and (optionally) member names. Named
   people can be assigned to a visit and are never double-booked.
3. **Assumptions** — road speed, airport time, the working day, daily travel and
   duty caps, overnight rest, nights away per route, and the routing priority.
4. **Generate routes** — the planner groups what it can, and says why anything it
   cannot route is stuck.
5. **Publish** — share the view link; keep the edit link.

Exports: JSON plan (re-importable), a person-day CSV roster, an activity CSV
roster, a plain-text brief, and print/PDF.

Imports: a JSON plan exported here, or a CSV with the headers
`college, city, date, start, duration, team` and optionally
`latitude, longitude, address, airport, interview_date, interview_start,
interview_duration`. A CSV coordinate counts as a confirmed campus pin.

---

## How the planning works

Times are stored as hours since the epoch on a UTC-shaped calendar, so a 09:00
IST visit is `09:00Z` internally — day boundaries and overnight rest stay simple
and nothing depends on the viewer's time zone.

- **Visits are fixed.** Dates never move; only the travel around them is planned.
  A college can carry both an assessment and an interview round.
- **One trip per visit, then merge.** Every visit begins as its own
  base-and-back trip. Pairs are merged whenever the combination stays feasible
  and saves more weighted cost than it adds — a deterministic local search with
  a fixed per-tour cost, not a proven optimum.
- **Travel has to fit the day.** Travel is placed between `dayStart` and
  `dayEnd`, capped by `maxTravel` and `maxDuty` per day, with `rest` hours
  between days and a buffer either side of each visit. Road journeys can split
  across days; a flight or train cannot. The outbound leg is planned backwards
  from the appointment, so departure is as late as the day allows.
- **Modes.** Road uses a measured OSRM route when both ends are pinned, else
  straight-line distance × a factor ÷ your average speed, plus 15 minutes per
  200 km. Air is a 650 km/h great-circle flight + 30 min, your airport buffer,
  and transfers at both ends. Rail is always figures you enter. Air wins
  automatically if it saves more than 45 minutes; rail wins if it is shorter and
  quicker. Any leg can be overridden, and an override is tied to the exact pins
  and airport it was measured for.
- **Saved travel** compares the grouped plan with a separate base–college–base
  trip for every covered visit, at the same estimates and team sizes.

### What it never claims

No fares, no live traffic, no flight or train availability, no bookings.
Overnight stays are assumed where a route cannot get home, not reserved. Every
number is a planning estimate to confirm before anyone travels.

---

## API

```
GET    /api/health                                → { ok }
POST   /api/plans          { state }              → { id, editKey, revision, updatedAt }
GET    /api/plans/:id                             → { state, revision, updatedAt, canEdit }
PUT    /api/plans/:id      { state, revision }    → { revision, updatedAt }     X-Edit-Key
DELETE /api/plans/:id                             → { ok }                      X-Edit-Key
```

- The edit key is sent as the `X-Edit-Key` header and lives in the URL fragment
  in the browser, so it never reaches a server log or a `Referer` header. Only
  its SHA-256 hash is stored.
- `revision` is optimistic concurrency: a stale save is refused with **409** and
  the client keeps its draft rather than overwriting someone else's work.
- Every stored plan is validated by the same engine the browser uses, so a
  malformed plan can never be served to another viewer.
- Reads are public by design: **anyone with a plan's id can read it.** Do not put
  anything in a plan you would not put on a public page.

## Layout

```
server.js              static files + API, no dependencies
src/store.js           JSON-file plan store, atomic writes, hashed edit keys
src/api.js             the five endpoints
public/engine.js       planning core (also used by the server to validate)
public/geography.js    Photon search, OSRM matrix, coordinate parsing
public/railway.js      Overpass station lookups, with a mirror fallback
public/app.js          UI shell: state, rendering, events
public/views.js        tabs and panels          public/dialogs.js   modal bodies
public/roster.js       CSV/text exports and CSV import
public/share.js        local drafts, publishing, view/edit modes
public/data/           airports, city reference points, the demo plan
scripts/               single-file build
test/                  engine and API tests
```

## Attribution

Place search: [Photon](https://photon.komoot.io) · roads:
[OSRM](https://project-osrm.org) · railway stations:
[Overpass](https://overpass-api.de) · map data ©
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

MIT licensed, like the rest of this repository.
