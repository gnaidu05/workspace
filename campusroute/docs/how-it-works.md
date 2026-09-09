# How the original works, end to end — and how this public version differs

A teardown of **campus-route-gopinathan.gnaidu05.chatgpt.site** (fetched 9 Sep 2026,
plan revision 5), followed by the design of the public rebuild in this folder.

Everything below about the original comes from its own served source and API
responses: `index.html`, ten ES modules, and `GET /api/plan`.

---

## 1. What it is

CampusRoute is a planner for **multi-stop college assessment travel**. Teams of
assessors are based in one city; colleges have fixed assessment (and sometimes
interview) dates; the app groups those visits into shared tours, works out road
/ air / rail travel around them, counts overnight stays, assigns teams and named
people, and reports how much travel the grouping saves against one trip per
visit.

The live plan at the time of the teardown held **179 colleges, 5 teams, a cached
road matrix of 30 points and 15 railway-station lookups**.

## 2. Hosting and identity

| Layer | What is actually there |
| --- | --- |
| Host | `*.chatgpt.site` — an OpenAI-hosted app site, fronted by Cloudflare (`cf-ray`, `__cf_bm`, a JS challenge script injected into the page) |
| Auth | `GET /signin-with-chatgpt?return_to=/` → 302 to `auth.openai.com/oauth/authorize` (`client_id=oaiapp_…`, PKCE `S256`, `redirect_uri=/callback`), state cookie `chatgpt_sites_siwc_login_*` scoped to the workspace subdomain |
| Roles | Exactly two: **the owner** (the signed-in ChatGPT account that created the site) and **everybody else**, who can read |
| Storage | One JSON document per site, behind `/api/plan` |

The whole product surface is that one document plus static files. There is no
database schema, no user table, no per-visitor state on the server.

## 3. The API

```
GET  /api/plan   → { state, revision, exists, updatedAt, canEdit }
PUT  /api/plan     { state, revision }   header: X-Campus-Plan: save
                 → { revision }  |  409 if the revision is stale
                 → 403 "Only the plan owner can change the shared plan."
```

Confirmed by request: an anonymous `PUT` is refused **403**, an anonymous `GET`
returns the entire plan. Optimistic concurrency is a single integer `revision`;
the client refuses to save again after a 409 until the user reloads, keeping the
local draft in the meantime.

**Worth knowing:** anyone with the URL can read the whole plan — college list,
team names, member names, campus coordinates. The link is the only gate.

## 4. The front end

No framework, no build step, no bundler. `index.html` loads `app.js` as a module;
`app.js` imports nine more modules directly. Roughly 340 KB of source, of which
about 250 KB is baked-in data.

```
app.js            UI shell, event delegation, dialogs, exports, network jobs
engine.js         planning core (see §5)
geography.js      Photon search, OSRM matrix, coordinate parsing, cached matrix
railway.js        Overpass nearest-station lookups
airports.js       115 airports: code, name, coordinates, municipality
college-roster.js 191 college rows + a revision-stamped migration
supplied-colleges.js 178 rows with a `transportReference` (airport, km, station)
campus-locations.js  confirmed OSM campus pins, plus "needs review" notes
airport-validation.js exact-name crosswalk from the supplied table to IATA codes
campus-groups.js  groups colleges that share one full address
travel-roster.js  CSV rosters (per activity, and per person per day)
```

The rendering model is deliberately blunt: **one mutable `state`, one derived
`plan = planRoutes(state)`, and `$('#app').innerHTML = …` for the whole page**
after every change. Interaction is event delegation on `data-action`,
`data-tab`, `data-route`, `data-detail` attributes; modals are a single
`<dialog>` whose contents are rewritten per dialog.

Read-only mode is enforced three ways in the browser (capture-phase listeners
that swallow clicks/changes/submits, `disabled` on inputs, `hidden` on any
action outside a small read-only allow-list) — and, importantly, again on the
server with the 403.

