// Every tab and panel. Views are pure: they take the render context and return
// HTML. All interaction happens through `data-action` / `data-tab` attributes
// that app.js dispatches.

import {
  AIRPORTS, dateText, timeText, dayOf, endpoint, formatHours, hasCampusPin, locationName, locationsOf,
  scheduledVisits, teamBase, validateCollegeAirport
} from './engine-ui.js';
import { esc, icon, actButton, metric, num, initials, routeColor, modeLabel, sourceLabel } from './ui-helpers.js';
import { mapLink, directionsLink, pointKey } from './geography.js';
import { validStationLookup } from './railway.js';

export const routeName = (route) =>
  route.stops.length === 1
    ? locationName(route.stops[0]) + ' visit'
    : locationName(route.stops[0]) + ' → ' + locationName(route.stops.at(-1));

// --- shared bits -----------------------------------------------------------

export function shareBar(ctx) {
  const { sharing } = ctx;
  const buttons = [];
  if (sharing.mode === 'local' && sharing.serverAvailable) {
    buttons.push(actButton('publish', 'Publish a shareable link', 'primary small', 'link'));
  }
  if (sharing.mode === 'shared-edit') {
    buttons.push(actButton('copy-view-link', 'Copy view link', 'secondary small', 'link'));
    buttons.push(actButton('copy-edit-link', 'Copy edit link', 'secondary small', 'link'));
    if (sharing.conflict || sharing.dirty) buttons.push(actButton('retry-save', 'Retry save', 'secondary small', 'refresh'));
    buttons.push(actButton('reload-shared', 'Reload', 'secondary small', 'refresh'));
  }
  if (sharing.mode === 'shared-view') {
    buttons.push(actButton('fork-plan', 'Make my own editable copy', 'primary small', 'plus'));
    buttons.push(actButton('reload-shared', 'Refresh', 'secondary small', 'refresh'));
  }
  return `<div class="notice share-bar"><span class="saved-label">${icon(sharing.mode === 'local' ? 'user' : 'globe')} ${esc(sharing.status)}</span>
    <span class="share-actions">${buttons.join('')}</span></div>`;
}

export function airBreakdown(leg) {
  return `${formatHours(leg.departure?.hours)} to ${esc(leg.airportA.code || 'the airport')} + ${formatHours(leg.flightHours)} in the air + ` +
    `${formatHours(leg.airportBuffer)} airport time + ${formatHours(leg.arrival?.hours)} from ${esc(leg.airportB.code || 'the airport')}`;
}

// --- route overview --------------------------------------------------------

export function routeCard(ctx, route) {
  const selected = route.id === ctx.selected;
  return `<div class="route-card ${selected ? 'selected' : ''}" style="--route:${routeColor(route)}" data-route="${route.id}" tabindex="0" role="button"
    aria-pressed="${selected}" aria-label="View route ${route.number}: ${esc(routeName(route))}">
    <div class="route-top"><span class="route-id">${String(route.number).padStart(2, '0')}</span><span class="route-title">${esc(routeName(route))}</span>
      <span class="tag ${route.teamId ? '' : 'warn'}">${route.stops.length} stop${route.stops.length === 1 ? '' : 's'}</span>
      ${selected ? `<span class="check-circle">${icon('check')}</span>` : ''}</div>
    <div class="route-path"><span class="base">${esc(route.base)}</span>${route.stops
      .map((c) => `<span class="path-arrow">→</span><span>${esc(locationName(c))}</span>`)
      .join('')}<span class="path-arrow">→</span><span class="base">${esc(route.base)}</span></div>
    <div class="route-meta"><span>${icon('clock')}${formatHours(route.hours)} travel</span><span>${icon('moon')}${route.nights} ${route.nights === 1 ? 'night' : 'nights'} away</span>
      <span>${icon(route.legs.some((l) => l.mode === 'train') ? 'train' : route.legs.some((l) => l.mode === 'air') ? 'plane' : 'car')}${
        [...new Set(route.legs.map((l) => modeLabel(l.mode)))].join(' + ')}</span></div>
    <div class="route-bottom"><span class="team-label"><span class="tiny-avatar">${route.teamId ? esc(initials(route.teamName)) : '!'}</span>${esc(route.teamName)} · ${route.size} people</span>
      <span class="route-date">${dateText(route.start)} – ${dateText(route.end)}</span></div></div>`;
}

