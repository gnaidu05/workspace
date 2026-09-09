// Dialog bodies. Each returns { title, description, body } and app.js takes
// care of showing it and handling the form it contains.

import { AIRPORTS, collegeMemberAvailability, compareBases, formatHours, hasCampusPin, locationsOf, teamBase } from './engine-ui.js';
import { esc, icon, actButton, num, modeLabel, sourceLabel } from './ui-helpers.js';
import { mapLink } from './geography.js';
import { airBreakdown } from './views.js';

const airportOptions = (selected) =>
  Object.entries(AIRPORTS)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, a]) => `<option value="${code}" ${selected === code ? 'selected' : ''}>${esc(code)} · ${esc(a.city || a.name)}</option>`)
    .join('');

export function collegeDialog(ctx, id) {
  const { state } = ctx;
  const c = state.colleges.find((x) => x.id === id) || {
    id: '', name: '', city: state.base, date: '', time: '09:00', duration: 6, team: 'auto', airport: 'auto'
  };
  const cities = Object.keys(locationsOf(state)).sort();
  return {
    title: c.id ? 'Edit this college' : 'Add a college',
    description: 'Pin the actual campus so every journey is priced from the right place.',
    body: `<form id="college-form" data-id="${esc(c.id)}"><div class="dialog-body">
      <label class="field">College / campus name<input name="name" id="campus-name" value="${esc(c.name)}" maxlength="250" required autofocus></label>
      <label class="field">City reference<select name="city">
        <option value="">Not set · the campus pin decides travel</option>
        ${cities.map((n) => `<option ${n === c.city ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <small>Used when there is no confirmed pin, and to bias campus search.</small></label>

      <fieldset><legend>Campus location</legend>
        <div class="campus-pin-state" id="campus-pin-state">${pinState(c)}</div>
        <div class="search-row"><label class="field">Search OpenStreetMap for the campus
          <input id="campus-search" placeholder="College name and locality" value="${esc(c.name)}"></label>
          ${actButton('find-campus', 'Search', 'secondary small', 'search')}</div>
        <div id="location-results" class="location-results"></div>
        <label class="field">…or paste coordinates / a place-pin link
          <input id="campus-pin-input" placeholder="12.9716, 77.5946"></label>
        ${actButton('parse-campus-pin', 'Use these coordinates', 'secondary small', 'pin')}
        <label class="check-field"><input type="checkbox" name="confirmed" ${hasCampusPin(c) ? 'checked' : ''}>
          I have checked this is the campus we are visiting</label>
        <input type="hidden" name="lat" value="${c.location?.lat ?? ''}"><input type="hidden" name="lng" value="${c.location?.lng ?? ''}">
        <input type="hidden" name="address" value="${esc(c.location?.address || '')}"><input type="hidden" name="pinSource" value="${esc(c.location?.source || '')}">
      </fieldset>

      <fieldset><legend>Assessment</legend>
        <div class="field-row"><label class="field">Date<input name="date" type="date" value="${esc(c.date || '')}" min="2020-01-01" max="2040-12-31"></label>
          <label class="field">Start time (IST)<input name="time" type="time" value="${esc(c.time || '09:00')}"></label>
          <label class="field">Hours on site<input name="duration" type="number" min="0.5" max="12" step="0.5" value="${c.duration ?? 6}" required></label></div></fieldset>

      <fieldset><legend>Interview round · optional</legend>
        <div class="field-row"><label class="field">Date<input name="interviewDate" type="date" value="${esc(c.interviewDate || '')}" min="2020-01-01" max="2040-12-31"></label>
          <label class="field">Start time (IST)<input name="interviewTime" type="time" value="${esc(c.interviewTime || '09:00')}"></label>
          <label class="field">Hours on site<input name="interviewDuration" type="number" min="0.5" max="12" step="0.5" value="${c.interviewDuration ?? c.duration ?? 6}"></label></div></fieldset>

      <div class="field-row"><label class="field">Airport for air legs<select name="airport">
          <option value="auto" ${!c.airport || c.airport === 'auto' ? 'selected' : ''}>Nearest airport, automatically</option>
          <option value="none" ${c.airport === 'none' ? 'selected' : ''}>No air travel to this campus</option>
          ${airportOptions(c.airport)}</select></label>
        <label class="field">Fixed team<select name="team">
          <option value="auto" ${c.team === 'auto' ? 'selected' : ''}>Any available team</option>
          ${state.teams.map((t) => `<option value="${esc(t.id)}" ${c.team === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label></div>
      <div class="dialog-error" id="form-error"></div></div>
      <div class="dialog-footer">${actButton('close-dialog', 'Cancel', 'secondary')}<button class="btn primary" type="submit">${icon('check')} Save college</button></div></form>`
  };
}

function pinState(c) {
  if (hasCampusPin(c)) {
    return `<span class="tag good">Pin confirmed</span> <a href="${mapLink(c.location)}" target="_blank" rel="noopener noreferrer">
      ${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}</a> · ${esc(c.location.address || c.location.source || 'saved pin')}`;
  }
  if (c.location) return '<span class="tag warn">Pin found but not confirmed</span> travel still uses the city reference point.';
  return '<span class="tag warn">No pin yet</span> travel is priced from the city reference point.';
}

export function teamDialog(ctx, id) {
  const { state } = ctx;
  const t = state.teams.find((x) => x.id === id) || { id: '', name: '', size: 2, base: '', members: [] };
  const cities = Object.keys(locationsOf(state)).sort();
  const availability = t.memberAvailability || {};
  return {
    title: t.id ? 'Edit team' : 'Add a team',
    description: 'A team travels together, from its own base.',
    body: `<form id="team-form" data-id="${esc(t.id)}"><div class="dialog-body">
      <div class="field-row"><label class="field">Team name<input name="name" value="${esc(t.name)}" maxlength="60" required autofocus></label>
        <label class="field">People travelling<input name="size" type="number" min="1" max="500" step="1" value="${t.size}" required></label>
        <label class="field">Base<select name="base"><option value="">Use the plan default (${esc(state.base)})</option>
          ${cities.map((n) => `<option ${n === t.base ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
      <label class="field">Member names · one per line, optional
        <textarea name="members" rows="4" placeholder="A. Rao&#10;S. Menon">${esc((t.members || []).join('\n'))}</textarea>
        <small>Named people can be assigned to a college and are never double-booked. Unnamed places still count in person-hours.</small></label>
      ${(t.members || []).length
        ? `<fieldset><legend>Availability</legend><div class="availability-rows">${(t.members || [])
            .map((name) => {
              const rule = availability[name] || { available: true, unavailable: [] };
              const range = rule.unavailable?.[0] || { from: '', to: '' };
              return `<div class="availability-row"><strong>${esc(name)}</strong>
                <label class="check-field"><input type="checkbox" name="available" data-member="${esc(name)}" ${rule.available === false ? '' : 'checked'}> can travel</label>
                <label class="field">Unavailable from<input type="date" name="unavailableFrom" data-member="${esc(name)}" value="${esc(range.from)}"></label>
                <label class="field">to<input type="date" name="unavailableTo" data-member="${esc(name)}" value="${esc(range.to)}"></label></div>`;
            })
            .join('')}</div></fieldset>`
        : ''}
      <div class="dialog-error" id="form-error"></div></div>
      <div class="dialog-footer">${t.id && state.teams.length > 1 ? actButton('delete-team', 'Remove team', 'danger', 'trash', `data-id="${esc(t.id)}"`) : ''}
        ${actButton('close-dialog', 'Cancel', 'secondary')}<button class="btn primary" type="submit">${icon('check')} Save team</button></div></form>`
  };
}

export function legDialog(ctx, index) {
  const route = ctx.plan.routes.find((r) => r.id === ctx.selected);
  const leg = route?.legs[index];
  if (!leg) return null;
  const override = ctx.state.overrides[leg.key] || {};
  const rail = override.rail || { fromStation: '', toStation: '', hours: '', km: '', departureHours: '', departureKm: '', arrivalHours: '', arrivalKm: '', buffer: 0.75 };
  return {
    title: 'Adjust this leg',
    description: `${leg.from} → ${leg.to}`,
    body: `<form id="leg-form" data-key="${esc(leg.key)}"><div class="dialog-body">
      <div class="model-summary"><h4>What the model says</h4>
        <p><strong>Road</strong> ${formatHours(leg.road)} · ${num(leg.distance)} km · ${esc(sourceLabel(leg.roadSource))}</p>
        <p><strong>Air</strong> ${leg.air === null ? 'not available' : formatHours(leg.air) + ' · ' + airBreakdown(leg)}</p>
        <p><strong>Chosen</strong> ${esc(modeLabel(leg.mode))}${leg.custom ? ' · you have adjusted this leg' : ''}</p></div>
      <label class="field">Travel mode<select name="mode">
        ${[['auto', 'Let the planner choose'], ['road', 'Road'], ['air', 'Air'], ['train', 'Train']]
          .map(([v, l]) => `<option value="${v}" ${(override.mode || 'auto') === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
      <div class="field-row"><label class="field">Verified road hours<input name="road" type="number" min="0.05" max="100" step="0.05" value="${override.road ?? ''}" placeholder="${(leg.ground?.hours ?? 0).toFixed(2)}"></label>
        <label class="field">Verified road km<input name="distance" type="number" min="1" max="15000" step="1" value="${override.distance ?? ''}" placeholder="${Math.round(leg.distance || 0)}"></label>
        <label class="field">Verified air hours<input name="air" type="number" min="0.05" max="100" step="0.05" value="${override.air ?? ''}" placeholder="${leg.air ? leg.air.toFixed(2) : 'n/a'}"></label></div>
      <label class="check-field"><input type="checkbox" name="noAir" ${override.air === null ? 'checked' : ''}> No air option on this leg</label>

      <fieldset><legend>Train itinerary · all figures are yours</legend>
        <div class="search-row">${actButton('nearest-leg-stations', 'Find nearest stations for both ends', 'secondary small', 'train')}
          <span id="rail-station-status" class="muted-text"></span></div>
        <div id="rail-station-choices"></div>
        <div class="field-row"><label class="field">From station<input name="fromStation" value="${esc(rail.fromStation)}"></label>
          <label class="field">To station<input name="toStation" value="${esc(rail.toStation)}"></label></div>
        <div class="field-row"><label class="field">Train hours<input name="railHours" type="number" min="0.01" max="100" step="0.05" value="${rail.hours}"></label>
          <label class="field">Train km<input name="railKm" type="number" min="0.01" max="15000" step="1" value="${rail.km}"></label>
          <label class="field">Boarding buffer (h)<input name="railBuffer" type="number" min="0" max="12" step="0.25" value="${rail.buffer}"></label></div>
        <div class="field-row"><label class="field">To station: hours<input name="railDepartureHours" type="number" min="0" max="24" step="0.05" value="${rail.departureHours}"></label>
          <label class="field">To station: km<input name="railDepartureKm" type="number" min="0" max="2000" step="1" value="${rail.departureKm}"></label>
          <label class="field">From station: hours<input name="railArrivalHours" type="number" min="0" max="24" step="0.05" value="${rail.arrivalHours}"></label>
          <label class="field">From station: km<input name="railArrivalKm" type="number" min="0" max="2000" step="1" value="${rail.arrivalKm}"></label></div></fieldset>
      <div class="dialog-error" id="form-error"></div>
      <p class="form-note">Overrides are tied to these exact points. Move the pin or change the airport and the plan goes back to the model.</p></div>
      <div class="dialog-footer">${leg.custom ? actButton('reset-leg', 'Restore the model', 'danger', 'refresh', `data-key="${esc(leg.key)}"`) : ''}
        ${actButton('close-dialog', 'Cancel', 'secondary')}<button class="btn primary" type="submit">${icon('check')} Apply to this leg</button></div></form>`
  };
}

export function staffingDialog(ctx, id) {
  const { state } = ctx;
  const c = state.colleges.find((x) => x.id === id);
  if (!c) return null;
  const availability = collegeMemberAvailability(state, c);
  return {
    title: 'Who staffs this visit',
    description: esc(c.name),
    body: `<form id="staffing-form" data-id="${esc(id)}"><div class="dialog-body">
      <label class="field">People required per visit<input name="requiredPeople" type="number" min="1" max="500" step="1" required
        value="${c.requiredPeople ?? state.teams.find((t) => t.id === c.team)?.size ?? 2}"></label>
      <fieldset class="staffing-members"><legend>Name specific people · optional</legend>
        ${state.teams
          .map((t) => `<div class="staffing-team"><strong>${esc(t.name)} · ${esc(teamBase(t, state))}</strong>
            ${(t.members || []).length
              ? (t.members || [])
                  .map((n) => {
                    const a = availability.find((x) => x.name === n) || { available: true, reason: '' };
                    const chosen = (c.assignedMembers || []).includes(n);
                    return `<label class="check-field member-choice ${a.available ? '' : 'unavailable'}" title="${esc(a.reason)}">
                      <input type="checkbox" name="assignedMember" value="${esc(n)}" data-available="${a.available}" ${chosen ? 'checked' : ''}>
                      ${esc(n)} <small>${esc(a.reason)}</small></label>`;
                  })
                  .join('')
              : '<p class="muted-text">No member names on this team yet.</p>'}</div>`)
          .join('')}</fieldset>
      <div class="dialog-error" id="form-error"></div>
      <p class="form-note">People from different teams on one visit are planned as separate travelling parties, each with its own route.</p></div>
      <div class="dialog-footer">${actButton('close-dialog', 'Cancel', 'secondary')}<button class="btn primary" type="submit">${icon('check')} Save staffing</button></div></form>`
  };
}

export function compareDialog(ctx) {
  const rows = compareBases(ctx.state, Object.keys(locationsOf(ctx.state)).sort()).filter((r) => !r.errors?.length);
  const best = [...rows].sort((a, b) => (a.personHours ?? Infinity) - (b.personHours ?? Infinity))[0];
  return {
    title: 'Compare bases',
    description: 'The same visits and teams, re-planned from each candidate base.',
    body: `<div class="dialog-body"><table class="compare-table"><thead><tr><th>Base</th><th>Routes</th><th>Person-hours</th><th>Nights</th><th>Unplaced</th><th></th></tr></thead>
      <tbody>${rows
        .sort((a, b) => (a.personHours ?? Infinity) - (b.personHours ?? Infinity))
        .slice(0, 12)
        .map((r) => `<tr class="${r.base === ctx.state.base ? 'current' : ''}"><td><strong>${esc(r.base)}</strong>${r.base === ctx.state.base ? ' <small>current</small>' : ''}${
          r.base === best?.base ? ' <span class="tag good">best</span>' : ''}</td>
          <td>${r.routes}</td><td>${num(r.personHours)}</td><td>${r.personNights ?? 0}</td><td>${r.unplaced}</td>
          <td>${r.base === ctx.state.base ? '' : actButton('select-base', 'Use this base', 'secondary small', '', `data-value="${esc(r.base)}"`)}</td></tr>`)
        .join('')}</tbody></table>
      <p class="form-note">Only the plan-wide default base changes. Teams with their own base keep it.</p></div>
      <div class="dialog-footer">${actButton('close-dialog', 'Close', 'secondary')}</div>`
  };
}

export function airportPinsDialog(ctx) {
  const pins = ctx.state.airportPins || {};
  return {
    title: 'Airport access pins',
    description: 'Move an airport reference point to the terminal or gate a team actually uses.',
    body: `<form id="airport-pin-form"><div class="dialog-body">
      <label class="field">Airport<select name="code" id="airport-code">${airportOptions(Object.keys(pins)[0])}</select></label>
      <div class="field-row"><label class="field">Latitude<input name="lat" type="number" step="any" min="-90" max="90"></label>
        <label class="field">Longitude<input name="lng" type="number" step="any" min="-180" max="180"></label></div>
      <div class="dialog-error" id="airport-error"></div>
      ${Object.keys(pins).length
        ? `<div class="pin-list"><h4>Custom pins</h4>${Object.entries(pins)
            .map(([code, p]) => `<p>${esc(code)} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} ${actButton('reset-airport-pin', 'Reset', 'danger small', 'trash', `data-code="${esc(code)}"`)}</p>`)
            .join('')}</div>`
        : ''}
      <p class="form-note">Airport transfer times are measured to this point once a campus pin exists.</p></div>
      <div class="dialog-footer">${actButton('close-dialog', 'Cancel', 'secondary')}<button class="btn primary" type="submit">${icon('check')} Save pin</button></div></form>`
  };
}

export function exportDialog() {
  return {
    title: 'Keep a copy',
    description: 'Take the plan somewhere else, or hand it to the people travelling.',
    body: `<div class="dialog-body">
      ${actButton('export-json', 'Editable plan · JSON', 'primary', 'download')}
      ${actButton('export-csv', 'Person-day roster · CSV', 'secondary', 'calendar')}
      ${actButton('export-detail-csv', 'Activity-by-activity roster · CSV', 'secondary', 'calendar')}
      ${actButton('export-text', 'Plain-text brief', 'secondary', 'edit')}
      ${actButton('print', 'Print / save as PDF', 'secondary', 'print')}
      <div class="form-note">JSON keeps everything — colleges, teams, pins, overrides — so it can be re-imported and edited.
        The person-day CSV has one row per person and one column per date; the activity CSV has one row per journey and visit.</div></div>
      <div class="dialog-footer">${actButton('import', 'Import a plan instead', 'secondary', 'upload')}${actButton('csv-template', 'CSV template', 'secondary', 'download')}
        ${actButton('close-dialog', 'Close', 'secondary')}</div>`
  };
}

export function importPreviewDialog(next, plan) {
  return {
    title: 'Import this plan?',
    description: 'Your current plan stays untouched until you confirm.',
    body: `<div class="dialog-body"><p>${next.colleges.length} colleges · ${next.teams.length} teams ·
      ${next.colleges.filter((c) => c.date || c.interviewDate).length} dated visits · ${plan.routes.length} routes from the file.</p>
      ${plan.unplaced.length ? `<p class="dialog-error">${plan.unplaced.length} visit(s) would not be routable yet.</p>` : ''}
      </div><div class="dialog-footer">${actButton('close-dialog', 'Cancel', 'secondary')}${actButton('confirm-import', 'Replace my plan', 'primary', 'upload')}</div>`
  };
}

export function shareDialog(links, mode) {
  return {
    title: mode === 'forked' ? 'Your own copy is live' : 'Your plan is shared',
    description: 'Two links: one to read, one to edit. Anyone holding the edit link can change the plan.',
    body: `<div class="dialog-body">
      <label class="field">View link · safe to circulate<input value="${esc(links.viewUrl)}" readonly onclick="this.select()"></label>
      <label class="field">Edit link · keep it to the people who plan<input value="${esc(links.editUrl)}" readonly onclick="this.select()"></label>
      <div class="row-actions">${actButton('copy-view-link', 'Copy view link', 'primary small', 'link')}${actButton('copy-edit-link', 'Copy edit link', 'secondary small', 'link')}</div>
      <div class="form-note">There are no accounts here: the edit link <em>is</em> the credential. This browser also remembers it, so a plain
        view link opens as editable for you. Anyone you send the edit link to can edit too — send the view link unless you mean otherwise.</div></div>
      <div class="dialog-footer">${actButton('close-dialog', 'Done', 'secondary')}</div>`
  };
}

export function helpDialog(ctx) {
  const s = ctx.state.settings;
  return {
    title: 'How this planner thinks',
    description: 'Fixed dates, grouped travel, visible assumptions.',
    body: `<div class="dialog-body">
      <div><strong>1 · Visits are fixed points</strong><p class="muted-text">Every dated assessment or interview is a fixed appointment. The planner
        never moves one; it works out the travel around them.</p></div>
      <div><strong>2 · One trip per visit, then merge</strong><p class="muted-text">Each visit starts as its own base-and-back trip. Pairs of trips are
        then merged whenever the combination is feasible and saves more weighted cost than it adds. Current priority:
        <strong>${esc(s.priority)}</strong>.</p></div>
      <div><strong>3 · Travel has to fit the day</strong><p class="muted-text">Travel runs between ${s.dayStart}:00 and ${s.dayEnd}:00, at most
        ${s.maxTravel}h of travelling and ${s.maxDuty}h of duty a day, with ${s.rest}h of rest between days and ${formatHours(s.buffer)} of buffer
        either side of a visit. Road journeys can split across days; a flight or a train cannot. Nights away are counted wherever a route cannot
        get home, up to ${s.maxNights} per route.</p></div>
      <div><strong>4 · Teams and people</strong><p class="muted-text">Routes are handed to the smallest team that can take them, from its own base.
        Named people are never double-booked, and anyone marked unavailable is left out of overlapping travel.</p></div>
      <div><strong>5 · What "saved" means</strong><p class="muted-text">Grouped travel is compared against a separate base–college–base trip for every
        covered visit, with the same estimates and the same team size. Person-hours multiply by the people travelling.</p></div>
      <div><strong>6 · Limits worth repeating</strong><p class="muted-text">No fares, no live traffic, no flight or train availability, no bookings.
        Air legs assume a 650 km/h great-circle flight plus transfers and ${formatHours(s.airportBuffer)} of airport time. Train legs are entirely
        your own figures. Confirm everything before anyone travels.</p></div></div>
      <div class="dialog-footer">${actButton('close-dialog', 'Close', 'secondary')}</div>`
  };
}

export function deleteCollegeDialog(c) {
  return {
    title: 'Remove this college?',
    description: esc(c.name),
    body: `<div class="dialog-body"><p class="muted-text">Its visits are removed and the remaining routes are recalculated.</p></div>
      <div class="dialog-footer">${actButton('close-dialog', 'Keep it', 'secondary')}${actButton('confirm-delete-college', 'Remove', 'danger', 'trash', `data-id="${esc(c.id)}"`)}</div>`
  };
}
