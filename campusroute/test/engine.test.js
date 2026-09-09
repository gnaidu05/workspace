import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS, buildRoute, compareBases, formatHours, hourOf, legOptions, planRoutes, routeScore, validateState
} from '../public/engine.js';
import { demoPlan } from '../public/data/sample.js';
import { csvPlan, calendarRosterRows, detailRosterRows, parseCSV, csvCell } from '../public/roster.js';
import { extractCoordinates, networkRoad, parseRoadMatrix, pointKey, validateMatrix } from '../public/geography.js';
import { stationCandidates } from '../public/railway.js';

const basePlan = (overrides = {}) => ({
  schema: 1,
  base: 'Bangalore',
  settings: { ...DEFAULT_SETTINGS },
  locations: {},
  overrides: {},
  teams: [{ id: 't1', name: 'Team One', size: 2 }],
  colleges: [],
  ...overrides
});

const visit = (id, city, date, extra = {}) => ({
  id, name: id + ' campus', city, date, time: '09:00', duration: 6, team: 'auto', demo: false, ...extra
});

// --- validation ------------------------------------------------------------

test('a well-formed plan validates', () => {
  assert.deepEqual(validateState(demoPlan()), []);
});

test('validation rejects unknown schema, base, settings and dates', () => {
  assert.deepEqual(validateState({ schema: 2 }), ['Unsupported plan file.']);
  assert.match(validateState(basePlan({ base: 'Atlantis' }))[0], /default base/);
  assert.match(validateState(basePlan({ settings: { ...DEFAULT_SETTINGS, roadSpeed: 5 } }))[0], /roadSpeed/);
  assert.ok(validateState(basePlan({ colleges: [visit('c1', 'Pune', '2026-02-30')] })).some((e) => /valid date/.test(e)));
  assert.ok(validateState(basePlan({ colleges: [visit('c1', 'Pune', '2026-09-24', { time: '25:00' }) ] })).some((e) => /valid date/.test(e)));
});

test('validation rejects duplicate college ids and a duplicated person', () => {
  const duplicated = basePlan({ colleges: [visit('c1', 'Pune', '2026-09-24'), visit('c1', 'Mumbai', '2026-09-25')] });
  assert.ok(validateState(duplicated).some((e) => /unique/.test(e)));

  const twoTeams = basePlan({
    teams: [
      { id: 't1', name: 'One', size: 1, members: ['A. Rao'] },
      { id: 't2', name: 'Two', size: 1, members: ['a.  rao'] }
    ]
  });
  assert.ok(validateState(twoTeams).some((e) => /one team/.test(e)));
});

test('a day window narrower than an hour is rejected', () => {
  const state = basePlan({ settings: { ...DEFAULT_SETTINGS, dayStart: 12, dayEnd: 12 } });
  assert.ok(validateState(state).some((e) => /at least one hour/.test(e)));
});

// --- leg estimates ---------------------------------------------------------

test('a city leg prefers air when it saves more than 45 minutes', () => {
  const state = basePlan();
  const leg = legOptions('Bangalore', 'Delhi', state);
  assert.equal(leg.mode, 'air');
  assert.ok(leg.air < leg.road);
  assert.equal(leg.airports, 'BLR–DEL');
});

test('a short city leg stays on the road', () => {
  const leg = legOptions('Pune', 'Mumbai', basePlan());
  assert.equal(leg.mode, 'road');
});

test('an override replaces the model and is keyed to the exact endpoints', () => {
  const state = basePlan();
  const plain = legOptions('Bangalore', 'Delhi', state);
  state.overrides[plain.key] = { mode: 'road', road: 30, distance: 2100 };
  const overridden = legOptions('Bangalore', 'Delhi', state);
  assert.equal(overridden.mode, 'road');
  assert.equal(overridden.hours, 30);
  assert.equal(overridden.distance, 2100);
  assert.equal(overridden.custom, true);
  // The reverse direction is a different leg and keeps the model estimate.
  assert.notEqual(legOptions('Delhi', 'Bangalore', state).hours, 30);
});

