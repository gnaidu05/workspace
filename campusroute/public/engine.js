// CampusRoute planning engine.
//
// Every internal time is a number of hours since the Unix epoch, interpreted as
// Indian local wall time on a UTC-shaped calendar: a visit at 09:00 IST is
// stored as `Date.parse('2026-09-24T09:00:00Z') / 3600000`. That keeps day
// boundaries, overnight rest and daily windows arithmetic-simple, and it means
// no calculation here depends on the viewer's own time zone.
//
// Nothing in this file talks to a network. Travel times are model estimates
// built from coordinates, a cached road matrix and the assumptions the user
// sets — no live traffic, fares, flight availability or train timetables are
// implied anywhere.

import { AIRPORTS } from './data/airports.js';
import { CITIES } from './data/cities.js';
import { isCoordinate, hasCampus, isDemo, pointKey, networkRoad, validateMatrix } from './geography.js';

export { AIRPORTS, CITIES };

export const DEFAULT_SETTINGS = {
  priority: 'balanced', // 'balanced' | 'teams' | 'time'
  roadSpeed: 55,        // km/h average, used when there is no road matrix
  roadFactor: 1.3,      // straight-line km -> road km
  airportBuffer: 2,     // hours lost to check-in, security and baggage, both ends
  buffer: 0.5,          // hours of transfer slack before and after each visit
  dayStart: 6,          // earliest hour travel may start
  dayEnd: 22,           // latest hour travel may end
  maxTravel: 12,        // most hours of travelling in one day
  maxDuty: 16,          // most hours of travel + visits in one day
  rest: 9,              // hours of rest between the end of one day and the next
  maxNights: 8          // most consecutive nights away per route
};

export const SETTING_LIMITS = {
  roadSpeed: [20, 100],
  roadFactor: [1, 2],
  airportBuffer: [0, 6],
  buffer: [0, 3],
  dayStart: [0, 12],
  dayEnd: [12, 24],
  maxTravel: [1, 24],
  maxDuty: [1, 24],
  rest: [0, 14],
  maxNights: [0, 30]
};

export const MAX_COLLEGES = 1000;
export const MAX_DATED_VISITS = 60;
export const MAX_TEAMS = 20;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export const hourOf = (visit) => Date.parse(visit.date + 'T' + visit.time + ':00Z') / 3600000;
export const dayOf = (hours) => Math.floor(hours / 24);
export const isoDay = (hours) => new Date(dayOf(hours) * 86400000).toISOString().slice(0, 10);
export const legKey = (a, b) => a + ' → ' + b;
export const locationsOf = (state) => ({ ...CITIES, ...state.locations });
export const teamBase = (team, state) => team.base || state.base;
export const locationName = (college) =>
  (college.city || '').trim() || (college.name || '').trim() || (college.location?.address || '').trim() || 'Campus';

export function haversine(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}

export function formatHours(n) {
  if (!Number.isFinite(n)) return 'Unavailable';
  const minutes = Math.round(n * 60);
  const parts = [Math.floor(minutes / 60) ? Math.floor(minutes / 60) + 'h' : '', minutes % 60 ? (minutes % 60) + 'm' : ''];
  return parts.filter(Boolean).join(' ') || '0m';
}

export function dateText(hours, options = { day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(hours * 3600000));
}

export const timeText = (hours) => dateText(hours, { hour: '2-digit', minute: '2-digit', hour12: false });

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

// A college row can carry two dated visits: the assessment and an optional
// interview round. Planning works on visits, never on college rows.
export function scheduledVisits(state) {
  return state.colleges.flatMap((c) => [
    ...(c.date ? [{ ...c, sourceCollegeId: c.id, visitType: 'assessment' }] : []),
    ...(c.interviewDate
      ? [{
          ...c,
          id: JSON.stringify(['interview', c.id]),
          sourceCollegeId: c.id,
          visitType: 'interview',
          date: c.interviewDate,
          time: c.interviewTime || '09:00',
          duration: c.interviewDuration ?? c.duration ?? 6
        }]
      : [])
  ]);
}

// When named people from different teams are assigned to one visit, that visit
// becomes several travelling parties: each team travels its own route, plus one
// automatic party for any unfilled headcount.
export function travelVisits(state) {
  return scheduledVisits(state).flatMap((visit) => {
    const groups = new Map();
    for (const name of visit.assignedMembers || []) {
      const owner = state.teams.find((t) => t.members?.includes(name));
      if (!owner) continue;
      if (!groups.has(owner.id)) groups.set(owner.id, []);
      groups.get(owner.id).push(name);
    }
    if (groups.size <= 1) return [{ ...visit, ...(groups.size ? { team: [...groups.keys()][0] } : {}) }];

    const parts = [...groups].map(([team, names]) => ({
      ...visit,
      id: JSON.stringify(['party', visit.id, team]),
      planningVisitId: visit.id,
      sourceCollegeId: visit.sourceCollegeId || visit.id,
      team,
      requiredPeople: names.length,
      assignedMembers: names
    }));
    const remainder = (visit.requiredPeople ?? visit.assignedMembers.length) - visit.assignedMembers.length;
    if (remainder > 0) {
      parts.push({
        ...visit,
        id: JSON.stringify(['party', visit.id, 'auto']),
        planningVisitId: visit.id,
        sourceCollegeId: visit.sourceCollegeId || visit.id,
        team: 'auto',
        requiredPeople: remainder,
        assignedMembers: []
      });
    }
    return parts;
  });
}

