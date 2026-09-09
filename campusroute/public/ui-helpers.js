// Rendering primitives shared by every view and dialog.

export const $ = (q) => document.querySelector(q);
export const $$ = (q) => [...document.querySelectorAll(q)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const num = (n) => (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });

export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const ROUTE_COLORS = ['#628764', '#8b79b3', '#5689ac', '#b68d57', '#9c6883', '#719e9c'];
export const routeColor = (route) => ROUTE_COLORS[(route.number - 1) % ROUTE_COLORS.length];

const icons = {
  train: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M9 3v8M15 3v8M8 18l-2 3M16 18l2 3"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
  college: '<path d="m3 8 9-5 9 5-9 5-9-5Z"/><path d="M6 10v7c4 3 8 3 12 0v-7M21 8v9"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v2"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="3" fill="currentColor" stroke="none"/>',
  link: '<path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 9M20 3v5h-5"/>',
  route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 7v7a5 5 0 0 0 5 5h7M10 5h5a4 4 0 0 1 0 8h-2"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  moon: '<path d="M20 13A8.5 8.5 0 0 1 11 3a9 9 0 1 0 9 10Z"/>',
  plane: '<path d="m21 3-6 18-4-8-8-4 18-6ZM11 13 21 3"/>',
  car: '<path d="m5 7 2-4h10l2 4 2 3v9h-3v-3H6v3H3v-9l2-3ZM5 7h14M3 11h18M6 13h2m8 0h2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M7 14h3m4 0h3m-10 3h3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m15 4 5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15v6Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M9 10v7m6-7v7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  chart: '<path d="M4 20h16M7 16v-4m5 4V5m5 11V9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/>',
  north: '<path d="m12 3 7 18-7-4-7 4 7-18Z"/>',
  print: '<path d="M6 9V3h12v6M6 18H3v-9h18v9h-3M6 15h12v6H6v-6ZM17 12h1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'
};

export const icon = (name, extra = '') =>
  `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.pin}</svg>`;

// Always type="button": these buttons live inside dialog forms, and a bare
// <button> inside a form submits it.
export const actButton = (action, label, style = 'secondary', iconName = '', extra = '') =>
  `<button type="button" class="btn ${style}" data-action="${action}" ${extra}>${iconName ? icon(iconName) : ''}${label}</button>`;

export const metric = (label, value, unit, foot, iconName, accent = false) =>
  `<div class="metric ${accent ? 'accent' : ''}"><div class="metric-label">${label}${icon(iconName)}</div>` +
  `<div class="metric-value">${value}<small>${unit}</small></div><div class="metric-foot">${foot}</div></div>`;

export const modeLabel = (mode) => ({ road: 'Road', air: 'Air', train: 'Train' }[mode] || mode);

export const sourceLabel = (source) =>
  ({
    'road-network': 'Measured road route',
    'coordinate-estimate': 'Straight-line estimate between pins',
    'city-estimate': 'City-to-city estimate',
    'campus-transfers': 'Measured airport transfers',
    manual: 'Your verified figure',
    unreachable: 'No road route found'
  }[source] || source);

export function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('visible'), 3700);
}

export function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