test('air can be ruled out per leg', () => {
  const state = basePlan();
  const key = legOptions('Bangalore', 'Delhi', state).key;
  state.overrides[key] = { air: null };
  const leg = legOptions('Bangalore', 'Delhi', state);
  assert.equal(leg.air, null);
  assert.equal(leg.mode, 'road');
});

test('a train itinerary is used when it is shorter and quicker', () => {
  const state = basePlan();
  const key = legOptions('Pune', 'Mumbai', state).key;
  state.overrides[key] = {
    rail: { fromStation: 'Pune Jn', toStation: 'Mumbai CSMT', hours: 1.5, km: 120, departureHours: 0.3, departureKm: 6, arrivalHours: 0.3, arrivalKm: 5, buffer: 0.4 }
  };
  const leg = legOptions('Pune', 'Mumbai', state);
  assert.equal(leg.mode, 'train', 'a shorter, quicker rail itinerary should win');
  assert.equal(leg.trainShorter, true);
  assert.ok(Math.abs(leg.train - 2.5) < 1e-9);
  assert.ok(leg.train < leg.road);
});

test('a measured road matrix beats the coordinate estimate', () => {
  const a = { lat: 12.9716, lng: 77.5946 };
  const b = { lat: 18.5204, lng: 73.8567 };
  const matrix = parseRoadMatrix(
    { code: 'Ok', durations: [[0, 3600], [3600, 0]], distances: [[0, 120000], [120000, 0]], sources: [{ location: [77.5946, 12.9716], distance: 0 }, { location: [73.8567, 18.5204], distance: 0 }] },
    [a, b],
    Date.now()
  );
  assert.equal(validateMatrix(matrix), true);
  const road = networkRoad(a, b, { network: matrix });
  assert.equal(road.source, 'road-network');
  assert.equal(road.distance, 120);
  assert.equal(matrix.pointKeys[0], pointKey(a));
});

test('an incomplete matrix is refused', () => {
  assert.equal(validateMatrix({ pointKeys: ['1.000000,2.000000'], durations: [[0]], distances: [[0]], snapped: [], updatedAt: Date.now() }), false);
  assert.throws(() => parseRoadMatrix({ code: 'NoRoute' }, []), /Road routing returned NoRoute/);
});

// --- scheduling ------------------------------------------------------------

test('one visit becomes a base-and-back route', () => {
  const state = basePlan({ colleges: [visit('c1', 'Pune', '2026-09-24')] });
  const plan = planRoutes(state);
  assert.equal(plan.routes.length, 1);
  const route = plan.routes[0];
  assert.equal(route.stops.length, 1);
  assert.equal(route.legs.length, 2); // out and back
  assert.equal(route.teamId, 't1');
  assert.ok(route.start < hourOf(state.colleges[0]));
  assert.ok(route.end > hourOf(state.colleges[0]) + 6);
});

test('nearby visits on consecutive days merge into one tour', () => {
  const state = basePlan({
    colleges: [visit('c1', 'Kozhikode', '2026-09-24'), visit('c2', 'Palakkad', '2026-09-25'), visit('c3', 'Coimbatore', '2026-09-26')]
  });
  const plan = planRoutes(state);
  assert.equal(plan.routes.length, 1);
  assert.equal(plan.routes[0].stops.length, 3);
  assert.ok(plan.routes[0].nights >= 2);
  assert.ok(plan.metrics.savedPersonHours > 0);
  assert.ok(plan.metrics.savePercent > 0 && plan.metrics.savePercent < 100);
});

test('visits that clash in time are never merged', () => {
  const state = basePlan({
    colleges: [visit('c1', 'Delhi', '2026-09-24'), visit('c2', 'Chennai', '2026-09-24')]
  });
  const plan = planRoutes(state);
  assert.equal(plan.routes.length, 2);
  const merged = buildRoute([...plan.routes[0].stops, ...plan.routes[1].stops], state);
  assert.equal(merged.feasible, false);
  assert.match(merged.reason, /overlap|buffer/);
});

