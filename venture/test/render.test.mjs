import { test } from 'node:test';
import assert from 'node:assert/strict';

import { invoice, statementOfWork } from '../kit/documents.mjs';
import { escapeHtml, renderInvoice, renderStatementOfWork } from '../kit/render.mjs';

const OPERATOR = { name: 'Operator', email: 'op@example.com' };
const CLIENT = { name: 'Acme Ltd', email: 'ap@acme.example' };

test('escaping: every character that could break out is replaced', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('Smith & Sons'), 'Smith &amp; Sons');
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(escapeHtml("O'Brien"), 'O&#39;Brien');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('escaping: ampersands are escaped before the entities they would corrupt', () => {
  // A naive replace order turns < into &lt; and then the & into &amp;lt;.
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('invoice HTML: a hostile client name cannot inject markup', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: { name: '<script>alert(1)</script>', email: 'x@y.example' },
    invoiceNumber: 'INV-<b>',
    issueDate: '2026-09-16',
    lineItems: [{ description: 'Build & "deploy"', unitPrice: 1500 }],
  });
  const html = renderInvoice(inv);

  assert.ok(!html.includes('<script>alert(1)</script>'), 'script tag survived');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Build &amp; &quot;deploy&quot;'));
  // The title carries the invoice number too, and must be escaped there as well.
  assert.ok(!/<title>[^<]*<b>/.test(html));
});

test('invoice HTML: the figures a client checks are all present', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-010',
    issueDate: '2026-09-16',
    dueInDays: 30,
    taxRate: 0.1,
    lineItems: [{ description: 'Care — September', unitPrice: 400 }],
  });
  const html = renderInvoice(inv);

  assert.ok(html.includes('INV-010'));
  assert.ok(html.includes('2026-10-16')); // due date
  assert.ok(html.includes('$400.00')); // subtotal
  assert.ok(html.includes('$40.00')); // tax
  assert.ok(html.includes('$440.00')); // total
  assert.ok(html.includes('Acme Ltd'));
});

test('invoice HTML: no tax row when there is no tax', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-011',
    issueDate: '2026-09-16',
    lineItems: [{ description: 'Audit', unitPrice: 250 }],
  });
  const html = renderInvoice(inv);
  assert.ok(!html.includes('Tax ('), 'a zero tax row should not be printed');
  assert.ok(html.includes('Subtotal'));
});

test('invoice HTML: states the export position for the remitting bank', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-012',
    issueDate: '2026-09-16',
    lineItems: [{ description: 'Build', unitPrice: 1500 }],
  });
  const html = renderInvoice(inv);
  assert.ok(html.includes('zero-rated'));
  assert.ok(html.includes('LUT'));
  assert.ok(html.includes('USD'));
});

test('SOW HTML: the cap and who carries the overrun risk are both stated', () => {
  const sow = statementOfWork({
    operator: OPERATOR,
    client: CLIENT,
    packageName: 'Build',
    price: 1500,
    startDate: '2026-09-21',
    estimatedHours: 20,
    hourCap: 30,
    deliverables: ['Replace the rota sheet'],
    overageRate: 90,
  });
  const html = renderStatementOfWork(sow);

  assert.ok(html.includes('20 hours'));
  assert.ok(html.includes('capped at 30'));
  assert.ok(html.includes("the supplier's, not yours"));
  assert.ok(html.includes('$90.00/hour'));
});

test('SOW HTML: with no overage rate, the work stops instead of billing on', () => {
  const sow = statementOfWork({
    operator: OPERATOR,
    client: CLIENT,
    packageName: 'Audit',
    price: 250,
    startDate: '2026-09-21',
    estimatedHours: 3,
    hourCap: 4,
    deliverables: ['Written assessment'],
  });
  const html = renderStatementOfWork(sow);
  assert.ok(html.includes('work stops'));
  assert.ok(!html.includes('/hour'));
});

test('SOW HTML: exclusions section appears only when there are exclusions', () => {
  const base = {
    operator: OPERATOR,
    client: CLIENT,
    packageName: 'Build',
    price: 1500,
    startDate: '2026-09-21',
    estimatedHours: 20,
    hourCap: 30,
    deliverables: ['A thing'],
  };
  const without = renderStatementOfWork(statementOfWork(base));
  assert.ok(!without.includes('What is not included'));

  const with_ = renderStatementOfWork(
    statementOfWork({ ...base, exclusions: ['Data migration'] }),
  );
  assert.ok(with_.includes('What is not included'));
  assert.ok(with_.includes('Data migration'));
});

test('SOW HTML: promises the handover that makes the client safe', () => {
  const sow = statementOfWork({
    operator: OPERATOR,
    client: CLIENT,
    packageName: 'Build',
    price: 1500,
    startDate: '2026-09-21',
    estimatedHours: 20,
    hourCap: 30,
    deliverables: ['A thing'],
  });
  const html = renderStatementOfWork(sow);
  assert.ok(html.includes('Full source code'));
  assert.ok(html.includes('No dependency on the supplier'));
});

test('both documents are complete, well-formed HTML pages', () => {
  const inv = renderInvoice(
    invoice({
      operator: OPERATOR,
      client: CLIENT,
      invoiceNumber: 'INV-013',
      issueDate: '2026-09-16',
      lineItems: [{ description: 'Build', unitPrice: 1500 }],
    }),
  );
  const sow = renderStatementOfWork(
    statementOfWork({
      operator: OPERATOR,
      client: CLIENT,
      packageName: 'Build',
      price: 1500,
      startDate: '2026-09-21',
      estimatedHours: 20,
      hourCap: 30,
      deliverables: ['A thing'],
    }),
  );
  for (const [name, html] of [['invoice', inv], ['sow', sow]]) {
    assert.ok(html.startsWith('<!doctype html>'), `${name} missing doctype`);
    assert.ok(html.trimEnd().endsWith('</html>'), `${name} not closed`);
    assert.ok(html.includes('<meta name="viewport"'), `${name} not mobile-ready`);
    assert.ok(html.includes('@media print'), `${name} not print-styled`);
  }
});