Three baked-in datasets are merged into a saved plan by **revision stamps**:
`rosterRevision`, `campusRevision`, `suppliedRevision`. If the stamp in the
saved state does not match the constant in the code, the module rewrites those
rows and clears the cached road matrix. It is a migration system with no
migration framework, and it preserves anything the user has since edited.

## 5. The planning engine

Time is stored as **hours since the Unix epoch on a UTC-shaped calendar**, so
09:00 IST is `Date.parse('…T09:00:00Z')/3600000`. Day boundaries and overnight
rest become integer arithmetic, and nothing depends on the viewer's time zone.

**Visits, not colleges.** A college row can produce two visits (assessment and
interview). If named people from different teams are assigned to one visit, it
splits again into one travelling *party* per team, plus one for the unfilled
headcount.

**Endpoints.** A stop resolves to a confirmed campus pin if it has one
(`location.confirmed === true`), otherwise to a city reference point. Each
endpoint carries the airport it would fly from — chosen, forced, or disabled.

**Leg estimates** (`legOptions`, per direction):

- *Road* — a measured OSRM duration/distance when both ends are in the cached
  matrix; otherwise straight-line distance × a road factor ÷ an average speed.
  A 15-minute break is added per 200 km either way.
- *Air* — great-circle distance ÷ 650 km/h + 30 min, plus a user-set airport
  buffer, plus ground transfers at both ends (measured when pinned, a
  city-level access time otherwise).
- *Train* — never invented: the user types station names, train hours and km,
  transfer times and a boarding buffer.
- *Choice* — air wins automatically if it saves more than 45 minutes; rail wins
  if it is both shorter on the ground and quicker than that choice. Any leg can
  be overridden (mode, hours, distance, "no air here"), and the override is
  keyed to the exact endpoint coordinates *and* airport, so moving a pin retires
  the stale figure instead of misapplying it.

**Fitting travel into days.** The outbound leg is walked *backwards* from the
moment the team must be on campus, so departure is as late as the day allows;
every other leg is walked forwards. Road journeys may split across days; a
flight or train stays whole. A ledger tracks travel and duty hours per day. The
return journey is the one flexible piece: if the day is too long or rest would
be short, it is lifted out and retried the next morning.

**Grouping.** Every visit starts as its own base-and-back trip. Then the planner
repeatedly merges the pair of routes whose combination is feasible and saves the
most weighted cost, where the weights come from the chosen priority
(balanced / fewer teams / least travel time) and include a fixed per-tour cost —
that per-tour cost is what makes merging worthwhile at all. It is a deterministic
local search, not a proven optimum, and the code says so.

**Teams and people.** Routes with named people or a fixed team are reserved
first; the rest go to the smallest team that can take them, from its own base.
Named people are never double-booked across overlapping routes, and declared
unavailability windows are respected.

**Metrics.** "Travel saved" compares the grouped plan against a separate
base–college–base trip for every covered visit, priced with the same estimates
and the same team size.

## 6. External services (all called from the browser)

| Service | Used for | Discipline in the code |
| --- | --- | --- |
| Photon (Komoot) | campus search | ≥1.1 s between calls, in-memory + 30-day localStorage cache, 25 s abort |
| OSRM | road duration/distance matrix | one table call for all points, re-fetched only when the point set changes |
| Overpass | nearest passenger railway stations | serialised queue, deduplicated per pin, 30-day cache, 10-minute failure back-off |

Only place text and coordinates leave the browser. Team names, member names and
dates never do.

## 7. Things the teardown turned up

- `buildRouteFromBase` overrides the settings with `{dayStart: 0, dayEnd: 24,
  rest: 0}`, so in the deployed app the **daily window and overnight rest are
  not actually enforced**, even though the settings screen exposes them (the
  live state carries `dayStart: 6, dayEnd: 22, rest: 9, maxTravel: 12,
  maxDuty: 16, maxNights: 8`).