test('the daily window and rest hours are enforced', () => {
  const tight = basePlan({
    settings: { ...DEFAULT_SETTINGS, dayStart: 9, dayEnd: 12, maxTravel: 1 },
    colleges: [visit('c1', 'Delhi', '2026-09-24')]
  });
  const plan = planRoutes(tight);
  assert.equal(plan.routes.length, 0);
  assert.equal(plan.unplaced.length, 1);
  assert.match(plan.unplaced[0].reason, /daily limits|travel time/);
});

test('the nights-away limit rejects an over-long tour', () => {
  const colleges = [
    visit('c1', 'Kozhikode', '2026-09-24'),
    visit('c2', 'Palakkad', '2026-09-26'),
    visit('c3', 'Coimbatore', '2026-09-29')
  ];
  const generous = planRoutes(basePlan({ colleges }));
  assert.equal(generous.routes.length, 1);
  const strict = planRoutes(basePlan({ colleges, settings: { ...DEFAULT_SETTINGS, maxNights: 1 } }));
  assert.ok(strict.routes.length > 1, 'a one-night limit should stop the long merge');
});

test('a visit with no reachable location is reported, not silently dropped', () => {
  const state = basePlan({ colleges: [{ id: 'c1', name: 'Somewhere', city: '', date: '2026-09-24', time: '09:00', duration: 6, team: 'auto' }] });
  const plan = planRoutes(state);
  assert.ok(plan.errors.length > 0);
});

test('an interview date adds a second visit for the same college', () => {
  const state = basePlan({
    colleges: [visit('c1', 'Pune', '2026-09-24', { interviewDate: '2026-09-26', interviewTime: '10:00', interviewDuration: 4 })]
  });
  const plan = planRoutes(state);
  const stops = plan.routes.flatMap((r) => r.stops);
  assert.equal(stops.length, 2);
  assert.ok(stops.some((s) => s.visitType === 'interview' && s.duration === 4));
});

// --- teams and people ------------------------------------------------------

test('a fixed team assignment is respected', () => {
  const state = basePlan({
    teams: [{ id: 't1', name: 'One', size: 2 }, { id: 't2', name: 'Two', size: 2 }],
    colleges: [visit('c1', 'Pune', '2026-09-24', { team: 't2' })]
  });
  const plan = planRoutes(state);
  assert.equal(plan.routes[0].teamId, 't2');
});

test('named people are not double-booked across overlapping routes', () => {
  const state = basePlan({
    teams: [{ id: 't1', name: 'One', size: 1, members: ['A. Rao'] }],
    colleges: [visit('c1', 'Delhi', '2026-09-24'), visit('c2', 'Chennai', '2026-09-24')]
  });
  const plan = planRoutes(state);
  const assigned = plan.routes.filter((r) => r.teamId);
  assert.equal(assigned.length, 1, 'only one of two clashing routes can have the one-person team');
  assert.ok(plan.warnings.length > 0);
});

test('a member marked unavailable is left out of that window', () => {
  const state = basePlan({
    teams: [{
      id: 't1', name: 'One', size: 1, members: ['A. Rao'],
      memberAvailability: { 'A. Rao': { available: true, unavailable: [{ from: '2026-09-23', to: '2026-09-26' }] } }
    }],
    colleges: [visit('c1', 'Pune', '2026-09-24')]
  });
  const plan = planRoutes(state);
  assert.equal(plan.routes[0].teamId, null);
  assert.ok(plan.warnings.length > 0);
});

test('people from two teams on one visit travel as separate parties', () => {
  const state = basePlan({
    teams: [
      { id: 't1', name: 'One', size: 2, members: ['A. Rao', 'B. Singh'] },
      { id: 't2', name: 'Two', size: 2, members: ['C. Iyer', 'D. Bose'] }
    ],
    colleges: [visit('c1', 'Pune', '2026-09-24', { requiredPeople: 2, assignedMembers: ['A. Rao', 'C. Iyer'] })]
  });
  const plan = planRoutes(state);
  assert.equal(plan.routes.length, 2);
  assert.deepEqual(plan.routes.map((r) => r.size).sort(), [1, 1]);
  assert.equal(plan.metrics.covered, 1, 'the visit is still counted once');
});