export function routesView(ctx) {
  const { state, plan } = ctx;
  const route = plan.routes.find((r) => r.id === ctx.selected);
  if (!state.colleges.length) {
    return `<div class="panel empty">${icon('route')}<h3>Your next route starts here.</h3>
      Add colleges and visit dates, then let the planner group the stops.<br>${actButton('add-college', 'Add your first college', 'primary', 'plus')}</div>`;
  }
  if (!state.colleges.some((c) => c.date || c.interviewDate)) {
    return `<div class="panel empty"><h3>No dated visits yet.</h3>All ${state.colleges.length} colleges stay out of planning until you add dates in Colleges &amp; dates.
      <br>${actButton('go-colleges', 'Add dates', 'primary', 'calendar')}</div>`;
  }
  return `<div class="plan-workspace">
    <aside class="panel routes-panel"><div class="panel-head"><div><h2>Choose a route</h2><p>${plan.routes.length} route${plan.routes.length === 1 ? '' : 's'} · select one for its full itinerary.</p></div></div>
      ${plan.routes.map((r) => routeCard(ctx, r)).join('') || '<div class="empty">No feasible routes. Review the alerts above.</div>'}</aside>
    <div class="route-detail-column">${route ? routeDetail(ctx, route) : ''}</div></div>`;
}

function routeDetail(ctx, route) {
  const views = [['schedule', 'Day-by-day itinerary'], ['timeline', 'Timeline chart'], ['legs', 'Compare road / air / train']];
  return `<section class="panel timeline-panel"><div class="panel-head"><div><h2>Route ${route.number} · ${esc(route.teamName)}</h2>
      <p>${esc(route.base)} base · ${route.size} people · ${route.stops.length} visits · ${formatHours(route.hours)} travel · ${route.nights} nights away${
        route.memberNames?.length ? ' · ' + esc(route.memberNames.join(', ')) : ''}</p></div></div>
    <div class="view-toggle" aria-label="Route detail view">${views
      .map(([v, label]) => `<button class="${ctx.detail === v ? 'active' : ''}" data-detail="${v}">${label}</button>`)
      .join('')}</div>
    ${ctx.detail === 'timeline' ? ganttView(ctx, route) : ctx.detail === 'schedule' ? itineraryView(ctx, route) : legsView(ctx, route)}</section>
    <details class="panel supporting-map" open><summary>Route map &amp; campus stops</summary>${mapView(ctx, route)}
      <div class="map-legend"><span><i class="legend-line"></i>Road</span><span><i class="legend-line dashed"></i>Air</span><span><i class="legend-line train"></i>Train</span><span>Schematic — not a survey map</span></div>
      <ol class="map-stop-key">${route.stops
        .map((c, i) => `<li><span class="stop-number">${i + 1}</span><span><strong>${esc(c.name)}</strong><small>${esc(locationName(c))} · ${
          c.visitType === 'interview' ? 'Interview' : 'Assessment'}</small></span></li>`)
        .join('')}</ol></details>`;
}