// ---------------------------------------------------------------------------
// Places: cities, confirmed campus pins and airports
// ---------------------------------------------------------------------------

export function airportPoint(code, state) {
  if (!code) return null;
  const p = state.airportPins?.[code] || AIRPORTS[code];
  return p ? { ...p, id: 'airport:' + code, label: code + ' airport', kind: 'airport', code } : null;
}

export function nearestAirport(point, state) {
  let best = null;
  let bestDistance = Infinity;
  for (const code of Object.keys(AIRPORTS)) {
    const p = airportPoint(code, state);
    if (!p) continue;
    const distance = haversine(point, p);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = code;
    }
  }
  return best;
}

// Resolve either a city name or a college row into a routing point.
export function endpoint(value, state) {
  const cities = locationsOf(state);
  if (typeof value === 'object' && hasCampus(value)) {
    const requested =
      value.airport === 'none' ? null
      : value.airport && value.airport !== 'auto' ? value.airport
      : nearestAirport(value.location, state);
    // An airport code that is not in the reference list is treated as "no air
    // option" rather than as a crash waiting to happen.
    const airport = airportPoint(requested, state) ? requested : null;
    return {
      ...value.location,
      id: 'campus:' + (value.sourceCollegeId || value.id),
      label: value.name,
      city: locationName(value),
      kind: 'campus',
      airport,
      airportStamp: airport ? airport + '@' + pointKey(airportPoint(airport, state)) : 'none'
    };
  }
  const name = typeof value === 'string' ? value : value.city;
  const p = cities[name];
  if (!p) throw new Error('Unknown location: ' + (name || '(none)'));
  const airport = airportPoint(p.airport, state) ? p.airport : null;
  return {
    ...p,
    id: 'city:' + name,
    label: name,
    city: name,
    kind: 'city',
    airport,
    airportStamp: airport ? airport + '@' + pointKey(airportPoint(airport, state)) : 'none'
  };
}

// Every point a road matrix needs to cover: team bases, pinned dated campuses
// and the airports those points would fly from.
export function routingPoints(state) {
  const bases = [...new Set([state.base, ...state.teams.map((t) => teamBase(t, state))])];
  const points = [
    ...bases.map((b) => endpoint(b, state)),
    ...state.colleges.filter((c) => (c.date || c.interviewDate) && (hasCampus(c) || isDemo(c))).map((c) => endpoint(c, state))
  ];
  for (const code of new Set(points.map((p) => p.airport).filter(Boolean))) {
    const p = airportPoint(code, state);
    if (p) points.push(p);
  }
  return [...new Map(points.map((p) => [pointKey(p), p])).values()];
}

// Overrides are keyed by the exact points they were measured between, so moving
// a pin or switching airport quietly retires the stale manual estimate instead
// of applying it to a different journey.
const overrideStamp = (p) => p.id + '@' + pointKey(p) + '#' + (p.airportStamp || 'none');
export const exactLegKey = (a, b) =>
  a.kind === 'city' && b.kind === 'city' ? legKey(a.label, b.label) : legKey(overrideStamp(a), overrideStamp(b));

// ---------------------------------------------------------------------------
// Travel estimates
// ---------------------------------------------------------------------------

// A 15-minute break every 200 km keeps long road legs honest.
const roadBreaks = (km) => 0.25 * Math.floor(km / 200);

export function groundTravel(a, b, state) {
  const settings = state.settings;
  const measured = networkRoad(a, b, state);
  if (measured?.unreachable) return { hours: null, distance: null, source: 'unreachable' };
  if (measured) return { ...measured, hours: Math.max(1 / 60, measured.hours) + roadBreaks(measured.distance) };
  const distance = haversine(a, b) * settings.roadFactor;
  return {
    hours: Math.max(1 / 60, distance / settings.roadSpeed + roadBreaks(distance)),
    distance,
    source: 'coordinate-estimate'
  };
}

