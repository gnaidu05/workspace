#!/usr/bin/env node
// Turn one client JSON file into the paperwork.
//
//   node generate.mjs client.json [outDir]
//
// Writes a statement of work and/or an invoice as standalone HTML. Open either
// in a browser and "Save as PDF" to get the file you actually send.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

import { invoice, statementOfWork } from './documents.mjs';
import { renderInvoice, renderStatementOfWork } from './render.mjs';

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const [, , configPath, outDirArg] = process.argv;
if (!configPath) {
  console.error('usage: node generate.mjs <client.json> [outDir]');
  process.exit(2);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  fail(`could not read ${configPath}: ${err.message}`);
}

const { operator, client, engagement, invoice: invoiceSpec } = config;
if (!operator) fail('config needs an "operator" object');
if (!client) fail('config needs a "client" object');
if (!engagement && !invoiceSpec) fail('config needs "engagement", "invoice", or both');

const outDir = outDirArg || 'out';
mkdirSync(outDir, { recursive: true });

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';

const written = [];

if (engagement) {
  let sow;
  try {
    sow = statementOfWork({
      operator,
      client,
      packageName: engagement.package,
      price: engagement.price,
      startDate: engagement.startDate,
      estimatedHours: engagement.estimatedHours,
      hourCap: engagement.hourCap,
      deliverables: engagement.deliverables,
      exclusions: engagement.exclusions ?? [],
      overageRate: engagement.overageRate,
    });
  } catch (err) {
    fail(`engagement: ${err.message}`);
  }

  const file = join(outDir, `sow-${slug(client.name)}-${slug(engagement.package)}.html`);
  writeFileSync(file, renderStatementOfWork(sow));
  written.push([file, `${engagement.package} — capped at ${sow.hourCap}h`]);
}

if (invoiceSpec) {
  let inv;
  try {
    inv = invoice({
      operator,
      client,
      invoiceNumber: invoiceSpec.number,
      issueDate: invoiceSpec.issueDate,
      dueInDays: invoiceSpec.dueInDays ?? 14,
      taxRate: invoiceSpec.taxRate ?? 0,
      notes: invoiceSpec.notes ?? '',
      lineItems: invoiceSpec.lineItems,
    });
  } catch (err) {
    fail(`invoice: ${err.message}`);
  }

  const file = join(outDir, `invoice-${slug(inv.invoiceNumber)}.html`);
  writeFileSync(file, renderInvoice(inv));
  written.push([file, `due ${inv.dueDate}`]);
}

for (const [file, note] of written) {
  console.log(`  ${basename(file)}  (${note})`);
}
console.log(`\nWritten to ${outDir}/. Open in a browser and print to PDF.`);