- The per-day ledger's `used` value is computed and then never read, so
  `maxTravel` / `maxDuty` are inert too.
- `formatHours(2)` returns `'2h '` with a trailing space.
- Base cities are hard-coded to Bangalore / Mumbai / Pune.

---

## 8. The public version in this folder

Same idea, same engine shape, three deliberate differences: **no accounts**,
**limits that actually bite**, and **a server anyone can run**.

### Sharing without accounts

| | Original | This build |
| --- | --- | --- |
| Who can edit | one ChatGPT account | anyone holding the plan's edit link |
| Who can read | anyone with the URL | anyone with the view link |
| Plans per deployment | one | unlimited (`POST /api/plans`) |
| Credential | OAuth session | a 24-byte edit key, stored only as a SHA-256 hash |
| Where the key lives | — | the URL **fragment** (`#p=<id>&k=<key>`), so it is never in a request line, a log or a `Referer`; it is sent explicitly as `X-Edit-Key` |

A visitor starts with a local draft in their own browser, presses **Publish**,
and gets two links: a view link to circulate and an edit link to keep. Opening
someone else's view link gives a read-only workspace with a **"Make my own
editable copy"** button. The browser also remembers keys for plans it published,
so a plain view link still opens as editable for its author.

### Limits that bite

`dayStart`, `dayEnd`, `maxTravel`, `maxDuty`, `rest` and `maxNights` are real
constraints here: travel is placed inside the working day, daily travel and duty
are capped, overnight rest is checked between days, and a grouping that needs
more nights than allowed is rejected rather than quietly produced. Set
`dayStart 0 / dayEnd 24 / rest 0` to get the original's behaviour back.

### Where it runs

The public deployment is a single Cloudflare Worker with a D1 database
(**https://campusroute-planner.higgsfield.app**, planner at `/planner`): the
same engine, the same five endpoints, the same revision and edit-key rules, with
plans in a table instead of JSON files. `deploy/cloudflare/` holds those sources.
A static copy of the single-file build also lives in this repo's `docs/` for
GitHub Pages, where plans stay in the visitor's own browser.

### Other differences

- Any of the 44 reference cities can be a base, and `compareBases` will re-plan
  from a list of candidates.
- No third party's college roster is baked in. The app ships a demo plan priced
  from city centres, an optional starter list of well-known institutions
  (name and city only — no asserted coordinates), CSV/JSON import, and campus
  search for real pins.
- An airport code that is not in the reference list degrades to "no air option"
  instead of throwing.
- Exports: JSON plan, person-day CSV, activity CSV, a plain-text brief, print.
- The same `validateState` runs in the browser **and** on the server, so a
  malformed plan cannot be stored for someone else to open.
- `npm run build:single` produces `docs/campusroute.html`: the entire planner in
  one file, no server, plans in the visitor's own browser storage.

### Request flow, end to end

```
browser                                   server                     public services
───────                                   ──────                     ───────────────
load /                                 →  static files
GET /api/health                        →  { ok: true }
(local draft from localStorage)
edit a plan
  planRoutes(state) in the browser
  campus search                        ────────────────────────────→ Photon
  road matrix for the plan's points    ────────────────────────────→ OSRM
  nearest stations for a pin           ────────────────────────────→ Overpass
Publish → POST /api/plans {state}      →  validate, store, return { id, editKey }
edit → PUT /api/plans/:id {state,rev}  →  authorise (X-Edit-Key), validate,
                                          bump revision, atomic write
viewer → GET /api/plans/:id            →  { state, revision, canEdit: false }
         (re-polled every 30 s)
```

### What neither version claims

No fares, no live traffic, no flight or train availability, no bookings.
Overnight stays are assumed where a route cannot get home, not reserved.
Airport coordinates are reference points, not terminal entrances. Every number
is a planning estimate to confirm before anyone travels.