// Road, air and rail estimates for one direction of one leg, plus whichever
// mode the plan should use. `state.overrides[key]` wins over every model value.
export function legOptions(from, to, state) {
  const a = endpoint(from, state);
  const b = endpoint(to, state);
  const settings = state.settings;
  const precise = a.kind === 'campus' || b.kind === 'campus';
  const same = a.id === b.id;
  const straight = haversine(a, b);
  const distance = same ? 12 : straight * settings.roadFactor;

  const flightPossible = !same && !!a.airport && !!b.airport && a.airport !== b.airport;
  const airportA = airportPoint(a.airport, state) || a;
  const airportB = airportPoint(b.airport, state) || b;
  const flightHours = flightPossible ? haversine(airportA, airportB) / 650 + 0.5 : null;

  const key = exactLegKey(a, b);
  const override = state.overrides[key] || {};

  const ground = precise
    ? groundTravel(a, b, state)
    : { hours: same ? 0.5 : Math.max(0.75, distance / settings.roadSpeed + roadBreaks(distance)), distance, source: 'city-estimate' };

  // Getting to and from the airports: measured when both ends are pinned,
  // otherwise the city-level access time.
  const departure = flightPossible
    ? precise ? groundTravel(a, airportA, state) : { hours: a.access ?? 1, distance: null, source: 'city-estimate' }
    : null;
  const arrival = flightPossible
    ? precise ? groundTravel(airportB, b, state) : { hours: b.access ?? 1, distance: null, source: 'city-estimate' }
    : null;

  const road = override.road ?? ground.hours;
  const air =
    override.air === null ? null
    : override.air ?? (flightPossible && Number.isFinite(departure.hours) && Number.isFinite(arrival.hours)
        ? flightHours + settings.airportBuffer + departure.hours + arrival.hours
        : null);
  const airDistance =
    flightPossible && Number.isFinite(departure?.distance) && Number.isFinite(arrival?.distance)
      ? haversine(airportA, airportB) + departure.distance + arrival.distance
      : null;

  const rail = override.rail || null;
  const train = rail ? rail.hours + rail.departureHours + rail.arrivalHours + rail.buffer : null;
  const trainDistance = rail ? rail.km + rail.departureKm + rail.arrivalKm : null;
  const trainShorter =
    !!rail && [override.distance ?? ground.distance, air !== null ? airDistance : null]
      .some((d) => Number.isFinite(d) && trainDistance < d);

  const preferred = override.mode || 'auto';
  let mode = preferred === 'auto' ? (air !== null && (road === null || air + 0.75 < road) ? 'air' : 'road') : preferred;
  // Rail only wins automatically when it is both shorter on the ground and
  // quicker than the mode that would otherwise be chosen.
  if (preferred === 'auto' && trainShorter && (mode === 'air' ? train < air : road === null || train < road)) mode = 'train';

  return {
    from: a.label, to: b.label, fromCity: a.city, toCity: b.city, fromPoint: a, toPoint: b,
    key, reverseKey: exactLegKey(b, a),
    road, air, rail, train, trainDistance, trainShorter, airDistance,
    distance: override.distance ?? ground.distance,
    mode,
    hours: mode === 'train' ? train : mode === 'air' ? air : road,
    custom: Object.keys(override).length > 0,
    airports: flightPossible ? a.airport + '–' + b.airport : null,
    flightHours, precise,
    roadSource: override.road !== undefined ? 'manual' : ground.source,
    airSource: override.air !== undefined ? 'manual' : precise ? 'campus-transfers' : 'city-estimate',
    ground, departure, arrival, airportA, airportB, airportBuffer: settings.airportBuffer
  };
}

// ---------------------------------------------------------------------------
// Validation. Everything the UI and the API both refuse to store.
// ---------------------------------------------------------------------------

