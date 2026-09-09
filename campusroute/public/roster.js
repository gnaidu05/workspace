// Exports and imports: per-person rosters out, JSON or CSV plans in.

import { dateText, timeText, dayOf, formatHours, locationsOf, teamBase } from './engine.js';

const iso = (hours) => new Date(hours * 3600000).toISOString().slice(0, 10);

// One row per person per activity: the operational detail sheet.
export function detailRosterRows(state, plan) {
  const header = [
    'Person', 'Team', 'Base', 'Date (IST)', 'Day', 'Route', 'Activity', 'From', 'To', 'College / campus',
    'Start time (IST)', 'End time (IST)', 'End date (IST)', 'Activity duration (hours)', 'Nights away', 'Status', 'Notes'
  ];
  const records = [];
  const used = new Set();

  for (const route of plan.routes) {
    const named = [...(route.memberNames || [])];
    const people = route.teamId
      ? [...named, ...Array.from({ length: Math.max(0, route.size - named.length) }, (_, i) => `Unnamed place ${i + 1} (${route.teamName})`)]
      : ['Unassigned traveller'];

    for (const person of people) {
      if (named.includes(person)) used.add(person);
      for (const e of [...route.events, ...route.overnights]) {
        const night = e.type === 'overnight';
        const travel = e.type === 'travel';
        const start = night ? e.day * 24 : e.start;
        const end = night ? (e.day + 1) * 24 : e.end;
        const activity = night
          ? 'Overnight stay'
          : travel
            ? { road: 'Road travel', air: 'Air travel', train: 'Train travel' }[e.leg.mode]
            : e.type === 'interview' ? 'Interview' : 'Assessment';
        const notes = travel
          ? `${formatHours(e.leg.hours)} total for this leg · ${e.leg.mode === 'road' ? Math.round(e.leg.distance || 0) + ' km' : e.leg.airports || 'itinerary entered manually'}`
          : night
            ? 'Assumed stay. Nothing is booked by this plan.'
            : `${e.college.name} · ${route.teamName}`;
        records.push({
          person,
          time: start,
          row: [
            person, route.teamName, route.base, iso(start), dateText(start, { weekday: 'long' }), route.number, activity,
            e.from || '', e.to || e.city || '', e.college?.name || '',
            night ? '' : timeText(e.start), night ? '' : timeText(e.end), night ? '' : iso(e.end),
            night ? '' : (e.end - e.start).toFixed(2), night ? 1 : 0,
            route.teamId ? 'Planned' : 'Needs a team', notes
          ]
        });
      }
    }
  }

  for (const team of state.teams) {
    for (const person of team.members || []) {
      if (used.has(person)) continue;
      records.push({
        person,
        time: Infinity,
        row: [person, team.name, teamBase(team, state), '', '', '', 'No assigned travel', '', '', '', '', '', '', '', 0,
          'No assigned travel', 'No feasible assigned journey in this plan']
      });
    }
  }

  for (const u of plan.unplaced) {
    const c = u.college;
    records.push({
      person: 'Unplaced visit',
      time: Infinity,
      row: ['Unplaced visit', '', '', c.date || '', '', '', c.visitType === 'interview' ? 'Interview' : 'Assessment',
        '', '', c.name, c.time || '', '', '', '', 0, 'Unplaced', u.reason]
    });
  }

  records.sort((a, b) => a.person.localeCompare(b.person) || a.time - b.time || String(a.row[5]).localeCompare(String(b.row[5])));
  return [header, ...records.map((r) => r.row)];
}

// One row per person, one column per calendar day: the sheet a team lead reads.
export function calendarRosterRows(state, plan) {
  const detail = detailRosterRows(state, plan).slice(1);
  const people = new Map();
  const days = [];
  const dayNumber = (isoDate) => Math.floor(Date.parse(isoDate + 'T00:00:00Z') / 86400000);

  const add = (name, location, team) => {
    const key = JSON.stringify([name, location, team]);
    if (!people.has(key)) people.set(key, { name, location, team, cells: new Map() });
    return people.get(key);
  };
  for (const team of state.teams) for (const name of team.members || []) add(name, teamBase(team, state), team.name);

  for (const row of detail) {
    const [name, team, location, date, , , activity, , , college, , endTime, endDate] = row;
    if (name === 'Unplaced visit') {
      if (date) days.push(dayNumber(date));
      continue;
    }
    const person = add(name, location, team);
    if (!date) continue;
    const start = dayNumber(date);
    let end = dayNumber(endDate || date);
    // Midnight is the exclusive end of the preceding day's activity.
    if (end > start && (endTime === '00:00' || activity === 'Overnight stay')) end--;
    const label =
      activity === 'Assessment' ? college
      : activity === 'Interview' ? `Interview: ${college}`
      : activity.includes('travel') ? 'Travel'
      : activity === 'Overnight stay' ? 'Overnight'
      : activity;
    for (let d = start; d <= end; d++) {
      days.push(d);
      if (!person.cells.has(d)) person.cells.set(d, new Set());
      person.cells.get(d).add(label);
    }
  }

  if (!days.length) {
    return [['Full name', 'Base', 'Team'], ...[...people.values()].map((p) => [p.name, p.location, p.team])];
  }
  const first = Math.min(...days);
  const last = Math.max(...days);
  const dates = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const header = ['Full name', 'Base', 'Team', ...dates.map((d) => new Date(d * 86400000).toISOString().slice(0, 10))];
  return [
    header,
    ...[...people.values()].map((p) => [p.name, p.location, p.team, ...dates.map((d) => [...(p.cells.get(d) || [])].join(' / ') || '-')])
  ];
}

