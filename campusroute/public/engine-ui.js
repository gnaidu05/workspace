// A thin facade the views import from, so a view never has to know whether a
// helper lives in the engine, in geography or here.

export {
  AIRPORTS, CITIES, DEFAULT_SETTINGS, SETTING_LIMITS, MAX_DATED_VISITS,
  buildRoute, collegeMemberAvailability, compareBases, dateText, dayOf, endpoint, exactLegKey, formatHours,
  haversine, hourOf, isoDay, legKey, legOptions, locationName, locationsOf, memberTravelAvailability,
  nearestAirport, planRoutes, routeScore, routingPoints, scheduledVisits, teamBase, timeText, travelVisits, validateState
} from './engine.js';

export { hasCampus as hasCampusPin, isCoordinate, isDemo, pointKey, mapLink, directionsLink, extractCoordinates } from './geography.js';

import { AIRPORTS } from './data/airports.js';

const normalise = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Airport names arrive from imported spreadsheets in every possible spelling.
// Match a code or a full published name exactly — and never fuzzily, because
// two airports with similar names must not silently share a pin.
const AIRPORT_INDEX = new Map(
  Object.entries(AIRPORTS).flatMap(([code, a]) => [
    [normalise(code), code],
    [normalise(a.name), code],
    [normalise(a.city + ' airport'), code]
  ])
);

export function matchAirport(text) {
  return AIRPORT_INDEX.get(normalise(text)) || null;
}

// Check the free-text airport reference an import may have carried along.
export function validateCollegeAirport(college) {
  const supplied = college.airportReference;
  if (!supplied) return null;
  const code = matchAirport(supplied);
  return code
    ? { matched: true, code, name: AIRPORTS[code].name }
    : { matched: false, code: null, name: supplied };
}
