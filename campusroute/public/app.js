// CampusRoute — application shell.
//
// One mutable `state` (the plan), one derived `plan` (the routes), and a full
// re-render after every change. The plan is small and the engine is fast, so
// re-rendering is simpler and less bug-prone than patching the DOM in place.

import {
  MAX_DATED_VISITS, formatHours, hasCampusPin, locationsOf, planRoutes, routingPoints, scheduledVisits, validateState
} from './engine-ui.js';
import { extractCoordinates, fetchRoadMatrix, isCoordinate, matrixSignature, pointKey, searchCampus } from './geography.js';
import { nearestStations, stationTransfers, validStationLookup } from './railway.js';
import { demoPlan, starterColleges } from './data/sample.js';
import { Sharing, planUrl, readDraft } from './share.js';
import { $, $$, actButton, copyText, download, esc, icon, metric, num, toast } from './ui-helpers.js';
import { SETTING_FIELDS, collegesView, peopleView, routesView, settingsView, shareBar, teamsView } from './views.js';
import {
  airportPinsDialog, collegeDialog, compareDialog, deleteCollegeDialog, exportDialog, helpDialog,
  importPreviewDialog, legDialog, shareDialog, staffingDialog, teamDialog
} from './dialogs.js';
import { CSV_TEMPLATE, calendarRosterRows, csvPlan, detailRosterRows, planSummaryText, toCSV } from './roster.js';

// --- mutable app state -----------------------------------------------------

let state = readDraft() || demoPlan();
let plan = planRoutes(state);
let tab = state.colleges.some((c) => c.date || c.interviewDate) ? 'routes' : 'colleges';
let detail = 'schedule';
let selected = plan.routes[0]?.id;
let collegeSearch = '';
let pendingImport = null;
let locationMatches = [];
let pendingPin = null;
let networkMessage = '';
let networkBusy = false;
let matrixJob = 0;
const stationFailures = new Map();
const stationJobs = new Map();

const sharing = new Sharing({ onStatus: () => $$('.saved-label').forEach((el) => (el.textContent = sharing.status)) });

// Actions a read-only viewer is still allowed to take.
const READ_ACTIONS = new Set([
  'help', 'export-menu', 'export-json', 'export-csv', 'export-detail-csv', 'export-text', 'print', 'close-dialog',
  'compare-bases', 'fork-plan', 'reload-shared', 'copy-view-link', 'go-colleges', 'csv-template'
]);

const ctx = () => ({ state, plan, tab, detail, selected, collegeSearch, sharing, canEdit: sharing.canEdit });

// --- render ----------------------------------------------------------------