test('routing priority changes the score, and comparing bases re-plans', () => {
  const state = basePlan({
    colleges: [visit('c1', 'Kozhikode', '2026-09-24'), visit('c2', 'Coimbatore', '2026-09-26')]
  });
  const route = planRoutes(state).routes[0];
  const balanced = routeScore(route, state);
  const fewerTeams = routeScore(route, { ...state, settings: { ...state.settings, priority: 'teams' } });
  assert.notEqual(balanced, fewerTeams);

  const comparison = compareBases(state, ['Bangalore', 'Coimbatore', 'Delhi']);
  assert.equal(comparison.length, 3);
  assert.ok(comparison.every((row) => Number.isFinite(row.personHours)));
  const best = [...comparison].sort((a, b) => a.personHours - b.personHours)[0];
  assert.equal(best.base, 'Coimbatore');
});

// --- rosters and imports ---------------------------------------------------

test('the person-day roster has one column per date and one row per person', () => {
  const state = basePlan({
    teams: [{ id: 't1', name: 'One', size: 2, members: ['A. Rao', 'B. Singh'] }],
    colleges: [visit('c1', 'Pune', '2026-09-24')]
  });
  const plan = planRoutes(state);
  const rows = calendarRosterRows(state, plan);
  assert.equal(rows[0][0], 'Full name');
  assert.equal(rows.length, 3);
  assert.ok(rows[0].includes('2026-09-24'));
  const cell = rows[1][rows[0].indexOf('2026-09-24')];
  assert.match(cell, /c1 campus|Travel/);
});

test('the activity roster lists travel, visits and nights', () => {
  const state = basePlan({
    teams: [{ id: 't1', name: 'One', size: 1, members: ['A. Rao'] }],
    colleges: [visit('c1', 'Kozhikode', '2026-09-24'), visit('c2', 'Coimbatore', '2026-09-26')]
  });
  const rows = detailRosterRows(state, planRoutes(state));
  const activities = new Set(rows.slice(1).map((r) => r[6]));
  assert.ok(activities.has('Assessment'));
  assert.ok([...activities].some((a) => /travel/i.test(a)));
});

test('CSV import accepts a pinned campus and rejects an unknown city', () => {
  const state = basePlan();
  const good = csvPlan(
    'college,city,date,start,duration,team,latitude,longitude\r\n' +
    'Test College,Pune,2026-09-24,09:00,6,auto,18.52,73.85\r\n',
    state
  );
  assert.equal(good.colleges.length, 1);
  assert.equal(good.colleges[0].location.confirmed, true);
  assert.deepEqual(validateState(good), []);
  assert.throws(() => csvPlan('college,city,date\r\nX,Gotham,2026-09-24\r\n', state), /not a known city/);
  assert.throws(() => csvPlan('name,place\r\nX,Y\r\n', state), /Required CSV headers/);
});

test('CSV parsing and quoting survive commas, quotes and formulas', () => {
  const rows = parseCSV('a,"b,c","say ""hi"""\r\nd,e,f');
  assert.deepEqual(rows, [['a', 'b,c', 'say "hi"'], ['d', 'e', 'f']]);
  assert.equal(csvCell('=cmd()'), '"\'=cmd()"');
  assert.equal(csvCell('-'), '"-"');
});

// --- odds and ends ---------------------------------------------------------

test('coordinates are read from a point, never from a map viewport', () => {
  assert.deepEqual(extractCoordinates('12.9716, 77.5946'), { lat: 12.9716, lng: 77.5946 });
  assert.deepEqual(extractCoordinates('https://www.openstreetmap.org/?mlat=12.9&mlon=77.6#map=17/12.9/77.6'), { lat: 12.9, lng: 77.6 });
  assert.equal(extractCoordinates('https://example.com/maps/@12.9,77.6,14z'), null);
  assert.equal(extractCoordinates('not coordinates'), null);
});