export function validateState(state) {
  const errors = [];
  if (!state || state.schema !== 1) return ['Unsupported plan file.'];
  if (!state.settings || !state.locations || !state.overrides || !Array.isArray(state.colleges) || !Array.isArray(state.teams)) {
    return ['The plan is missing required fields.'];
  }
  const cities = locationsOf(state);
  if (!Object.hasOwn(cities, state.base)) errors.push('The default base must be a known city.');

  const s = state.settings;
  for (const [key, [min, max]] of Object.entries(SETTING_LIMITS)) {
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) errors.push(`Invalid assumption: ${key} (${min}–${max}).`);
  }
  if (Number.isFinite(s.dayStart) && Number.isFinite(s.dayEnd) && s.dayEnd - s.dayStart < 1) {
    errors.push('The daily window must be at least one hour long.');
  }
  if (!['balanced', 'teams', 'time'].includes(s.priority)) errors.push('Unknown routing priority.');

  if (state.colleges.length > MAX_COLLEGES) errors.push(`Use up to ${MAX_COLLEGES} colleges in the list.`);
  if (scheduledVisits(state).length > MAX_DATED_VISITS) {
    errors.push(`Schedule up to ${MAX_DATED_VISITS} dated visits at a time; undated colleges stay in the list.`);
  }
  if (state.teams.length < 1 || state.teams.length > MAX_TEAMS) errors.push(`Add between 1 and ${MAX_TEAMS} teams.`);

  const teamIds = new Set();
  for (const t of state.teams) {
    if (!t.id || teamIds.has(t.id) || typeof t.name !== 'string' || !t.name.trim() || !Number.isInteger(t.size) || t.size < 1 || t.size > 10000) {
      errors.push('Every team needs a unique ID, a name and at least one person.');
    }
    if (t.base !== undefined && !Object.hasOwn(cities, t.base)) errors.push('Every team base must be a known city.');
    teamIds.add(t.id);
  }

  for (const [name, l] of Object.entries(state.locations)) {
    if (!name.trim() || !l || !isCoordinate(l) || Object.hasOwn(CITIES, name)) errors.push('Invalid custom city: ' + name + '.');
  }

  // Named people belong to exactly one team, so a person is never double-booked
  // by two teams travelling at the same time.
  const memberNames = new Set();
  for (const t of state.teams) {
    if (t.members === undefined) continue;
    if (!Array.isArray(t.members) || t.members.length > t.size) {
      errors.push('Named members cannot exceed the team size.');
      continue;
    }
    for (const name of t.members) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
        errors.push('Each member needs a name of 1–80 characters.');
        continue;
      }
      const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
      if (memberNames.has(key)) errors.push('Each member must belong to one team. Use distinct names or initials.');
      memberNames.add(key);
    }
    if (t.memberAvailability !== undefined) {
      if (!t.memberAvailability || typeof t.memberAvailability !== 'object' || Array.isArray(t.memberAvailability)) {
        errors.push('Invalid member availability.');
        continue;
      }
      for (const [name, rule] of Object.entries(t.memberAvailability)) {
        if (!t.members?.includes(name) || !rule || typeof rule.available !== 'boolean' || !Array.isArray(rule.unavailable)) {
          errors.push('Member availability must belong to a named team member.');
          continue;
        }
        for (const range of rule.unavailable) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to) || range.from > range.to) {
            errors.push('Enter valid unavailable from/to dates for ' + name + '.');
          }
        }
      }
    }
  }

  if (state.network && !validateMatrix(state.network)) errors.push('Invalid cached road matrix. Refresh road calculations.');
  if (state.airportPins) {
    for (const [code, p] of Object.entries(state.airportPins)) {
      if (!Object.hasOwn(AIRPORTS, code) || !isCoordinate(p)) errors.push('Invalid airport access pin: ' + code + '.');
    }
  }

  const ids = new Set();
  for (const c of state.colleges) {
    const title = typeof c.name === 'string' && c.name.trim() ? c.name : 'Unnamed college';
    if (!c.id || ids.has(c.id)) errors.push('College IDs must be unique.');
    ids.add(c.id);
    if (typeof c.name !== 'string' || !c.name.trim()) errors.push('A college name is required.');
    if (c.city && !Object.hasOwn(cities, c.city)) errors.push(title + ': choose a known city or clear the city.');
    if (!c.city && !c.location) errors.push(title + ': set a city or a campus pin.');
    if (c.location && (!isCoordinate(c.location) || typeof c.location.confirmed !== 'boolean')) {
      errors.push(title + ': enter valid campus coordinates and confirm the location.');
    }
    if (c.airport && !['auto', 'none'].includes(c.airport) && !Object.hasOwn(AIRPORTS, c.airport)) {
      errors.push(title + ': select a supported airport.');
    }
    if (c.date) {
      const h = hourOf(c);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(c.date) && Number.isFinite(h) && new Date(h * 3600000).toISOString().slice(0, 10) === c.date;
      if (!validDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time)) errors.push(title + ': enter a valid date and start time.');
    }
    if (!Number.isFinite(c.duration) || c.duration < 0.5 || c.duration > 12) errors.push(title + ': duration must be 0.5–12 hours.');
    if (c.interviewDate) {
      const visit = { date: c.interviewDate, time: c.interviewTime || '09:00' };
      const h = hourOf(visit);
      const duration = c.interviewDuration ?? c.duration ?? 6;
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(visit.date) && Number.isFinite(h) &&
        new Date(h * 3600000).toISOString().slice(0, 10) === visit.date && /^([01]\d|2[0-3]):[0-5]\d$/.test(visit.time);
      if (!valid) errors.push(title + ': enter a valid interview date and start time.');
      if (!Number.isFinite(duration) || duration < 0.5 || duration > 12) errors.push(title + ': interview duration must be 0.5–12 hours.');
    }
    if (c.team !== 'auto' && !teamIds.has(c.team)) errors.push(title + ': assigned team no longer exists.');
    if (c.requiredPeople !== undefined && (!Number.isInteger(c.requiredPeople) || c.requiredPeople < 1 || c.requiredPeople > 10000)) {
      errors.push('College staffing must be a positive whole number.');
    }
    if (c.assignedMembers !== undefined) {
      if (!Array.isArray(c.assignedMembers) || c.assignedMembers.some((n) => typeof n !== 'string')) {
        errors.push('Invalid college member assignments.');
        continue;
      }
      if (new Set(c.assignedMembers).size !== c.assignedMembers.length) errors.push('A person is assigned twice to a college.');
      if (c.requiredPeople !== undefined && c.assignedMembers.length > c.requiredPeople) {
        errors.push('Selected members exceed the college headcount.');
      }
      if (c.assignedMembers.some((n) => !state.teams.some((t) => t.members?.includes(n)))) {
        errors.push('A selected college member no longer exists. Edit the college assignment.');
      }
    }
  }

  for (const [key, o] of Object.entries(state.overrides)) {
    if (!o || !['auto', 'road', 'air', 'train'].includes(o.mode || 'auto')) {
      errors.push('Invalid leg preference: ' + key);
      continue;
    }
    if (o.mode === 'train' && !o.rail) errors.push('Enter a train itinerary before selecting train: ' + key);
    if (o.rail) {
      const r = o.rail;
      if (typeof r.fromStation !== 'string' || !r.fromStation.trim() || typeof r.toStation !== 'string' || !r.toStation.trim()) {
        errors.push('Enter both train stations: ' + key);
      }
      for (const f of ['hours', 'km', 'departureHours', 'arrivalHours', 'departureKm', 'arrivalKm', 'buffer']) {
        const min = f === 'hours' || f === 'km' ? 0.01 : 0;
        const max = f.toLowerCase().includes('km') ? 15000 : 100;
        if (!Number.isFinite(r[f]) || r[f] < min || r[f] > max) errors.push('Invalid train ' + f + ': ' + key);
      }
    }
    for (const f of ['road', 'air', 'distance']) {
      if (o[f] === undefined) continue;
      if (f === 'air' && o[f] === null) continue;
      if (!Number.isFinite(o[f]) || o[f] <= 0 || o[f] > (f === 'distance' ? 15000 : 100)) {
        errors.push('Invalid ' + f + ' estimate for ' + key + '.');
      }
    }
  }

  return [...new Set(errors)];
}