function render() {
  const m = plan.metrics || {};
  const dated = scheduledVisits(state).length;
  const tabs = [
    ['routes', 'Route overview', 'route'],
    ['colleges', 'Colleges & dates', 'college'],
    ['teams', 'Teams', 'users'],
    ['people', 'People', 'user'],
    ['settings', 'Assumptions', 'settings']
  ];

  $('#app').innerHTML = `<div class="shell">
    <aside class="rail" aria-label="Workspace navigation">
      <a href="#" class="brand-icon" aria-label="CampusRoute home"><svg viewBox="0 0 40 40"><path d="m31 7-9 23-16 5 9-23Z" fill="#d8e7ae"/><circle cx="20" cy="21" r="3.7" fill="#174d45"/></svg></a>
      ${tabs.map(([id, label, i]) => `<button data-tab="${id}" class="rail-button ${tab === id ? 'active' : ''}" aria-label="${label}" title="${label}">${icon(i)}</button>`).join('')}
      <div class="rail-spacer"></div>
      <button class="rail-button" data-action="help" aria-label="How planning works" title="How planning works">${icon('help')}</button>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb"><div class="wordmark">Campus<span>Route</span></div><span class="slash">/</span>
        <small>Public assessment travel planner</small></div>
        <div class="top-actions"><span class="private">${icon(sharing.mode === 'local' ? 'user' : 'globe')} ${
          sharing.mode === 'shared-view' ? 'Read-only link' : sharing.mode === 'shared-edit' ? 'Shared plan' : 'Local draft'}</span>
          ${actButton('help', 'How it works', 'secondary small', 'help')}</div></header>
      <main>
        <section aria-label="Planning overview">
          <div class="hero"><div><h1>Team travel planner</h1><p>College visits, travel and overnight stays · all times IST · no account needed</p></div>
            <div class="hero-actions">${actButton('export-menu', 'Export', 'secondary', 'download')}${actButton('optimize', 'Generate routes', 'primary', 'spark')}</div></div>
          ${state.demo
            ? `<div class="demo-note"><span><span class="tag demo">DEMO PLAN</span>${state.colleges.length} example stops priced from city centres. Replace them with your own colleges.</span>
                <button class="text-button" data-tab="colleges">Edit inputs ${icon('arrow')}</button></div>`
            : `<div class="demo-note"><span><span class="tag good">YOUR PLAN</span>${dated} dated visit${dated === 1 ? '' : 's'} · ${state.colleges.length} colleges</span>
                <span class="saved-label">${esc(sharing.status)}</span></div>`}
          ${shareBar(ctx())}
          <div class="metrics">
            ${metric('Grouped routes', plan.routes.length, 'tours', `${m.covered || 0} of ${dated} dated visits`, 'route')}
            ${metric('Teams on the move', m.teams || 0, `of ${state.teams.length}`, m.unassigned ? `<span class="saved">${m.unassigned} route(s) need a team</span>` : 'Includes departure and return', 'users')}
            ${metric('Total team travel', num(m.personHours), 'person-hours', `${formatHours(m.hours)} summed across routes`, 'clock')}
            ${metric('Travel saved', `${Math.round(m.savePercent || 0)}%`, '', `<span class="saved">${num(m.savedPersonHours)} person-hours</span> vs one trip per visit`, 'chart', true)}
          </div>
        </section>
        <section aria-label="Planning workspace">
          <nav class="tabs" aria-label="Planner views">${tabs
            .map(([id, label, i]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}" aria-current="${tab === id ? 'page' : 'false'}">${icon(i)}${label}${
              id === 'colleges' ? `<span class="count">${state.colleges.length}</span>` : ''}</button>`)
            .join('')}<span class="right"><i class="status-dot ${networkBusy ? 'busy' : ''}"></i>${esc(networkMessage || sharing.status)}</span></nav>
          ${plan.errors.length
            ? `<div class="notice error"><strong>Fix these inputs to generate routes</strong><ul>${plan.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
            : ''}
          ${plan.warnings.length
            ? `<div class="notice"><strong>Team assignments need attention.</strong> ${plan.warnings.map(esc).join(' ')}
                <button class="text-button" data-tab="teams">Review teams</button></div>`
            : ''}
          ${plan.unplaced.length
            ? `<div class="notice error"><strong>${plan.unplaced.length} visit(s) could not be routed.</strong><ul>${plan.unplaced
                .map((u) => `<li>${esc((u.college.visitType === 'interview' ? 'Interview · ' : 'Assessment · ') + u.college.name)}: ${esc(u.reason)}
                  <button class="text-button" data-action="edit-college" data-id="${esc(u.college.sourceCollegeId || u.college.id)}">Edit</button></li>`)
                .join('')}</ul>Totals cover routed visits only.</div>`
            : ''}
          ${tab === 'routes' ? routesView(ctx())
            : tab === 'colleges' ? collegesView(ctx())
            : tab === 'teams' ? teamsView(ctx())
            : tab === 'people' ? peopleView(ctx())
            : settingsView(ctx())}
          <div class="geo-attribution">Search: <a href="https://photon.komoot.io" target="_blank" rel="noopener noreferrer">Photon</a> ·
            Roads: <a href="https://project-osrm.org" target="_blank" rel="noopener noreferrer">OSRM</a> ·
            Stations: <a href="https://overpass-api.de" target="_blank" rel="noopener noreferrer">Overpass</a> ·
            © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.
            Place text and coordinates go to those services; names, teams and dates never leave this app.</div>
        </section>
        <footer class="footnote"><span>${icon('globe')} ${
          sharing.mode === 'local' ? 'Nothing is shared until you publish a link.' : 'Anyone with the link can view. Anyone with the edit link can change it.'}</span>
          <button class="text-button" data-action="help">Estimates &amp; method ${icon('info')}</button></footer>
      </main></div></div>`;

  applyViewAccess();
}

