// Geography helpers and the three public map services this planner talks to.
//
//   Photon    – place search, to turn a college name into a campus pin
//   OSRM      – a road duration/distance matrix between the plan's points
//   Overpass  – nearest passenger railway stations (see railway.js)
//
// All three are free, community-run endpoints, so every call here is rate
// limited, cached and cancellable, and only place text plus coordinates ever
// leave the browser — team names, member names and dates never do.

export const GEO_SERVICES = {
  search: 'https://photon.komoot.io/api/',
  routing: 'https://router.project-osrm.org'
};

export const isCoordinate = (p) =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

// Six decimals (~10 cm) is the key used for matrix lookups and overrides, so a
// pin that moves at all gets a fresh estimate rather than a stale one.
export const pointKey = (p) => Number(p.lng).toFixed(6) + ',' + Number(p.lat).toFixed(6);
export const matrixSignature = (points) => [...new Set(points.map(pointKey))].sort().join(';');

export const isDemo = (c) => c.demo === true || (c.demo !== false && /\(demo\)\s*$/i.test(c.name || ''));
// A pin only counts once a person has confirmed it: a search hit alone is a
// suggestion, and planning refuses to price travel to a guess.
export const hasCampus = (c) => isCoordinate(c.location) && c.location.confirmed === true;

export const mapLink = (p) =>
  `https://www.openstreetmap.org/?mlat=${Number(p.lat)}&mlon=${Number(p.lng)}#map=17/${Number(p.lat)}/${Number(p.lng)}`;

export const directionsLink = (a, b) =>
  `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${a.lat},${a.lng};${b.lat},${b.lng}`;