// ---------------------------------------------------------------------------
// Placing travel into the working day
// ---------------------------------------------------------------------------

function ledgerFor(ledger, day) {
  if (!ledger[day]) ledger[day] = { travel: 0, duty: 0 };
  return ledger[day];
}

function addLedger(ledger, start, end, type) {
  const entry = ledgerFor(ledger, dayOf(start));
  entry.duty += end - start;
  if (type === 'travel') entry.travel += end - start;
}

// How many more hours of travel a given day can absorb.
function travelRoom(ledger, day, s) {
  const used = ledgerFor(ledger, day);
  return Math.max(0, Math.min(s.maxTravel - used.travel, s.maxDuty - used.duty));
}

// Walk a leg forward from `start`, splitting it across days when it is a road
// journey. Air and train itineraries stay whole: half a flight is not a thing.
function forwardTravel(leg, start, ledger, s, deadline = Infinity) {
  const out = [];
  let remaining = leg.hours;
  let t = start;
  for (let guard = 0; remaining > 1e-7 && guard < 200; guard++) {
    const day = dayOf(t);
    t = Math.max(t, day * 24 + s.dayStart);
    if (dayOf(t) !== day) continue;
    const cap = Math.min(day * 24 + s.dayEnd - t, deadline - t, travelRoom(ledger, day, s));
    if (cap < 1e-7 || (leg.mode !== 'road' && cap + 1e-7 < remaining)) {
      if ((day + 1) * 24 + s.dayStart >= deadline) return null;
      t = (day + 1) * 24 + s.dayStart;
      continue;
    }
    const hours = Math.min(remaining, cap);
    const end = t + hours;
    const done = remaining - hours < 1e-7;
    out.push({
      type: 'travel',
      start: t,
      end,
      leg,
      from: out.length ? 'En route' : leg.from,
      to: done ? leg.to : 'En route',
      toCity: done ? leg.toCity : 'En route',
      part: out.length + 1
    });
    addLedger(ledger, t, end, 'travel');
    remaining -= hours;
    t = (day + 1) * 24 + s.dayStart;
  }
  return remaining > 1e-7 ? null : out;
}

// Walk the outbound leg backwards from the moment the team must already be at
// the first campus, so departure is as late as the working day allows.
function outboundTravel(leg, deadline, ledger, s) {
  const out = [];
  let remaining = leg.hours;
  let end = deadline;
  for (let guard = 0; remaining > 1e-7 && guard < 200; guard++) {
    const day = dayOf(end);
    end = Math.min(end, day * 24 + s.dayEnd);
    const cap = Math.min(end - (day * 24 + s.dayStart), travelRoom(ledger, day, s));
    if (cap < 1e-7 || (leg.mode !== 'road' && cap + 1e-7 < remaining)) {
      end = day * 24 + s.dayEnd - 24;
      continue;
    }
    const hours = Math.min(remaining, cap);
    const start = end - hours;
    const done = remaining - hours < 1e-7;
    out.unshift({
      type: 'travel',
      start,
      end,
      leg,
      from: done ? leg.from : 'En route',
      to: out.length ? 'En route' : leg.to,
      toCity: out.length ? 'En route' : leg.toCity
    });
    addLedger(ledger, start, end, 'travel');
    remaining -= hours;
    end = day * 24 + s.dayEnd - 24;
  }
  return remaining > 1e-7 ? null : out.map((e, i) => ({ ...e, part: i + 1 }));
}