// A read-only viewer sees the whole plan and none of the controls that change it.
function applyViewAccess() {
  if (sharing.canEdit) return;
  $$('#app input:not(#college-search), #app select, #app textarea').forEach((el) => (el.disabled = true));
  $$('#app [data-action]').forEach((el) => {
    if (!READ_ACTIONS.has(el.dataset.action)) el.hidden = true;
  });
}

function update({ recompute = true, persist = true } = {}) {
  if (recompute) plan = planRoutes(state);
  if (!plan.routes.some((r) => r.id === selected)) selected = plan.routes[0]?.id;
  if (persist) sharing.save(state);
  render();
  void refreshRoadMatrix();
}

function dialog({ title, description, body }, wide = false) {
  const el = $('#editor');
  el.classList.toggle('wide', wide);
  $('#editor-content').innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p>${description}</p></div>
    <button class="close" data-action="close-dialog" aria-label="Close">${icon('close')}</button></div>${body}`;
  el.setAttribute('aria-labelledby', 'dialog-title');
  if (!el.open) el.showModal();
  if (!sharing.canEdit) {
    $$('#editor input, #editor select, #editor textarea').forEach((x) => (x.disabled = true));
    $$('#editor [data-action]').forEach((x) => {
      if (!READ_ACTIONS.has(x.dataset.action)) x.hidden = true;
    });
  }
}

// --- road matrix -----------------------------------------------------------

// Measure the real road network between every point the plan uses, but only
// when the set of points has actually changed.
async function refreshRoadMatrix(force = false) {
  if (!sharing.canEdit) return;
  let points;
  try {
    points = routingPoints(state).filter((p) => isCoordinate(p));
  } catch {
    return; // an unknown city: validation will report it
  }
  // Measuring is only worth a network call once at least one campus is pinned:
  // city-to-city legs are modelled from reference points either way.
  if (points.length < 2 || points.length > 100) return;
  if (!force && !state.colleges.some(hasCampusPin)) return;
  const signature = matrixSignature(points);
  if (!force && state.network?.signature === signature) return;

  const job = ++matrixJob;
  networkBusy = true;
  networkMessage = `Measuring road routes between ${points.length} points…`;
  render();
  try {
    const matrix = await fetchRoadMatrix(points);
    if (job !== matrixJob) return;
    state.network = matrix;
    networkMessage = '';
    networkBusy = false;
    plan = planRoutes(state);
    sharing.save(state);
    render();
    toast('Road times updated from OSRM.');
  } catch (error) {
    if (job !== matrixJob) return;
    networkBusy = false;
    networkMessage = error.message + ' Estimates are being used instead.';
    render();
  }
}

// --- campus search ---------------------------------------------------------

async function findCampus() {
  const input = $('#campus-search');
  const results = $('#location-results');
  if (!input || !results) return;
  results.innerHTML = '<div class="muted-text">Searching OpenStreetMap…</div>';
  try {
    const city = $('#college-form')?.elements.city?.value;
    const bias = city ? locationsOf(state)[city] : null;
    locationMatches = await searchCampus(input.value, bias);
    results.innerHTML = locationMatches.length
      ? locationMatches
          .map((r, i) => `<button type="button" class="location-result" data-action="choose-campus" data-index="${i}">
            <strong>${esc(r.name || 'Unnamed place')}</strong><small>${esc(r.address)}</small>
            <small>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</small></button>`)
          .join('')
      : '<div class="muted-text">No match. Try the college name plus its locality, or paste coordinates.</div>';
  } catch (error) {
    results.innerHTML = `<div class="dialog-error">${esc(error.message)}</div>`;
  }
}

function fillCampusPin(pin) {
  const form = $('#college-form');
  if (!form) return;
  pendingPin = pin;
  form.elements.lat.value = pin.lat;
  form.elements.lng.value = pin.lng;
  form.elements.address.value = pin.address || '';
  form.elements.pinSource.value = pin.source || 'Manual pin';
  form.elements.confirmed.checked = false;
  $('#campus-pin-state').innerHTML = `<span class="tag warn">Pin ready</span> ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}
    ${pin.address ? '· ' + esc(pin.address) : ''} — tick the box below to confirm it.`;
}

// --- railway stations ------------------------------------------------------

async function loadStations(point, retry = false) {
  const key = pointKey(point);
  const cached = state.stationLookups?.[key];
  if (validStationLookup(cached, point) && !retry) return cached;
  if (stationJobs.has(key)) return stationJobs.get(key);
  if (!retry && Date.now() - (stationFailures.get(key) || 0) < 600000) {
    throw new Error('Station lookup failed recently. Use the button again to retry.');
  }
  const job = (async () => {
    try {
      const value = await nearestStations(point);
      state.stationLookups = { ...state.stationLookups, [key]: value };
      stationFailures.delete(key);
      sharing.save(state);
      render();
      return value;
    } catch (error) {
      stationFailures.set(key, Date.now());
      throw error;
    } finally {
      stationJobs.delete(key);
    }
  })();
  stationJobs.set(key, job);
  return job;
}

// Offer the nearest station at both ends of a leg, with measured transfers.
async function fillLegStations(leg, force = false) {
  const form = $('#leg-form');
  if (!form) return;
  const status = $('#rail-station-status');
  const choices = $('#rail-station-choices');
  status.textContent = 'Finding the nearest stations at both ends…';
  try {
    const [from, to] = await Promise.all([loadStations(leg.fromPoint, force), loadStations(leg.toPoint, force)]);
    if (!form.isConnected) return;
    choices.innerHTML = [['from', from], ['to', to]]
      .map(([side, entry]) => `<label class="field">${side === 'from' ? 'Departure' : 'Arrival'} station · nearest first
        <select data-rail-station="${side}">${entry.stations
          .map((s, i) => `<option value="${i}">${esc(s.name)}${s.code ? ' (' + esc(s.code) + ')' : ''} · ${num(s.distance)} km straight-line</option>`)
          .join('')}</select></label>`)
      .join('');
    form.elements.fromStation.value = from.stations[0].name;
    form.elements.toStation.value = to.stations[0].name;

    status.textContent = 'Measuring road transfers to and from the stations…';
    const [a, b] = await Promise.all([
      stationTransfers(leg.fromPoint, from.stations[0]),
      stationTransfers(leg.toPoint, to.stations[0])
    ]);
    if (!form.isConnected) return;
    if (a.outbound?.hours) {
      form.elements.railDepartureHours.value = a.outbound.hours.toFixed(2);
      form.elements.railDepartureKm.value = Math.round(a.outbound.distance);
    }
    if (b.inbound?.hours) {
      form.elements.railArrivalHours.value = b.inbound.hours.toFixed(2);
      form.elements.railArrivalKm.value = Math.round(b.inbound.distance);
    }
    status.textContent = 'Stations and transfers filled in. Add the train time and distance from the timetable.';
  } catch (error) {
    status.textContent = error.message;
  }
}

// --- exports ---------------------------------------------------------------

function exportJSON() {
  download('campusroute-plan.json', JSON.stringify(state, null, 2), 'application/json');
  toast('Editable plan exported.');
}

function exportCalendarCSV() {
  download('campusroute-person-day-roster.csv', toCSV(calendarRosterRows(state, plan)), 'text/csv;charset=utf-8');
  toast('Person-day roster exported.');
}

function exportDetailCSV() {
  download('campusroute-activity-roster.csv', toCSV(detailRosterRows(state, plan)), 'text/csv;charset=utf-8');
  toast('Activity roster exported.');
}

function exportText() {
  download('campusroute-brief.txt', planSummaryText(state, plan), 'text/plain;charset=utf-8');
  toast('Plain-text brief exported.');
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      const next = file.name.toLowerCase().endsWith('.csv') ? csvPlan(text, state) : JSON.parse(text);
      const errors = validateState(next);
      if (errors.length) throw new Error(errors[0]);
      pendingImport = next;
      dialog(importPreviewDialog(next, planRoutes(next)));
    } catch (error) {
      dialog({
        title: 'This file needs a fix',
        description: 'Your current plan has not changed.',
        body: `<div class="dialog-body"><div class="dialog-error">${esc(error.message)}</div>
          <div class="form-note">Import a plan exported from here, or a CSV with the headers college, city, date, start, duration, team and
            optionally latitude, longitude, address, airport, interview_date, interview_start, interview_duration.</div></div>
          <div class="dialog-footer">${actButton('close-dialog', 'Close', 'secondary')}${actButton('import', 'Choose another file', 'primary', 'upload')}</div>`
      });
    }
  };
  reader.onerror = () => toast('That file could not be read.');
  reader.readAsText(file);
}

// --- form submissions ------------------------------------------------------

function saveCollege(form) {
  const f = form.elements;
  const lat = Number(f.lat.value);
  const lng = Number(f.lng.value);
  const hasPin = f.lat.value !== '' && f.lng.value !== '' && isCoordinate({ lat, lng });
  const existing = state.colleges.find((c) => c.id === form.dataset.id);

  const college = {
    ...(existing || {}),
    id: existing?.id || 'c' + Date.now().toString(36),
    name: f.name.value.trim(),
    city: f.city.value,
    date: f.date.value,
    time: f.time.value || '09:00',
    duration: Number(f.duration.value),
    team: f.team.value,
    airport: f.airport.value,
    demo: false,
    ...(hasPin
      ? {
          location: {
            lat, lng,
            address: f.address.value || pendingPin?.address || '',
            source: f.pinSource.value || pendingPin?.source || 'Manual pin',
            confirmed: f.confirmed.checked,
            checkedAt: new Date().toISOString().slice(0, 10)
          }
        }
      : { location: undefined })
  };
  if (f.interviewDate.value) {
    college.interviewDate = f.interviewDate.value;
    college.interviewTime = f.interviewTime.value || '09:00';
    college.interviewDuration = Number(f.interviewDuration.value) || college.duration;
  } else {
    delete college.interviewDate;
    delete college.interviewTime;
    delete college.interviewDuration;
  }
  const next = existing
    ? state.colleges.map((c) => (c.id === college.id ? college : c))
    : [...state.colleges, college];
  const candidate = { ...state, colleges: next, demo: false };
  const errors = validateState(candidate);
  if (errors.length) {
    $('#form-error').textContent = errors[0];
    return;
  }
  if (scheduledVisits(candidate).length > MAX_DATED_VISITS) {
    $('#form-error').textContent = `That would exceed ${MAX_DATED_VISITS} dated visits.`;
    return;
  }
  state = candidate;
  pendingPin = null;
  $('#editor').close();
  update();
  toast(existing ? 'College updated.' : 'College added.');
}

function saveTeam(form) {
  const f = form.elements;
  const existing = state.teams.find((t) => t.id === form.dataset.id);
  const members = f.members.value.split('\n').map((s) => s.trim()).filter(Boolean);
  const availability = {};
  for (const box of $$('#team-form [name="available"]')) {
    const name = box.dataset.member;
    if (!members.includes(name)) continue;
    const from = $(`#team-form [name="unavailableFrom"][data-member="${CSS.escape(name)}"]`)?.value || '';
    const to = $(`#team-form [name="unavailableTo"][data-member="${CSS.escape(name)}"]`)?.value || '';
    const ranges = from && to ? [{ from, to }] : [];
    if (!box.checked || ranges.length) availability[name] = { available: box.checked, unavailable: ranges };
  }

  const team = {
    ...(existing || {}),
    id: existing?.id || 't' + Date.now().toString(36),
    name: f.name.value.trim(),
    size: Number(f.size.value),
    members,
    ...(f.base.value ? { base: f.base.value } : { base: undefined }),
    ...(Object.keys(availability).length ? { memberAvailability: availability } : { memberAvailability: undefined })
  };
  const teams = existing ? state.teams.map((t) => (t.id === team.id ? team : t)) : [...state.teams, team];
  const candidate = { ...state, teams };
  const errors = validateState(candidate);
  if (errors.length) {
    $('#form-error').textContent = errors[0];
    return;
  }
  state = candidate;
  $('#editor').close();
  update();
  toast(existing ? 'Team updated.' : 'Team added.');
}