// Accept a pasted point, but never a map viewport: `@lat,lng` in a map URL is
// where the camera was, not where the campus is.
export function extractCoordinates(value) {
  const v = String(value || '').trim();
  let m;
  if (
    (m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)) ||
    (m = v.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)) ||
    (m = v.match(/[?&](?:q|query|mlat)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i))
  ) {
    const p = { lat: Number(m[1]), lng: Number(m[2]) };
    return isCoordinate(p) ? p : null;
  }
  try {
    const url = new URL(v);
    const p = { lat: Number(url.searchParams.get('mlat')), lng: Number(url.searchParams.get('mlon')) };
    if (url.searchParams.has('mlat') && url.searchParams.has('mlon') && isCoordinate(p)) return p;
  } catch {
    /* not a URL */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cached road matrix
// ---------------------------------------------------------------------------

export function validateMatrix(m) {
  if (!m) return true;
  const keys = m.pointKeys;
  const n = keys?.length;
  if (
    !Array.isArray(keys) || !n || n > 100 || new Set(keys).size !== n ||
    !Number.isFinite(m.updatedAt) ||
    !Array.isArray(m.durations) || !Array.isArray(m.distances) ||
    m.durations.length !== n || m.distances.length !== n
  ) return false;
  if (!keys.every((k) => typeof k === 'string' && /^-?\d+\.\d{6},-?\d+\.\d{6}$/.test(k))) return false;
  const rowsOk = [m.durations, m.distances].every((rows) =>
    rows.every((row) => Array.isArray(row) && row.length === n && row.every((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e8)))
  );
  return (
    rowsOk &&
    Array.isArray(m.snapped) && m.snapped.length === n &&
    m.snapped.every((p) => isCoordinate(p) && Number.isFinite(p.distance) && p.distance >= 0)
  );
}

// Look one leg up in the cached matrix. `null` means "not measured — estimate
// it"; `unreachable` means the router said there is no road connection.
export function networkRoad(a, b, state) {
  const m = state.network;
  if (!m) return null;
  const i = m.pointKeys.indexOf(pointKey(a));
  const j = m.pointKeys.indexOf(pointKey(b));
  if (i < 0 || j < 0) return null;
  const seconds = m.durations[i]?.[j];
  const metres = m.distances[i]?.[j];
  if (seconds === null || metres === null) return { unreachable: true, source: 'road-network' };
  if (!Number.isFinite(seconds) || !Number.isFinite(metres)) return null;
  const snap = Math.max(m.snapped[i]?.distance || 0, m.snapped[j]?.distance || 0);
  return {
    hours: seconds / 3600,
    distance: metres / 1000,
    source: 'road-network',
    updatedAt: m.updatedAt,
    snap,
    stale: Date.now() - m.updatedAt > 7 * 86400000
  };
}

export function parseRoadMatrix(data, points, at = Date.now()) {
  if (data.code !== 'Ok') throw new Error('Road routing returned ' + (data.code || 'an invalid response') + '. Check the campus pins.');
  const m = {
    pointKeys: points.map(pointKey),
    durations: data.durations,
    distances: data.distances,
    snapped: (data.sources || []).map((p) => ({ lng: p.location?.[0], lat: p.location?.[1], distance: p.distance ?? 0 })),
    updatedAt: at,
    signature: matrixSignature(points),
    source: 'OSRM / OpenStreetMap'
  };
  if (!validateMatrix(m)) throw new Error('Road routing returned incomplete durations or distances.');
  return m;
}

// ---------------------------------------------------------------------------
// Network calls
// ---------------------------------------------------------------------------

const searchCache = new Map();
let lastSearch = 0;
let lastRoute = 0;

async function fetchJSON(url, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetcher(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
    if (!r.ok) {
      throw new Error(r.status === 429 ? 'The map service is busy. Wait a moment and try again.' : 'The map service is unavailable (' + r.status + ').');
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export function photonResults(data) {
  if (!Array.isArray(data.features)) throw new Error('The location service returned an invalid response.');
  return data.features
    .map((f) => {
      const p = f.properties || {};
      const xy = f.geometry?.coordinates;
      return {
        name: p.name || '',
        address: [p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.district, p.city, p.state, p.postcode, p.country]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', '),
        lat: Number(xy?.[1]),
        lng: Number(xy?.[0]),
        osmId: p.osm_id,
        osmType: p.osm_type,
        source: 'Photon / OpenStreetMap',
        country: p.countrycode
      };
    })
    .filter((p) => isCoordinate(p));
}

export async function searchCampus(query, bias, { fetcher = fetch, endpoint = GEO_SERVICES.search, storage = safeStorage() } = {}) {
  const q = String(query || '').trim();
  if (q.length < 4) throw new Error('Enter the college name and locality, or a full campus address.');
  const url = new URL(endpoint);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'en');
  if (isCoordinate(bias)) {
    url.searchParams.set('lat', bias.lat);
    url.searchParams.set('lon', bias.lng);
  }
  const key = url.href;
  if (searchCache.has(key)) return searchCache.get(key);
  try {
    const cached = JSON.parse(storage?.getItem('campusroute.search.' + key) || 'null');
    if (cached && Date.now() - cached.at < 30 * 86400000) {
      searchCache.set(key, cached.results);
      return cached.results;
    }
  } catch {
    /* ignore unreadable cache */
  }
  // One request a second, at most, to stay a good citizen of a free service.
  const delay = Math.max(0, lastSearch + 1100 - Date.now());
  lastSearch = Date.now() + delay;
  await new Promise((r) => setTimeout(r, delay));

  const results = photonResults(await fetchJSON(url.href, fetcher));
  searchCache.set(key, results);
  try {
    storage?.setItem('campusroute.search.' + key, JSON.stringify({ at: Date.now(), results }));
  } catch {
    /* cache is a convenience, never a requirement */
  }
  return results;
}

export async function fetchRoadMatrix(points, { fetcher = fetch, endpoint = GEO_SERVICES.routing } = {}) {
  const unique = [...new Map(points.map((p) => [pointKey(p), p])).values()];
  if (unique.length < 2 || unique.length > 100) throw new Error('Road routing needs 2–100 unique locations.');
  const delay = Math.max(0, lastRoute + 1100 - Date.now());
  lastRoute = Date.now() + delay;
  await new Promise((r) => setTimeout(r, delay));
  const url = endpoint.replace(/\/$/, '') + '/table/v1/driving/' + unique.map(pointKey).join(';') + '?annotations=duration,distance';
  return parseRoadMatrix(await fetchJSON(url, fetcher), unique);
}

// localStorage throws outright in some embedded contexts, so never touch it raw.
export function safeStorage() {
  try {
    const s = globalThis.localStorage;
    s?.getItem('campusroute.probe');
    return s || null;
  } catch {
    return null;
  }
}