// A deliberately schematic map: it shows the shape of a route, and says so.
export function mapView(ctx, route) {
  const { state } = ctx;
  const points = [endpointSafe(route?.base || state.base, state), ...(route?.stops || []).map((c) => endpointSafe(c, state))].filter(Boolean);
  if (!points.length) return '<div class="map-container empty">No mapped points yet.</div>';

  let minLat = Math.min(...points.map((p) => p.lat)) - 1.5;
  let maxLat = Math.max(...points.map((p) => p.lat)) + 1.5;
  let minLng = Math.min(...points.map((p) => p.lng)) - 2;
  let maxLng = Math.max(...points.map((p) => p.lng)) + 2;
  if (maxLat - minLat < 5) {
    const mid = (maxLat + minLat) / 2;
    minLat = mid - 2.5;
    maxLat = mid + 2.5;
  }
  if (maxLng - minLng < 6) {
    const mid = (maxLng + minLng) / 2;
    minLng = mid - 3;
    maxLng = mid + 3;
  }
  const W = 560;
  const H = 350;
  const scale = Math.min((W - 90) / (maxLng - minLng), (H - 55) / (maxLat - minLat));
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  const xy = (lng, lat) => [W / 2 + (lng - cx) * scale, H / 2 - (lat - cy) * scale];
  const path = (coords) => coords.map(([lng, lat], i) => (i ? 'L' : 'M') + xy(lng, lat).map((v) => v.toFixed(1)).join(',')).join(' ');
  // Illustrative coastline only — a context cue, not a boundary.
  const land = [[67, 25], [69, 23], [68.5, 22.4], [70, 20.8], [72.5, 21.5], [72.8, 19.1], [73.1, 17], [74.4, 14.5], [75.5, 12], [76.7, 9.4],
    [77.6, 8.1], [78.2, 9.2], [79.3, 10.3], [79.9, 12], [80.3, 13.3], [80.2, 15], [82.3, 17], [85.6, 19.6], [88, 21.5], [89.5, 24], [88, 29], [80, 34], [72, 34]];

  const links = (route?.legs || [])
    .filter((l) => pointKey(l.fromPoint) !== pointKey(l.toPoint))
    .map((l) => {
      const a = xy(l.fromPoint.lng, l.fromPoint.lat);
      const b = xy(l.toPoint.lng, l.toPoint.lat);
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const curve = l.mode === 'air' ? 0.13 : 0.03;
      const stroke = l.mode === 'train' ? '#bf8131' : l.mode === 'air' ? '#9583b8' : routeColor(route);
      const dash = l.mode === 'train' ? 'stroke-dasharray="9 3 2 3"' : l.mode === 'air' ? 'stroke-dasharray="5 5"' : '';
      return `<path d="M${a} Q${mx - dy * curve},${my + dx * curve} ${b}" fill="none" stroke="${stroke}" stroke-width="2" ${dash} opacity=".83">
        <title>${esc(l.from)} → ${esc(l.to)} · ${l.mode} · ${formatHours(l.hours)}</title></path>`;
    })
    .join('');

  const labels = points
    .map((p, i) => {
      const full = p.kind === 'campus' ? p.city || p.label : p.label;
      const name = full.length > 26 ? full.slice(0, 23) + '…' : full;
      const [x, y] = xy(p.lng, p.lat);
      const isBase = i === 0;
      const labelX = x > W - 150 ? -14 : 14;
      const anchor = x > W - 150 ? 'end' : 'start';
      return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><title>${esc(p.label)} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${isBase ? ' · base' : ''}</title>
        ${isBase ? '<circle r="14" fill="#fff" opacity=".85"/><circle r="10" fill="#215c4b"/>' : `<circle r="12" fill="#fff" opacity=".92"/><circle r="8.5" fill="${route ? routeColor(route) : '#628764'}"/>`}
        <text y="3" text-anchor="middle" font-size="8" font-weight="700" fill="white" style="stroke:none">${isBase ? 'B' : i}</text>
        <text x="${labelX}" y="4" text-anchor="${anchor}" font-size="10" font-weight="${isBase ? '700' : '550'}" fill="#526f62">${esc(name)}</text></g>`;
    })
    .join('');

  return `<div class="map-container"><svg class="map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic map of the selected route">
    <defs><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#cbdbd9" opacity=".45"/></pattern>
    <clipPath id="mapclip"><rect width="${W}" height="${H}"/></clipPath></defs>
    <rect width="${W}" height="${H}" fill="#edf3f4"/><g clip-path="url(#mapclip)">
    <path d="${path(land)}Z" fill="#f2f4ed" stroke="#d4ded4" stroke-width="1.2"/>
    <rect width="${W}" height="${H}" fill="url(#dots)"/>${links}${labels}</g></svg>
    <div class="map-north">N${icon('north')}</div>
    <div class="map-label">${route ? `ROUTE ${String(route.number).padStart(2, '0')} · ${route.stops.length} STOPS` : 'BASE LOCATION'}</div></div>`;
}

function endpointSafe(value, state) {
  try {
    return endpoint(value, state);
  } catch {
    return null;
  }
}

export function ganttView(ctx, route) {
  const first = dayOf(route.start);
  const last = dayOf(route.end);
  const days = last - first + 1;
  const span = days * 24;
  const origin = first * 24;

  const row = (name, events, index) => `<div class="gantt-row"><div class="gantt-label" style="--route:${routeColor(route)}"><i class="dot"></i>${name}</div>
    <div class="gantt-track">${events
      .map((e) => {
        const left = ((e.start - origin) / span) * 100;
        const width = Math.max(((e.end - e.start) / span) * 100, e.type === 'overnight' ? 0.8 : 0);
        const title = e.college
          ? (e.college.visitType === 'interview' ? 'Interview: ' : 'Assessment: ') + e.college.name
          : e.type === 'overnight' ? `Overnight: ${e.city}` : `${e.leg.from} → ${e.leg.to} · ${e.leg.mode}`;
        const when = `${dateText(e.start)} ${timeText(e.start)}${e.type !== 'overnight' ? '–' + timeText(e.end) + ' · ' + formatHours(e.end - e.start) : ''}`;
        return `<div class="gantt-bar ${e.type} ${e.leg?.mode || ''}" style="left:${left}%;width:${width}%" title="${esc(title)} · ${esc(when)}">${e.college ? index : ''}</div>`;
      })
      .join('')}</div></div>`;

  return `<div class="timeline-wrap"><div class="gantt" style="--days:${days}"><div class="gantt-header"><span>ACTIVITY / CAMPUS</span>
    <div class="gantt-days">${Array.from({ length: days }, (_, i) => {
      const h = (first + i) * 24;
      const weekday = new Date(h * 3600000).getUTCDay();
      return `<span class="${weekday === 0 || weekday === 6 ? 'weekend' : ''}">${dateText(h)}</span>`;
    }).join('')}</div></div>
    ${row('Travel &amp; transfers', route.events.filter((e) => e.type === 'travel'))}
    ${route.stops
      .map((c, i) => row(esc((c.visitType === 'interview' ? 'Interview · ' : 'Assessment · ') + (hasCampusPin(c) ? c.name : locationName(c))),
        route.events.filter((e) => e.college?.id === c.id), i + 1))
      .join('')}
    ${row('Overnight stays', route.overnights)}</div></div>
    <div class="timeline-legend"><span><i class="square"></i>Assessment</span><span><i class="square interview"></i>Interview</span>
    <span><i class="square road"></i>Road</span><span><i class="square air"></i>Air</span><span><i class="square train"></i>Train</span>
    <span><i class="square night"></i>Overnight</span>
    <button class="text-button" data-detail="schedule">Full itinerary ${icon('arrow')}</button></div>`;
}

export function itineraryView(ctx, route) {
  const { state } = ctx;
  const events = [
    ...route.events,
    ...route.overnights.map((n) => ({ ...n, start: n.day * 24 + 23.99, end: (n.day + 1) * 24 + state.settings.dayStart }))
  ].sort((a, b) => a.start - b.start);

  const groups = new Map();
  for (const e of events) {
    const d = dayOf(e.start);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(e);
  }

  const rows = [...groups]
    .map(([day, items], dayIndex) => `<section class="itinerary-day"><h3>Day ${dayIndex + 1} <span>${dateText(day * 24, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })}</span></h3><ol class="journey-steps">${items
      .map((e) => {
        const travel = e.type === 'travel';
        const night = e.type === 'overnight';
        const leg = e.leg;
        const title = travel
          ? `${esc(e.from)} → ${esc(e.to)}`
          : night
            ? e.city === 'En route' ? 'Overnight en route · location to confirm' : 'Stay overnight in ' + esc(e.city)
            : esc(e.college.name);
        const label = travel
          ? (e === route.events.at(-1) ? 'Return to base · ' : 'Travel · ') + modeLabel(leg.mode)
          : night ? 'Overnight stay' : e.college.visitType === 'interview' ? 'Interview' : 'Assessment';
        const info = travel
          ? leg.mode === 'train'
            ? `${esc(leg.rail.fromStation)} → ${esc(leg.rail.toStation)} · ${formatHours(leg.rail.departureHours)} to the station + ${formatHours(leg.rail.hours)} by train + ${formatHours(leg.rail.arrivalHours)} onward + ${formatHours(leg.rail.buffer)} boarding buffer. Confirm the timetable.`
            : leg.mode === 'air'
              ? airBreakdown(leg) + '. Flight schedule still to confirm.'
              : `${sourceLabel(leg.roadSource)} · ${e.from === 'En route' || e.to === 'En route' ? 'part of a multi-day road journey' : num(leg.distance) + ' km'}`
          : night
            ? `Assumed stay for ${route.size} people. Nothing is booked by this plan.`
            : `${esc(locationName(e.college))} · ${esc(route.teamName)}`;
        return `<li class="journey-step ${e.type}"><div class="step-time">${night ? 'Overnight' : timeText(e.start) + '–' + timeText(e.end)}</div>
          <div class="step-body"><span class="step-label">${label}</span><strong>${title}</strong><small>${info}</small></div>
          <div class="step-side">${night ? icon('moon') : travel ? icon(leg.mode === 'air' ? 'plane' : leg.mode === 'train' ? 'train' : 'car') : icon('college')}
          <span>${night ? '' : formatHours(e.end - e.start)}</span></div></li>`;
      })
      .join('')}</ol></section>`)
    .join('');

  const dutyByDay = [...groups].map(([day, items]) => {
    const travel = items.filter((e) => e.type === 'travel').reduce((n, e) => n + (e.end - e.start), 0);
    const duty = items.filter((e) => e.type !== 'overnight').reduce((n, e) => n + (e.end - e.start), 0);
    return { day, travel, duty };
  });

  return `<div class="itinerary">${rows}</div>
    <div class="duty-table"><h4>Daily load against your limits</h4><table><thead><tr><th>Day</th><th>Travelling</th><th>On duty</th></tr></thead><tbody>
    ${dutyByDay.map((d) => `<tr><td>${dateText(d.day * 24, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
      <td class="${d.travel > state.settings.maxTravel + 1e-6 ? 'over' : ''}">${formatHours(d.travel)} / ${state.settings.maxTravel}h</td>
      <td class="${d.duty > state.settings.maxDuty + 1e-6 ? 'over' : ''}">${formatHours(d.duty)} / ${state.settings.maxDuty}h</td></tr>`).join('')}
    </tbody></table></div>`;
}

export function legsView(ctx, route) {
  return `<div class="legs"><table class="leg-table"><thead><tr><th>Leg</th><th>Road</th><th>Air</th><th>Train</th><th>Chosen</th><th></th></tr></thead><tbody>
    ${route.legs
      .map((l, i) => {
        const cell = (value, source, extra = '') =>
          value === null || value === undefined
            ? '<td class="unavailable">—</td>'
            : `<td><strong>${formatHours(value)}</strong><small>${esc(source)}${extra}</small></td>`;
        return `<tr class="${l.custom ? 'custom' : ''}">
          <td><strong>${esc(l.from)} → ${esc(l.to)}</strong><small>${l.airports ? esc(l.airports) + ' · ' : ''}${num(l.distance)} km by road${
            l.precise ? '' : ' · city-level estimate'}</small></td>
          ${cell(l.road, sourceLabel(l.roadSource))}
          ${cell(l.air, sourceLabel(l.airSource), l.air !== null && l.flightHours ? ` · ${formatHours(l.flightHours)} airborne` : '')}
          ${l.train === null ? '<td class="unavailable">—</td>' : cell(l.train, 'Your train itinerary')}
          <td><span class="mode-pill ${l.mode}">${icon(l.mode === 'air' ? 'plane' : l.mode === 'train' ? 'train' : 'car')}${modeLabel(l.mode)}</span>
            ${l.custom ? '<small>manual preference</small>' : '<small>model choice</small>'}</td>
          <td class="row-actions">${actButton('edit-leg', 'Adjust', 'secondary small', 'edit', `data-index="${i}"`)}
            <a class="text-button" href="${directionsLink(l.fromPoint, l.toPoint)}" target="_blank" rel="noopener noreferrer">Directions</a></td></tr>`;
      })
      .join('')}</tbody></table>
    <p class="form-note">Air times combine measured or estimated airport transfers, ${formatHours(ctx.state.settings.airportBuffer)} of airport time and
      a great-circle flight at 650 km/h. They are planning figures, never a bookable schedule. Enter a verified duration on any leg to override the model.</p></div>`;
}

// --- colleges --------------------------------------------------------------

export function collegesView(ctx) {
  const { state, plan } = ctx;
  const query = ctx.collegeSearch.toLowerCase().trim();
  const matches = (c) => [c.name, c.city, c.location?.address].filter(Boolean).join(' ').toLowerCase().includes(query);
  const visible = state.colleges.filter(matches);
  const airportReviews = state.colleges.filter((c) => validateCollegeAirport(c)?.matched === false).length;

  return `<div class="panel college-panel"><div class="panel-head"><div><h2>Colleges &amp; visit dates</h2>
      <p>${state.colleges.length} colleges · ${state.colleges.filter((c) => c.date || c.interviewDate).length} with dates ·
      ${state.colleges.filter(hasCampusPin).length} with a confirmed campus pin${airportReviews ? ` · ${airportReviews} airport references need review` : ''}</p></div>
      <div class="head-actions">${actButton('load-starter', 'Load starter list', 'secondary small', 'download')}${actButton('add-college', 'Add college', 'primary small', 'plus')}</div></div>
    <div class="college-search"><label class="field">Search college, city or address
      <input id="college-search" type="search" value="${esc(ctx.collegeSearch)}" placeholder="College, city or address" autocomplete="off"></label>
      <span id="college-search-count" aria-live="polite">${visible.length} of ${state.colleges.length} shown</span></div>
    <div class="campus-list">${visible.map((c) => collegeRow(ctx, c)).join('') || '<div class="empty">Nothing matches that search.</div>'}</div>
    <p class="form-note">A visit is only planned once it has a date. Undated colleges stay in this list so you can schedule them later.
      ${plan.unplaced.length ? `${plan.unplaced.length} dated visit(s) cannot be routed yet — see the alert above.` : ''}</p></div>`;
}

function collegeRow(ctx, c) {
  const { state, plan } = ctx;
  const pinned = hasCampusPin(c);
  const airport = validateCollegeAirport(c);
  const visits = scheduledVisits(state).filter((v) => v.sourceCollegeId === c.id);
  const routes = plan.routes.filter((r) => r.stops.some((s) => s.sourceCollegeId === c.id));
  const unplaced = plan.unplaced.filter((u) => u.college.sourceCollegeId === c.id);
  const stations = state.stationLookups?.[c.location ? pointKey(c.location) : ''];

  return `<article class="campus-card" data-college-name="${esc([c.name, c.city, c.location?.address].filter(Boolean).join(' ').toLowerCase())}">
    <div class="campus-head"><div><h3>${esc(c.name)}</h3>
      <p>${esc(locationName(c))}${c.location?.address ? ' · ' + esc(c.location.address) : ''}</p></div>
      <div class="row-actions">${actButton('college-staffing', 'Staffing', 'secondary small', 'users', `data-id="${esc(c.id)}"`)}
        ${actButton('edit-college', 'Edit', 'secondary small', 'edit', `data-id="${esc(c.id)}"`)}
        ${actButton('delete-college', 'Remove', 'danger small', 'trash', `data-id="${esc(c.id)}"`)}</div></div>
    <div class="campus-tags">
      <span class="tag ${pinned ? 'good' : 'warn'}">${pinned ? 'Campus pin confirmed' : 'City-level location'}</span>
      ${c.requiredPeople ? `<span class="tag muted">${c.requiredPeople} people needed</span>` : ''}
      ${(c.assignedMembers || []).length ? `<span class="tag muted">${esc(c.assignedMembers.join(', '))}</span>` : ''}
      ${c.team !== 'auto' ? `<span class="tag muted">Fixed: ${esc(state.teams.find((t) => t.id === c.team)?.name || c.team)}</span>` : ''}
      ${routes.map((r) => `<button class="tag route-tag" data-route="${r.id}">Route ${r.number}</button>`).join('')}
      ${unplaced.map((u) => `<span class="tag bad" title="${esc(u.reason)}">Unplaced</span>`).join('')}</div>
    <div class="campus-dates">
      <label>Assessment date<input type="date" data-college-date="${esc(c.id)}" value="${esc(c.date || '')}" min="2020-01-01" max="2040-12-31">
        <small>${c.date ? esc(c.time) + ' · ' + formatHours(c.duration) : 'Not scheduled'}</small></label>
      <label>Interview date<input type="date" data-college-interview="${esc(c.id)}" value="${esc(c.interviewDate || '')}" min="2020-01-01" max="2040-12-31">
        <small>${c.interviewDate ? esc(c.interviewTime || '09:00') + ' · ' + formatHours(c.interviewDuration ?? c.duration) : 'Not scheduled'}</small></label></div>
    <div class="campus-transport">
      <small class="transport-line"><strong>Location:</strong> ${pinned
        ? `<a href="${mapLink(c.location)}" target="_blank" rel="noopener noreferrer">${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}</a> · ${esc(c.location.source || 'confirmed pin')}`
        : 'No confirmed pin · travel is priced from the city reference point'}</small>
      <small class="transport-line"><strong>Airport:</strong> ${airport
        ? airport.matched ? `${esc(airport.code)} · ${esc(airport.name)}` : `${esc(airport.name)} · not in the reference list`
        : c.airport && c.airport !== 'auto' ? esc(c.airport) + (AIRPORTS[c.airport] ? ' · ' + esc(AIRPORTS[c.airport].name) : '') : 'Nearest airport, chosen automatically'}</small>
      <small class="transport-line" data-station-summary="${c.location ? esc(pointKey(c.location)) : ''}">${
        pinned
          ? validStationLookup(stations, c.location)
            ? `<strong>Railway:</strong> <a href="${mapLink(stations.stations[0])}" target="_blank" rel="noopener noreferrer">${esc(stations.stations[0].name)}</a> · ${num(stations.stations[0].distance)} km`
            : `<strong>Railway:</strong> not looked up yet ${actButton('college-station', 'Find nearest station', 'secondary small', 'train', `data-id="${esc(c.id)}"`)}`
          : '<strong>Railway:</strong> confirm a campus pin to look up stations'}</small>
      ${visits.length ? `<small class="transport-line"><strong>Visits:</strong> ${visits.map((v) => esc((v.visitType === 'interview' ? 'Interview ' : 'Assessment ') + v.date)).join(' · ')}</small>` : ''}</div></article>`;
}

// --- teams and people -----------------------------------------------------

export function teamsView(ctx) {
  const { state, plan } = ctx;
  return `<div class="panel"><div class="panel-head"><div><h2>Your travelling teams</h2>
      <p>Each team has its own base. Routes always start and end at that base.</p></div>
      <div class="head-actions">${actButton('compare-bases', 'Compare bases', 'secondary small', 'chart')}${actButton('add-team', 'Add team', 'primary small', 'plus')}</div></div>
    <div class="team-grid">${state.teams
      .map((t) => {
        const tours = plan.routes.filter((r) => r.teamId === t.id);
        return `<div class="team-card"><div class="team-card-top"><div class="avatar">${esc(initials(t.name))}</div>
          <span class="tag ${tours.length ? 'good' : 'muted'}">${tours.length ? 'Assigned' : 'Available'}</span></div>
          <h3>${esc(t.name)}</h3><p>${t.size} people · based in ${esc(teamBase(t, state))}</p>
          <p>${tours.length} tour${tours.length === 1 ? '' : 's'} · ${num(tours.reduce((n, r) => n + r.personHours, 0))} person-hours</p>
          <p class="team-members">${(t.members || []).length ? esc(t.members.join(', ')) : 'No member names yet'}</p>
          <div class="row-actions">${actButton('edit-team', 'Edit team', 'secondary small', 'edit', `data-id="${esc(t.id)}"`)}
            ${state.teams.length > 1 ? actButton('delete-team', 'Remove', 'danger small', 'trash', `data-id="${esc(t.id)}"`) : ''}</div></div>`;
      })
      .join('')}</div>
    <div class="panel-footer"><span>Default base for teams without their own: <strong>${esc(state.base)}</strong></span>
      <span class="base-picker"><label class="field">Change default base<select id="default-base">${Object.keys(locationsOf(state))
        .sort()
        .map((n) => `<option ${n === state.base ? 'selected' : ''}>${esc(n)}</option>`)
        .join('')}</select></label></span></div></div>`;
}

export function peopleView(ctx) {
  const { state, plan } = ctx;
  const people = state.teams.flatMap((t) =>
    (t.members || []).map((name) => ({
      name,
      team: t,
      routes: plan.routes.filter((r) => r.teamId === t.id && r.memberNames?.includes(name)).sort((a, b) => a.start - b.start)
    }))
  );
  const unnamed = state.teams.reduce((n, t) => n + Math.max(0, t.size - (t.members || []).length), 0);

  return `<section class="panel individual-travel"><div class="panel-head"><div><h2>Individual planned travel</h2>
      <p>Who is away, when, and for how long. These are planned totals for the current plan, not a record of completed travel.</p></div>
      ${actButton('export-csv', 'Export person-day roster', 'secondary small', 'calendar')}</div>
    ${people.length
      ? `<div class="person-list">${people
          .map((p) => `<article class="person-row"><div><h3>${esc(p.name)}</h3><p>${esc(p.team.name)} · ${esc(teamBase(p.team, state))} base</p>
            <div class="person-totals"><strong>${p.routes.length} route${p.routes.length === 1 ? '' : 's'}</strong>
              <span>${formatHours(p.routes.reduce((n, r) => n + r.hours, 0))} travel</span>
              <span>${p.routes.reduce((n, r) => n + r.nights, 0)} nights away</span></div></div>
            <div class="person-routes">${p.routes.length
              ? p.routes
                  .map((r) => `<button class="person-route" data-route="${esc(r.id)}"><strong>Route ${r.number} · ${esc(routeName(r))}</strong>
                    <span>${dateText(r.start)} ${timeText(r.start)} – ${dateText(r.end)} ${timeText(r.end)} IST</span>
                    <span>${formatHours(r.hours)} travel · ${r.nights} nights</span></button>`)
                  .join('')
              : '<p class="muted-text">No assigned travel in this plan.</p>'}</div></article>`)
          .join('')}</div>`
      : '<div class="empty">Add member names to a team to see individual travel.</div>'}
    ${unnamed ? `<p class="form-note">${unnamed} unnamed place${unnamed === 1 ? '' : 's'} across your teams are counted in person-hours but cannot be listed by name.</p>` : ''}</section>`;
}

// --- assumptions ----------------------------------------------------------

export const SETTING_FIELDS = [
  ['roadSpeed', 'Average road speed', 'km/h, used when no measured route exists', 20, 100, 5],
  ['roadFactor', 'Road distance multiplier', '× straight-line distance', 1, 2, 0.05],
  ['airportBuffer', 'Airport time', 'hours across both airports', 0, 6, 0.25],
  ['buffer', 'Transfer buffer', 'hours before and after each visit', 0, 3, 0.25],
  ['dayStart', 'Earliest daily start', 'hour, IST', 0, 12, 1],
  ['dayEnd', 'Latest daily finish', 'hour, IST', 12, 24, 1],
  ['maxTravel', 'Most travel in one day', 'hours', 1, 24, 0.5],
  ['maxDuty', 'Most duty in one day', 'hours of travel plus visits', 1, 24, 0.5],
  ['rest', 'Overnight rest', 'hours between days', 0, 14, 0.5],
  ['maxNights', 'Most nights away per route', 'nights', 0, 30, 1]
];

export function settingsView(ctx) {
  const { state } = ctx;
  return `<div class="panel"><div class="panel-head"><div><h2>Practical boundaries, better plans</h2>
      <p>These assumptions decide what counts as feasible and drive every travel estimate.</p></div>
      ${actButton('airport-pins', 'Airport access pins', 'secondary small', 'pin')}</div>
    <form id="settings-form"><div class="settings-grid">${SETTING_FIELDS.map(([key, label, unit, min, max, step]) =>
      `<label class="field">${label}<input name="${key}" type="number" value="${state.settings[key]}" min="${min}" max="${max}" step="${step}" required><small>${unit}</small></label>`
    ).join('')}
      <label class="field">Routing priority<select name="priority">
        ${[['balanced', 'Balanced'], ['teams', 'Fewer teams and tours'], ['time', 'Least travel time']]
          .map(([v, l]) => `<option value="${v}" ${state.settings.priority === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select><small>how merging trades travel against tours</small></label></div>
      <div class="panel-footer"><span>Road matrix: ${state.network
        ? `${state.network.pointKeys.length} points measured ${new Date(state.network.updatedAt).toISOString().slice(0, 10)} · ${esc(state.network.source)}`
        : 'not measured yet — estimates come from coordinates'}</span>
        <span class="row-actions">${actButton('refresh-roads', 'Refresh road matrix', 'secondary small', 'refresh')}
        <button class="btn primary small" type="submit">${icon('check')} Apply assumptions</button></span></div></form>
    <div class="assumptions-copy">
      <div><h3>How an estimate is built</h3><p>With a confirmed campus pin, road legs use a measured OSRM driving time and distance, plus a
        15-minute break every 200&nbsp;km. Without a pin, they use straight-line distance × the multiplier ÷ your average speed. Air legs add
        transfers at both ends, your airport time and a great-circle flight at 650&nbsp;km/h. Train legs are always figures you enter.</p></div>
      <div><h3>What is never claimed</h3><p>No fares, no live traffic, no flight or train availability, and no booking. Overnight stays are
        assumed where a route cannot get home, not reserved. Treat every number as a planning estimate to confirm before anyone travels.</p></div>
      <div><h3>Where the data comes from</h3><p>Place search and campus pins come from Photon and OpenStreetMap; road times from OSRM; railway
        stations from Overpass. Airport coordinates are reference points, not terminal entrances.</p></div></div></div>`;
}