function saveSettings(form) {
  const settings = { ...state.settings };
  for (const [key] of SETTING_FIELDS) settings[key] = Number(form.elements[key].value);
  settings.priority = form.elements.priority.value;
  const candidate = { ...state, settings };
  const errors = validateState(candidate);
  if (errors.length) {
    toast(errors[0]);
    return;
  }
  state = candidate;
  update();
  toast('Assumptions applied.');
}

function saveLeg(form) {
  const f = form.elements;
  const key = form.dataset.key;
  const override = {};
  if (f.mode.value !== 'auto') override.mode = f.mode.value;
  if (f.road.value) override.road = Number(f.road.value);
  if (f.distance.value) override.distance = Number(f.distance.value);
  if (f.noAir.checked) override.air = null;
  else if (f.air.value) override.air = Number(f.air.value);

  const railFields = {
    fromStation: f.fromStation.value.trim(),
    toStation: f.toStation.value.trim(),
    hours: Number(f.railHours.value),
    km: Number(f.railKm.value),
    departureHours: Number(f.railDepartureHours.value),
    departureKm: Number(f.railDepartureKm.value),
    arrivalHours: Number(f.railArrivalHours.value),
    arrivalKm: Number(f.railArrivalKm.value),
    buffer: Number(f.railBuffer.value)
  };
  const railEntered = railFields.fromStation || railFields.toStation || railFields.hours || railFields.km;
  if (railEntered) override.rail = railFields;

  const overrides = { ...state.overrides };
  if (Object.keys(override).length) overrides[key] = override;
  else delete overrides[key];

  const candidate = { ...state, overrides };
  const errors = validateState(candidate);
  if (errors.length) {
    $('#form-error').textContent = errors[0];
    return;
  }
  state = candidate;
  $('#editor').close();
  update();
  // An override is tied to its exact endpoints. Re-planning can move a route to
  // another base, and then the adjusted leg is simply not part of the plan any
  // more — say so rather than leaving the user to wonder.
  const stillUsed = plan.routes.some((r) => r.legs.some((l) => l.key === key));
  toast(stillUsed ? 'Leg updated.' : 'Saved. That leg is not in the current plan any more — the routes were re-planned around it.');
}

