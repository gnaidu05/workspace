// Build a single self-contained HTML file: the whole planner in one page, with
// no server, no modules and no network fetches on load. Useful for static
// hosting (GitHub Pages, an intranet share, a USB stick) where every plan then
// lives in the visitor's own browser storage.
//
// The modules are plain ES modules with named exports and no name collisions,
// so "bundling" is concatenation in dependency order with the import/export
// keywords removed.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');

// Dependency order, leaves first.
const MODULES = [
  'data/airports.js',
  'data/cities.js',
  'geography.js',
  'engine.js',
  'engine-ui.js',
  'railway.js',
  'data/sample.js',
  'roster.js',
  'ui-helpers.js',
  'views.js',
  'dialogs.js',
  'share.js',
  'app.js'
];

// One pass over the whole file: drop imports, turn re-exports into plain
// aliases, and strip the `export` keyword from declarations.
function flatten(source, file) {
  const body = source
    // import ... from '...';  (single or multi-line)
    .replace(/^[ \t]*import[\s\S]*?from\s*'[^']*';[ \t]*$/gm, '')
    .replace(/^[ \t]*import\s*'[^']*';[ \t]*$/gm, '')
    // export { a, b as c } from './x.js';  ->  const c = b;   (aliases only)
    .replace(/^[ \t]*export\s*\{([\s\S]*?)\}\s*from\s*'[^']*';[ \t]*$/gm, (_, names) => aliasConsts(names))
    // export { a, b };  (local names, already in scope)
    .replace(/^[ \t]*export\s*\{[\s\S]*?\}\s*;[ \t]*$/gm, '')
    // export const/function/class ...
    .replace(/^([ \t]*)export\s+(const|let|var|function|async function|class)\s/gm, '$1$2 ');
  return `// ---- ${file} ----\n` + body.replace(/\n{3,}/g, '\n\n').trim();
}

const aliasConsts = (names) =>
  names
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const alias = entry.match(/^(\w+)\s+as\s+(\w+)$/);
      return alias ? `const ${alias[2]} = ${alias[1]};` : '';
    })
    .filter(Boolean)
    .join('\n');

const build = async () => {
  const parts = [];
  for (const file of MODULES) {
    const source = await readFile(path.join(PUBLIC, file), 'utf8');
    parts.push(flatten(source, file));
  }

  const css = await readFile(path.join(PUBLIC, 'styles.css'), 'utf8');
  const favicon = await readFile(path.join(PUBLIC, 'favicon.svg'), 'utf8');
  const faviconUrl = 'data:image/svg+xml;base64,' + Buffer.from(favicon).toString('base64');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#174d45">
<meta name="description" content="A public, no-login planner for multi-stop college assessment travel — one self-contained file. Plans stay in this browser.">
<title>CampusRoute — assessment travel planner (single file)</title>
<link rel="icon" type="image/svg+xml" href="${faviconUrl}">
<style>
${css}
</style>
</head>
<body>
<div id="app"><main class="boot"><h1>Team travel planner</h1><p>Loading the planner…</p></main></div>
<div id="toast" role="status" aria-live="polite"></div>
<dialog id="editor"><div id="editor-content"></div></dialog>
<input type="file" id="import-file" accept="application/json,.json,text/csv,.csv" hidden>
<script>
"use strict";
// CampusRoute, built as one file. Source: campusroute/public/*.js
(function () {
${parts.join('\n\n')}
})();
</script>
</body>
</html>
`;

  const target = path.join(ROOT, 'docs', 'campusroute.html');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, target)} (${(html.length / 1024).toFixed(0)} KB)`);
};

await build();
