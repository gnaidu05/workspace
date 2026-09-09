// Nearest passenger railway stations, from OpenStreetMap via Overpass.
//
// Overpass is a shared community service: requests are queued one at a time,
// deduplicated per pin, cached in the plan for 30 days and never retried in a
// tight loop. Results are mapped stations, not a timetable — the train times on
// a leg are always entered by a person.

import { isCoordinate, pointKey, fetchRoadMatrix, networkRoad } from './geography.js';

export const STATION_SERVICE = 'https://overpass-api.de/api/interpreter';
// Overpass is community-run and sometimes at capacity; a mirror is tried next.
export const STATION_MIRRORS = ['https://overpass.kumi.systems/api/interpreter'];
export const STATION_RADIUS_KM = 50;

export function stationDistance(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}

// Keep mainline passenger stations only: metro, tram, monorail, freight-only,
// disused and preserved-railway stops are not somewhere a team can buy a ticket.
export function stationCandidates(data, origin) {
  if (!Array.isArray(data.elements) || data.remark) throw new Error('Station search returned incomplete data. Please retry.');
  const rows = data.elements.flatMap((e) => {
    const t = e.tags || {};
    const p = { lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon };
    const name = t['name:en'] || t.name;
    const excluded =
      !name || !isCoordinate(p) ||
      !['station', 'halt'].includes(t.railway) ||
      ['subway', 'light_rail', 'monorail', 'tram'].includes(t.station) ||
      ['yes', 'only'].includes(t.subway) ||
      t.tram === 'yes' || t.train === 'no' || t.passenger === 'no' ||
      t.disused === 'yes' || t.abandoned === 'yes' || t['railway:preserved'] === 'yes';
    if (excluded) return [];
    const distance = stationDistance(origin, p);
    return distance <= STATION_RADIUS_KM
      ? [{ ...p, name, code: t['railway:ref'] || t.ref || '', id: e.type + '/' + e.id, distance, source: 'OpenStreetMap' }]
      : [];
  }).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

  // Collapse the same station mapped twice (platform node plus area).
  return rows.filter((s, i) => !rows.slice(0, i).some((p) => p.name.toLowerCase() === s.name.toLowerCase() && stationDistance(p, s) < 0.5)).slice(0, 6);
}

export function validStationLookup(value, p) {
  return (
    !!value && value.point === pointKey(p) && Number.isFinite(value.at) && Date.now() - value.at < 30 * 86400000 &&
    Array.isArray(value.stations) && value.stations.length > 0 && value.stations.length <= 6 &&
    value.stations.every((s) => isCoordinate(s) && typeof s.name === 'string' && Number.isFinite(s.distance))
  );
}

const pending = new Map();
let queue = Promise.resolve();

export async function nearestStations(origin, { fetcher = fetch, endpoint = STATION_SERVICE, mirrors = STATION_MIRRORS } = {}) {
  if (!isCoordinate(origin)) throw new Error('Set the campus pin first.');
  const key = pointKey(origin);
  if (pending.has(key)) return pending.get(key);

  const task = queue.catch(() => {}).then(async () => {
    const query = `[out:json][timeout:20];nwr["railway"~"^(station|halt)$"](around:${STATION_RADIUS_KM * 1000},${origin.lat},${origin.lng});out center tags;`;
    let lastError = null;
    for (const service of [endpoint, ...mirrors]) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetcher(service + '?data=' + encodeURIComponent(query), { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('Railway station lookup is unavailable. Retry shortly.');
        const stations = stationCandidates(await response.json(), origin);
        if (!stations.length) throw new Error(`No mapped passenger railway station within ${STATION_RADIUS_KM} km. Enter a station manually.`);
        return { point: key, at: Date.now(), stations };
      } catch (error) {
        lastError = error;
        // "Nothing mapped nearby" is an answer, not an outage: don't retry it.
        if (/No mapped passenger/.test(error.message)) break;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('Railway station lookup is unavailable. Retry shortly.');
  });

  pending.set(key, task);
  queue = task;
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

// Road time from a campus to its station and back again, so a rail itinerary
// prices its own first and last mile.
export async function stationTransfers(origin, station, options = {}) {
  const matrix = await fetchRoadMatrix([origin, station], options);
  const state = { network: matrix };
  return { outbound: networkRoad(origin, station, state), inbound: networkRoad(station, origin, state) };
}