function saveStaffing(form) {
  const id = form.dataset.id;
  const requiredPeople = Number(form.elements.requiredPeople.value);
  const assignedMembers = $$('#staffing-form [name="assignedMember"]:checked').map((x) => x.value);
  const colleges = state.colleges.map((c) => (c.id === id ? { ...c, requiredPeople, assignedMembers } : c));
  const candidate = { ...state, colleges };
  const errors = validateState(candidate);
  if (errors.length) {
    $('#form-error').textContent = errors[0];
    return;
  }
  state = candidate;
  $('#editor').close();
  update();
  toast('Staffing saved.');
}

// --- event wiring ----------------------------------------------------------

// A read-only viewer's clicks, edits and submissions stop here.
for (const type of ['click', 'change', 'submit']) {
  document.addEventListener(type, (e) => {
    if (sharing.canEdit) return;
    if (type === 'submit' || (type === 'change' && e.target.id !== 'college-search')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action && !READ_ACTIONS.has(action)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-route]');
  if (!el) return;

  if (el.dataset.tab) {
    tab = el.dataset.tab;
    render();
    return;
  }
  if (el.dataset.route) {
    selected = el.dataset.route;
    tab = 'routes';
    detail = 'schedule';
    render();
    $('.timeline-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (el.dataset.detail) {
    detail = el.dataset.detail;
    render();
    return;
  }

  const action = el.dataset.action;
  if (!action) return;

  switch (action) {
    case 'close-dialog':
      $('#editor').close();
      return;
    case 'help':
      dialog(helpDialog(ctx()));
      return;
    case 'go-colleges':
      tab = 'colleges';
      render();
      return;
    case 'optimize':
      update();
      tab = 'routes';
      render();
      toast(plan.errors.length ? 'Review the input alerts.' : `Planned ${plan.routes.length} routes · ${plan.metrics?.covered || 0} visits covered.`);
      return;

    // sharing
    case 'publish':
    case 'fork-plan': {
      el.disabled = true;
      try {
        const links = action === 'publish' ? await sharing.publish(state) : await sharing.fork(state);
        update({ recompute: false, persist: false });
        dialog(shareDialog(links, action === 'fork-plan' ? 'forked' : 'published'));
      } catch (error) {
        toast(error.message);
      } finally {
        el.disabled = false;
      }
      return;
    }
    case 'copy-view-link':
    case 'copy-edit-link': {
      const url = planUrl(sharing.id, action === 'copy-edit-link' ? sharing.token : '');
      toast((await copyText(url)) ? 'Link copied.' : url);
      return;
    }
    case 'retry-save':
      sharing.dirty = true;
      sharing.conflict = false;
      void sharing.flush(state);
      return;
    case 'reload-shared': {
      const loaded = await sharing.load();
      if (loaded) {
        state = loaded;
        update({ recompute: true, persist: false });
      } else render();
      return;
    }

    // colleges
    case 'add-college':
      dialog(collegeDialog(ctx(), null), true);
      return;
    case 'edit-college':
      dialog(collegeDialog(ctx(), el.dataset.id), true);
      return;
    case 'delete-college': {
      const college = state.colleges.find((c) => c.id === el.dataset.id);
      if (college) dialog(deleteCollegeDialog(college));
      return;
    }
    case 'confirm-delete-college':
      state = { ...state, colleges: state.colleges.filter((c) => c.id !== el.dataset.id), demo: false };
      $('#editor').close();
      update();
      toast('College removed.');
      return;
    case 'college-staffing': {
      const d = staffingDialog(ctx(), el.dataset.id);
      if (d) dialog(d, true);
      return;
    }
    case 'load-starter': {
      const existing = new Set(state.colleges.map((c) => c.name.toLowerCase()));
      const additions = starterColleges().filter((c) => !existing.has(c.name.toLowerCase()));
      state = { ...state, demo: false, colleges: [...state.colleges.filter((c) => !c.name.endsWith('(demo)')), ...additions] };
      update();
      toast(`${additions.length} colleges added. Add dates to plan them.`);
      return;
    }
    case 'find-campus':
      void findCampus();
      return;
    case 'choose-campus':
      fillCampusPin(locationMatches[Number(el.dataset.index)]);
      return;
    case 'parse-campus-pin': {
      const pin = extractCoordinates($('#campus-pin-input').value);
      if (pin) fillCampusPin({ ...pin, source: 'Manual pin' });
      else $('#location-results').innerHTML = '<div class="dialog-error">Paste a latitude and longitude, or a link that contains a place pin. A map viewport is not a campus.</div>';
      return;
    }
    case 'college-station': {
      const college = state.colleges.find((c) => c.id === el.dataset.id);
      if (!college || !hasCampusPin(college)) return;
      el.disabled = true;
      try {
        await loadStations(college.location, true);
      } catch (error) {
        toast(error.message);
      } finally {
        if (el.isConnected) el.disabled = false;
      }
      return;
    }

    // teams
    case 'add-team':
      dialog(teamDialog(ctx(), null));
      return;
    case 'edit-team':
      dialog(teamDialog(ctx(), el.dataset.id));
      return;
    case 'delete-team': {
      if (state.teams.length === 1) {
        toast('Keep at least one travelling team.');
        return;
      }
      const id = el.dataset.id;
      state = {
        ...state,
        teams: state.teams.filter((t) => t.id !== id),
        colleges: state.colleges.map((c) => (c.team === id ? { ...c, team: 'auto' } : c))
      };
      $('#editor').close();
      update();
      toast('Team removed. Its visits are auto-assigned again.');
      return;
    }
    case 'compare-bases':
      dialog(compareDialog(ctx()), true);
      return;
    case 'select-base':
      state = { ...state, base: el.dataset.value };
      $('#editor').close();
      update();
      toast('Default base updated. Teams with their own base are unchanged.');
      return;

    // legs, settings, pins
    case 'edit-leg': {
      const d = legDialog(ctx(), Number(el.dataset.index));
      if (d) dialog(d, true);
      return;
    }
    case 'reset-leg': {
      const overrides = { ...state.overrides };
      delete overrides[el.dataset.key];
      state = { ...state, overrides };
      $('#editor').close();
      update();
      toast('Model estimates restored for that leg.');
      return;
    }
    case 'nearest-leg-stations': {
      const route = plan.routes.find((r) => r.id === selected);
      const leg = route?.legs.find((l) => l.key === $('#leg-form')?.dataset.key);
      if (leg) void fillLegStations(leg, true);
      return;
    }
    case 'refresh-roads':
      void refreshRoadMatrix(true);
      return;
    case 'airport-pins':
      dialog(airportPinsDialog(ctx()));
      return;
    case 'reset-airport-pin': {
      const pins = { ...(state.airportPins || {}) };
      delete pins[el.dataset.code];
      state = { ...state, airportPins: Object.keys(pins).length ? pins : undefined };
      $('#editor').close();
      update();
      return;
    }

    // exports and imports
    case 'export-menu':
      dialog(exportDialog());
      return;
    case 'export-json':
      exportJSON();
      return;
    case 'export-csv':
      exportCalendarCSV();
      return;
    case 'export-detail-csv':
      exportDetailCSV();
      return;
    case 'export-text':
      exportText();
      return;
    case 'print':
      $('#editor').close();
      window.print();
      return;
    case 'csv-template':
      download('campusroute-template.csv', CSV_TEMPLATE, 'text/csv');
      return;
    case 'import':
      $('#editor').close();
      $('#import-file').value = '';
      $('#import-file').click();
      return;
    case 'confirm-import':
      if (!pendingImport) return;
      state = pendingImport;
      pendingImport = null;
      $('#editor').close();
      tab = 'colleges';
      update();
      toast('Plan imported and routes recalculated.');
      return;
    default:
      return;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  const handlers = {
    'college-form': saveCollege,
    'team-form': saveTeam,
    'settings-form': saveSettings,
    'leg-form': saveLeg,
    'staffing-form': saveStaffing
  };
  if (form.id === 'airport-pin-form') {
    e.preventDefault();
    const code = form.elements.code.value;
    const p = { lat: Number(form.elements.lat.value), lng: Number(form.elements.lng.value) };
    if (!isCoordinate(p)) {
      $('#airport-error').textContent = 'Enter valid access coordinates.';
      return;
    }
    state = { ...state, airportPins: { ...state.airportPins, [code]: p } };
    $('#editor').close();
    update();
    toast('Airport access pin saved.');
    return;
  }
  const handler = handlers[form.id];
  if (!handler) return;
  e.preventDefault();
  handler(form);
});

// Inline date edits on the colleges tab, and the default-base picker.
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.collegeDate || t.dataset.collegeInterview) {
    const id = t.dataset.collegeDate || t.dataset.collegeInterview;
    const field = t.dataset.collegeDate ? 'date' : 'interviewDate';
    const colleges = state.colleges.map((c) => (c.id === id ? { ...c, [field]: t.value, demo: false } : c));
    const candidate = { ...state, colleges, demo: false };
    const errors = validateState(candidate);
    if (errors.length) {
      toast(errors[0]);
      render();
      return;
    }
    state = candidate;
    update();
    return;
  }
  if (t.id === 'default-base') {
    state = { ...state, base: t.value };
    update();
    toast('Default base updated.');
    return;
  }
  if (t.dataset.railStation) {
    const form = $('#leg-form');
    const route = plan.routes.find((r) => r.id === selected);
    const leg = route?.legs.find((l) => l.key === form?.dataset.key);
    if (!leg) return;
    const point = t.dataset.railStation === 'from' ? leg.fromPoint : leg.toPoint;
    const entry = state.stationLookups?.[pointKey(point)];
    const station = entry?.stations?.[Number(t.value)];
    if (station) form.elements[t.dataset.railStation === 'from' ? 'fromStation' : 'toStation'].value = station.name;
    return;
  }
  if (t.id === 'import-file' && t.files?.[0]) importFile(t.files[0]);
});