// Rest between days and no overlap inside a day.
function validateEvents(events, s) {
  const days = new Map();
  for (const e of events) {
    const d = dayOf(e.start);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(e);
  }
  let lastEnd = null;
  for (const [, dayEvents] of [...days].sort((a, b) => a[0] - b[0])) {
    dayEvents.sort((a, b) => a.start - b.start);
    if (lastEnd !== null && dayEvents[0].start - lastEnd < s.rest - 1e-7) return 'Insufficient overnight rest between days.';
    for (let i = 1; i < dayEvents.length; i++) {
      if (dayEvents[i].start < dayEvents[i - 1].end - 1e-7) return 'Travel overlaps a visit.';
    }
    lastEnd = dayEvents.at(-1).end;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Member availability
// ---------------------------------------------------------------------------

export function memberTravelAvailability(team, name, start = -Infinity, end = Infinity) {
  const rule = team.memberAvailability?.[name];
  if (!rule) return { available: true, reason: 'Available' };
  if (rule.available === false) return { available: false, reason: 'Marked unavailable for travel' };
  const from = Number.isFinite(start) ? isoDay(start) : null;
  const to = Number.isFinite(end) ? isoDay(Math.max(start, end - 1e-7)) : null;
  const conflict = (rule.unavailable || []).find((r) => from && to && r.from <= to && r.to >= from);
  return conflict ? { available: false, reason: `Unavailable ${conflict.from} to ${conflict.to}` } : { available: true, reason: 'Available' };
}

// ---------------------------------------------------------------------------
// Building one route
// ---------------------------------------------------------------------------

// Visits are date-fixed, so a route is a chronological chain: base -> visits in
// date order -> base. Feasibility is about whether the travel in between fits.
function buildRouteFromBase(colleges, state) {
  const s = state.settings;
  const stops = [...colleges].sort((a, b) => hourOf(a) - hourOf(b) || a.id.localeCompare(b.id));
  if (!stops.length) return { feasible: false, reason: 'No visits.' };
  if (stops.some((c) => !isDemo(c) && !hasCampus(c) && !c.city)) {
    return { feasible: false, reason: 'Confirm this campus location before calculating travel.' };
  }
  const fixed = [...new Set(stops.filter((c) => c.team !== 'auto').map((c) => c.team))];
  if (fixed.length > 1) return { feasible: false, reason: 'Different fixed team assignments.' };
  for (let i = 1; i < stops.length; i++) {
    if (hourOf(stops[i]) < hourOf(stops[i - 1]) + stops[i - 1].duration + s.buffer) {
      return { feasible: false, reason: 'Visit times overlap or leave no transfer buffer.' };
    }
  }

  const ledger = {};
  const events = stops.map((c) => ({
    type: c.visitType || 'assessment',
    start: hourOf(c),
    end: hourOf(c) + c.duration,
    college: c,
    to: locationName(c)
  }));
  for (const e of events) addLedger(ledger, e.start, e.end, 'visit');

  const legs = [];
  const outbound = legOptions(state.base, stops[0], state);
  legs.push(outbound);
  if (!Number.isFinite(outbound.hours)) {
    return { feasible: false, reason: 'No usable road or air route to this campus. Check the pins or enter a verified leg duration.' };
  }
  const pre = outboundTravel(outbound, hourOf(stops[0]) - s.buffer, ledger, s);
  if (!pre) return { feasible: false, reason: 'Outbound travel cannot fit within the daily limits.' };
  events.push(...pre);

  for (let i = 1; i < stops.length; i++) {
    const leg = legOptions(stops[i - 1], stops[i], state);
    legs.push(leg);
    if (!Number.isFinite(leg.hours)) return { feasible: false, reason: 'A leg between visits has no travel estimate.' };
    const start = hourOf(stops[i - 1]) + stops[i - 1].duration + s.buffer;
    const deadline = hourOf(stops[i]) - s.buffer;
    const trip = forwardTravel(leg, start, ledger, s, deadline);
    if (!trip || trip.at(-1).end > deadline + 1e-7) return { feasible: false, reason: 'Not enough travel time between visits.' };
    events.push(...trip);
  }

  const last = stops.at(-1);
  const back = legOptions(last, state.base, state);
  legs.push(back);
  if (!Number.isFinite(back.hours)) return { feasible: false, reason: 'The return leg has no travel estimate.' };
  let ret = forwardTravel(back, hourOf(last) + last.duration + s.buffer, ledger, s);
  if (!ret) return { feasible: false, reason: 'Return travel cannot fit within the daily limits.' };
  events.push(...ret);
  events.sort((a, b) => a.start - b.start);

  // The return journey is the only flexible piece: if the day is already too
  // long, or rest would be short, push it to the next morning and retry once.
  let issue = validateEvents(events, s);
  if (issue && ret[0].start >= hourOf(last) + last.duration) {
    for (const e of ret) {
      const entry = ledgerFor(ledger, dayOf(e.start));
      entry.travel -= e.end - e.start;
      entry.duty -= e.end - e.start;
      events.splice(events.indexOf(e), 1);
    }
    const previousEnd = events.at(-1).end;
    const again = forwardTravel(back, Math.max((dayOf(previousEnd) + 1) * 24 + s.dayStart, previousEnd + s.rest), ledger, s);
    if (!again) return { feasible: false, reason: issue };
    ret = again;
    events.push(...again);
    events.sort((a, b) => a.start - b.start);
    issue = validateEvents(events, s);
  }
  if (issue) return { feasible: false, reason: issue };

  const start = events[0].start;
  const end = events.at(-1).end;
  const overnights = [];
  for (let d = dayOf(start); d < dayOf(end); d++) {
    const before = events.filter((e) => e.end <= (d + 1) * 24).at(-1);
    const city = before?.toCity || before?.to || state.base;
    if (city !== state.base) overnights.push({ day: d, city, start: (d + 1) * 24 - 0.01, end: (d + 1) * 24 + 0.01, type: 'overnight' });
  }
  if (overnights.length > s.maxNights) {
    return { feasible: false, reason: `This grouping needs ${overnights.length} nights away; the limit is ${s.maxNights}.` };
  }

  return {
    feasible: true,
    stops, legs, events, overnights,
    start, end,
    nights: overnights.length,
    hours: legs.reduce((n, l) => n + l.hours, 0),
    roadHours: legs.reduce((n, l) => n + (l.road || 0), 0),
    distance: legs.reduce((n, l) => n + (l.distance || 0), 0),
    fixedTeam: fixed[0] || null
  };
}

// Try the candidate teams' bases and keep the cheapest feasible attempt.
export function buildRoute(colleges, state, team = null) {
  const fixed = [...new Set(colleges.filter((c) => c.team !== 'auto').map((c) => c.team))];
  if (fixed.length > 1) return { feasible: false, reason: 'Different fixed team assignments.' };

  const signature = (c) => JSON.stringify([c.requiredPeople ?? null, [...(c.assignedMembers || [])].sort()]);
  if (new Set(colleges.map(signature)).size > 1) {
    return { feasible: false, reason: 'Different visit staffing requirements need separate travelling parties.' };
  }

  const requiredMembers = colleges[0]?.assignedMembers || [];
  const requiredPeople = colleges[0]?.requiredPeople;
  const candidates = (team ? [team] : state.teams.filter((t) => !fixed.length || t.id === fixed[0])).filter(
    (t) => (requiredPeople === undefined || t.size >= requiredPeople) && requiredMembers.every((n) => t.members?.includes(n))
  );

  const attempts = candidates.map((t) => ({
    ...buildRouteFromBase(colleges, { ...state, base: teamBase(t, state) }),
    base: teamBase(t, state),
    candidateTeam: t.id,
    size: requiredPeople ?? t.size,
    requiredMembers
  }));

  return (
    attempts.filter((r) => r.feasible).sort((a, b) => routeScore(a, state) - routeScore(b, state) || a.candidateTeam.localeCompare(b.candidateTeam))[0] ||
    attempts[0] || { feasible: false, reason: 'No team has enough people, or the selected members, for this visit.' }
  );
}

// Lower is better. `tour` is the fixed cost of sending anyone anywhere at all,
// which is what makes merging two routes worthwhile.
export function routeScore(route, state) {
  const minSize = Math.min(...state.teams.map((t) => t.size));
  const size = route.size || state.teams.find((t) => t.id === route.fixedTeam)?.size || minSize;
  const w =
    state.settings.priority === 'teams' ? { travel: 0.5, night: 1, tour: 25 }
    : state.settings.priority === 'time' ? { travel: 1, night: 0.25, tour: 0 }
    : { travel: 1, night: 1.5, tour: 6 };
  return route.hours * size * w.travel + route.nights * size * w.night + w.tour;
}

// ---------------------------------------------------------------------------
// Planning every visit
// ---------------------------------------------------------------------------

export function planRoutes(state) {
  const errors = validateState(state);
  if (errors.length) return { errors, routes: [], unplaced: [], warnings: [] };

  let routes = [];
  const unplaced = [];
  for (const visit of travelVisits(state)) {
    const route = buildRoute([visit], state);
    if (route.feasible) routes.push(route);
    else unplaced.push({ college: visit, reason: route.reason });
  }

  // Deterministic savings heuristic: repeatedly merge the pair of routes whose
  // combined trip saves the most weighted cost. Dates are fixed, so a merge is
  // only ever a chronological chain — and only accepted when it stays feasible.
  // This is a good local search, not a proven global optimum.
  let changed = true;
  while (changed) {
    changed = false;
    let best = null;
    let bestGain = 1e-6;
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const merged = buildRoute([...routes[i].stops, ...routes[j].stops], state);
        if (!merged.feasible) continue;
        const gain = routeScore(routes[i], state) + routeScore(routes[j], state) - routeScore(merged, state);
        if (gain > bestGain) {
          bestGain = gain;
          best = { i, j, route: merged };
        }
      }
    }
    if (best) {
      routes = routes.filter((_, i) => i !== best.i && i !== best.j);
      routes.push(best.route);
      changed = true;
    }
  }

  routes.sort((a, b) => a.start - b.start || a.stops[0].id.localeCompare(b.stops[0].id));

  // Assign teams and people. Explicit assignments are reserved first so
  // automatic work can never displace a person somebody chose by name.
  const reservations = new Map(state.teams.map((t) => [t.id, []]));
  const warnings = [];

  const selectPeople = (team, route) => {
    const slots = Array.from({ length: team.size }, (_, i) => team.members?.[i] || '__unnamed:' + team.id + ':' + i);
    const free = slots.filter(
      (n) =>
        (n.startsWith('__unnamed:') || memberTravelAvailability(team, n, route.start, route.end).available) &&
        reservations.get(team.id).every((x) => !x.personKeys.includes(n) || route.start >= x.end || route.end <= x.start)
    );
    if (!route.requiredMembers.every((n) => free.includes(n))) return null;
    const picked = [...route.requiredMembers, ...free.filter((n) => !route.requiredMembers.includes(n))].slice(0, route.size);
    return picked.length === route.size ? picked : null;
  };

  const order = [...routes].sort(
    (a, b) =>
      Number(!!b.requiredMembers.length) - Number(!!a.requiredMembers.length) ||
      Number(!!b.fixedTeam) - Number(!!a.fixedTeam) ||
      a.start - b.start
  );
  for (const route of order) {
    const candidates = route.fixedTeam
      ? state.teams.filter((t) => t.id === route.fixedTeam)
      : [...state.teams].sort(
          (a, b) => a.size - b.size || reservations.get(b.id).length - reservations.get(a.id).length || a.id.localeCompare(b.id)
        );
    const options = candidates
      .map((team) => ({ team, route: buildRoute(route.stops, state, team) }))
      .map((x) => ({ ...x, people: x.route.feasible ? selectPeople(x.team, x.route) : null }))
      .filter((x) => x.people)
      .sort((a, b) => routeScore(a.route, state) - routeScore(b.route, state) || a.team.id.localeCompare(b.team.id));

    const chosen = options[0];
    if (chosen) {
      Object.assign(route, chosen.route);
      route.teamId = chosen.team.id;
      route.teamName = chosen.team.name;
      route.personKeys = chosen.people;
      route.memberNames = chosen.people.filter((n) => !n.startsWith('__unnamed:'));
      reservations.get(chosen.team.id).push(route);
    } else {
      route.memberNames = [];
      route.personKeys = [];
      route.teamId = null;
      route.teamName = route.fixedTeam
        ? (state.teams.find((t) => t.id === route.fixedTeam)?.name || 'Fixed team') + ' · conflict'
        : 'Needs a team';
      route.size = route.size || Math.min(...state.teams.map((t) => t.size));
      warnings.push(
        route.fixedTeam
          ? 'A fixed team has required people with overlapping travel or too little rest.'
          : 'Not enough available people for all routes; check visit staffing.'
      );
    }
  }

  routes.forEach((r, i) => {
    r.id = 'r' + (i + 1);
    r.number = i + 1;
    r.personHours = r.hours * r.size;
    r.personNights = r.nights * r.size;
  });

  // Baseline: what the same visits would cost as separate base-and-back trips,
  // priced with the same estimates and the same team size.
  const covered = new Set(routes.flatMap((r) => r.stops.map((c) => c.id)));
  const included = travelVisits(state).filter((c) => covered.has(c.id));
  let baselineHours = 0;
  let baselinePersonHours = 0;
  for (const c of included) {
    const route = routes.find((r) => r.stops.some((s) => s.id === c.id));
    const hours = legOptions(route.base, c, state).hours + legOptions(c, route.base, state).hours;
    baselineHours += hours;
    baselinePersonHours += hours * route.size;
  }

  const hours = routes.reduce((n, r) => n + r.hours, 0);
  const personHours = routes.reduce((n, r) => n + r.personHours, 0);

  return {
    errors: [],
    warnings: [...new Set(warnings)],
    routes,
    unplaced,
    metrics: {
      hours,
      personHours,
      baselineHours,
      baselinePersonHours,
      saved: baselineHours - hours,
      savedPersonHours: baselinePersonHours - personHours,
      savePercent: baselinePersonHours ? (100 * (baselinePersonHours - personHours)) / baselinePersonHours : 0,
      nights: routes.reduce((n, r) => n + r.nights, 0),
      personNights: routes.reduce((n, r) => n + r.personNights, 0),
      teams: new Set(routes.filter((r) => r.teamId).map((r) => r.teamId)).size,
      unassigned: routes.filter((r) => !r.teamId).length,
      covered: new Set(included.map((c) => c.planningVisitId || c.id)).size
    }
  };
}