// Quote every cell, and defuse anything a spreadsheet would treat as a formula.
export function csvCell(value) {
  let s = String(value ?? '');
  if (s !== '-' && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}

export const toCSV = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export const CSV_TEMPLATE =
  'college,city,date,start,duration,team,latitude,longitude,address,airport,interview_date,interview_start,interview_duration\r\n' +
  'Your college,Pune,2026-09-24,09:00,6,auto,,,,auto,,09:00,6\r\n';

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quote.');
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// Turn a CSV of colleges into a new plan, keeping the current teams, settings
// and custom cities. Coordinates in the file count as confirmed campus pins.
export function csvPlan(text, state) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one college.');
  const headers = rows.shift().map((x) => x.trim().toLowerCase());
  if (!['college', 'city', 'date'].every((h) => headers.includes(h))) {
    throw new Error('Required CSV headers: college, city, date. Use the downloadable template.');
  }
  const next = structuredClone(state);
  const cities = locationsOf(next);
  const aliases = { bengaluru: 'Bangalore', calicut: 'Kozhikode', trivandrum: 'Thiruvananthapuram', madras: 'Chennai', trichy: 'Tiruchirappalli' };

  next.colleges = rows.map((row, i) => {
    const data = Object.fromEntries(headers.map((h, j) => [h, (row[j] || '').trim()]));
    if (!data.college) throw new Error(`Row ${i + 2}: the college name is required.`);

    let city = aliases[data.city.toLowerCase()] || data.city;
    const matched = Object.keys(cities).find((c) => c.toLowerCase() === city.toLowerCase());
    if (city && !matched) throw new Error(`Row ${i + 2}: "${data.city}" is not a known city. Add coordinates, or use one of the reference cities.`);
    city = matched || '';

    const team = data.team && data.team.toLowerCase() !== 'auto'
      ? next.teams.find((t) => t.id === data.team || t.name.toLowerCase() === data.team.toLowerCase())
      : null;
    if (data.team && data.team.toLowerCase() !== 'auto' && !team) throw new Error(`Row ${i + 2}: no team called "${data.team}".`);

    const lat = Number(data.latitude);
    const lng = Number(data.longitude);
    const pinned = data.latitude !== '' && data.longitude !== '';
    if (pinned && !(Number.isFinite(lat) && Number.isFinite(lng))) throw new Error(`Row ${i + 2}: latitude and longitude must both be numbers.`);
    if (!pinned && !city) throw new Error(`Row ${i + 2}: give a known city or a latitude/longitude pin.`);

    const duration = data.duration ? Number(data.duration) : 6;
    if (!Number.isFinite(duration)) throw new Error(`Row ${i + 2}: duration must be a number of hours.`);

    return {
      id: 'csv-' + (i + 1),
      name: data.college,
      city,
      date: data.date || '',
      time: data.start || '09:00',
      duration,
      team: team?.id || 'auto',
      demo: false,
      airport: data.airport || 'auto',
      ...(pinned
        ? { location: { lat, lng, confirmed: true, address: data.address || '', source: 'Imported CSV pin' } }
        : {}),
      ...(data.interview_date
        ? {
            interviewDate: data.interview_date,
            interviewTime: data.interview_start || '09:00',
            interviewDuration: data.interview_duration ? Number(data.interview_duration) : duration
          }
        : {})
    };
  });
  next.demo = false;
  next.network = undefined;
  next.overrides = {};
  return next;
}

// A compact plain-text brief for pasting into a message or ticket.
export function planSummaryText(state, plan) {
  const lines = [`CampusRoute plan · base ${state.base} · all times IST`, ''];
  for (const route of plan.routes) {
    lines.push(`Route ${route.number} · ${route.teamName} (${route.size} people) · from ${route.base}`);
    lines.push(`  ${dateText(route.start)} ${timeText(route.start)} → ${dateText(route.end)} ${timeText(route.end)} · ${formatHours(route.hours)} travel · ${route.nights} nights away`);
    for (const e of [...route.events, ...route.overnights].sort((a, b) => a.start - b.start)) {
      const when = `${dateText(e.start)} ${e.type === 'overnight' ? '' : timeText(e.start) + '–' + timeText(e.end)}`.trim();
      const what =
        e.type === 'overnight' ? `Overnight in ${e.city}`
        : e.type === 'travel' ? `${e.from} → ${e.to} (${e.leg.mode})`
        : `${e.type === 'interview' ? 'Interview' : 'Assessment'}: ${e.college.name}`;
      lines.push(`    ${when} · ${what}`);
    }
    lines.push('');
  }
  for (const u of plan.unplaced) lines.push(`Unplaced: ${u.college.name} — ${u.reason}`);
  return lines.join('\n');
}

export const dayIndexOf = dayOf;