// The college search filters in place, without a full re-render.
document.addEventListener('input', (e) => {
  if (e.target.id !== 'college-search') return;
  collegeSearch = e.target.value;
  const q = collegeSearch.toLowerCase().trim();
  let count = 0;
  $$('[data-college-name]').forEach((row) => {
    row.hidden = !row.dataset.collegeName.includes(q);
    if (!row.hidden) count++;
  });
  $('#college-search-count').textContent = `${count} of ${state.colleges.length} shown`;
});

document.addEventListener('keydown', (e) => {
  const row = e.target.closest('[data-route]');
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    selected = row.dataset.route;
    tab = 'routes';
    detail = 'schedule';
    render();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (sharing.mode === 'shared-edit' && (sharing.dirty || sharing.busy)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// A read-only viewer follows the plan as the owner edits it.
setInterval(() => {
  if (sharing.mode !== 'shared-view' || document.hidden || $('#editor').open) return;
  void sharing.load().then((loaded) => {
    if (!loaded) return;
    state = loaded;
    plan = planRoutes(state);
    render();
  });
}, 30000);

// --- start -----------------------------------------------------------------

render();
sharing.open().then((loaded) => {
  if (loaded) {
    state = loaded;
    plan = planRoutes(state);
    tab = state.colleges.some((c) => c.date || c.interviewDate) ? 'routes' : 'colleges';
    selected = plan.routes[0]?.id;
  }
  render();
  void refreshRoadMatrix();
});