// Re-plan from each candidate base so the cost of the choice is visible.
export function compareBases(state, bases) {
  const candidates = bases?.length ? bases : [...new Set([state.base, ...state.teams.map((t) => teamBase(t, state))])];
  return candidates.map((base) => {
    const plan = planRoutes({ ...state, base });
    return { base, ...plan.metrics, routes: plan.routes.length, unplaced: plan.unplaced.length, errors: plan.errors };
  });
}

// Who could actually take one more visit: declared availability first, then
// whether the visit itself is reachable, then clashes with existing routes.
export function collegeMemberAvailability(state, college) {
  const others = planRoutes({ ...state, colleges: state.colleges.filter((c) => c.id !== college.id) });
  return state.teams.flatMap((team) =>
    (team.members || []).map((name) => {
      if (!college.date && !college.interviewDate) {
        const declared = memberTravelAvailability(team, name);
        return {
          name,
          teamId: team.id,
          available: declared.available,
          reason: declared.reason === 'Available' ? 'Add dates to check travel availability' : declared.reason
        };
      }
      const candidate = { ...college, team: team.id, requiredPeople: 1, assignedMembers: [name] };
      const draft = buildRoute([candidate], state, team);
      const declared = draft.feasible ? memberTravelAvailability(team, name, draft.start, draft.end) : null;
      if (declared && !declared.available) return { name, teamId: team.id, available: false, reason: declared.reason };

      const proposed = planRoutes({ ...state, teams: [team], colleges: [candidate] });
      if (proposed.errors.length || proposed.unplaced.length || proposed.routes.some((r) => !r.teamId)) {
        return { name, teamId: team.id, available: false, reason: proposed.unplaced[0]?.reason || 'Visit and travel cannot fit from this base' };
      }
      const booked = others.routes.filter((r) => r.memberNames?.includes(name));
      const conflict = booked.find((a) => proposed.routes.some((b) => !(b.start >= a.end || b.end <= a.start)));
      return {
        name,
        teamId: team.id,
        available: !conflict,
        reason: conflict
          ? `Busy: ${conflict.stops[0].name}, ${dateText(conflict.start)} ${timeText(conflict.start)} – ${dateText(conflict.end)} ${timeText(conflict.end)}`
          : 'Available for these visits and travel'
      };
    })
  );
}