test('station candidates keep mainline stops and drop metro and disused ones', () => {
  const data = {
    elements: [
      { type: 'node', id: 1, lat: 12.98, lon: 77.57, tags: { railway: 'station', name: 'Bangalore City' } },
      { type: 'node', id: 2, lat: 12.98, lon: 77.58, tags: { railway: 'station', station: 'subway', name: 'Metro Stop' } },
      { type: 'node', id: 3, lat: 12.99, lon: 77.59, tags: { railway: 'halt', name: 'Old Halt', disused: 'yes' } },
      { type: 'node', id: 4, lat: 40.0, lon: 77.59, tags: { railway: 'station', name: 'Far Away' } }
    ]
  };
  const stations = stationCandidates(data, { lat: 12.9716, lng: 77.5946 });
  assert.deepEqual(stations.map((s) => s.name), ['Bangalore City']);
  assert.throws(() => stationCandidates({ elements: [], remark: 'timeout' }, { lat: 0, lng: 0 }), /incomplete/);
});

test('hours are formatted for people, not machines', () => {
  assert.equal(formatHours(0), '0m');
  assert.equal(formatHours(1.5), '1h 30m');
  assert.equal(formatHours(2), '2h');
  assert.equal(formatHours(null), 'Unavailable');
});

test('planning the demo plan produces routes, no errors and a saving', () => {
  const plan = planRoutes(demoPlan());
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.unplaced.length, 0);
  assert.ok(plan.routes.length >= 1);
  assert.ok(plan.metrics.savedPersonHours > 0);
  for (const route of plan.routes) {
    // Events never overlap and always sit inside the route window.
    const sorted = [...route.events].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end - 1e-6, 'events must not overlap');
    assert.ok(route.start <= route.end);
  }
});

test('every reference city points at an airport that exists', async () => {
  const { CITIES } = await import('../public/data/cities.js');
  const { AIRPORTS } = await import('../public/data/airports.js');
  const broken = Object.entries(CITIES).filter(([, c]) => c.airport && !AIRPORTS[c.airport]);
  assert.deepEqual(broken, [], 'a city must not name an airport the reference list does not have');
  for (const [name, city] of Object.entries(CITIES)) {
    assert.ok(Number.isFinite(city.lat) && Number.isFinite(city.lng), name + ' needs coordinates');
    assert.ok(Number.isFinite(city.access), name + ' needs an airport access time');
  }
});

test('an unknown airport code degrades to no air option instead of throwing', () => {
  const state = basePlan({
    colleges: [visit('c1', 'Pune', '2026-09-24', {
      airport: 'ZZZ',
      location: { lat: 18.52, lng: 73.85, confirmed: true, address: 'somewhere' }
    })]
  });
  const leg = legOptions(state.base, state.colleges[0], state);
  assert.equal(leg.air, null);
  assert.equal(leg.mode, 'road');
  assert.ok(planRoutes(state).routes.length >= 0);
});

test('comparing every reference base stays feasible and fast enough to be a dialog', () => {
  const state = demoPlan();
  const started = Date.now();
  const rows = compareBases(state, ['Bangalore', 'Pune', 'Mumbai', 'Chennai', 'Delhi', 'Kochi']);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => Number.isFinite(r.personHours) && r.routes >= 1));
  assert.ok(Date.now() - started < 5000);
});

test('a station lookup falls back to a mirror when the first service is down', async () => {
  const { nearestStations } = await import('../public/railway.js');
  const tried = [];
  const fetcher = async (url) => {
    tried.push(new URL(url).host);
    if (tried.length === 1) throw new Error('socket hang up');
    return {
      ok: true,
      json: async () => ({ elements: [{ type: 'node', id: 1, lat: 11.25, lon: 75.78, tags: { railway: 'station', name: 'Kozhikode' } }] })
    };
  };
  const result = await nearestStations({ lat: 11.2588, lng: 75.7804 }, { fetcher });
  assert.equal(result.stations[0].name, 'Kozhikode');
  assert.equal(tried.length, 2, 'the mirror should be tried after the first failure');
});
