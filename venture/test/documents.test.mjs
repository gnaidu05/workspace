import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDate,
  addDays,
  toCents,
  formatCents,
  invoice,
  statementOfWork,
} from '../kit/documents.mjs';

const OPERATOR = { name: 'Operator', email: 'op@example.com' };
const CLIENT = { name: 'Acme Ltd', email: 'ap@acme.example' };

// ------------------------------------------------------------------ dates
test('dates: rejects impossible days instead of rolling them forward', () => {
  // new Date('2026-02-30') silently becomes March 2nd; that must not pass.
  assert.throws(() => parseDate('2026-02-30'), RangeError);
  assert.throws(() => parseDate('2026-13-01'), RangeError);
  assert.throws(() => parseDate('2025-02-29'), RangeError); // 2025 is not a leap year
  assert.doesNotThrow(() => parseDate('2024-02-29')); // 2024 is
});

test('dates: rejects anything that is not an ISO date', () => {
  assert.throws(() => parseDate('16/09/2026'), TypeError);
  assert.throws(() => parseDate(''), TypeError);
  assert.throws(() => parseDate(20260916), TypeError);
});

test('dates: addDays crosses months, years and leap days', () => {
  assert.equal(addDays('2026-09-16', 14), '2026-09-30');
  assert.equal(addDays('2026-09-16', 15), '2026-10-01');
  assert.equal(addDays('2026-12-20', 14), '2027-01-03');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2026-09-16', 0), '2026-09-16');
  assert.equal(addDays('2026-09-16', -1), '2026-09-15');
});

// ------------------------------------------------------------------ money
test('money: dollars convert to exact cents', () => {
  assert.equal(toCents(0), 0);
  assert.equal(toCents(1500), 150000);
  assert.equal(toCents(0.1), 10);
  assert.equal(toCents(1234.56), 123456);
  // The classic float trap: 19.99 * 100 is 1998.9999... in binary.
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents(0.29), 29);
});

test('money: refuses sub-cent precision rather than rounding it away', () => {
  assert.throws(() => toCents(10.005), RangeError);
  assert.throws(() => toCents(-5), RangeError);
  assert.throws(() => toCents(NaN), TypeError);
  assert.throws(() => toCents('1500'), TypeError);
});

test('money: formats with separators and two decimals', () => {
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(150000), '$1,500.00');
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatCents(-2500), '-$25.00');
});

// ---------------------------------------------------------------- invoice
test('invoice: printed lines always add up to the printed total', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-001',
    issueDate: '2026-09-16',
    lineItems: [
      { description: 'Build — inventory reorder tool', unitPrice: 1500 },
      { description: 'Care — September', unitPrice: 400 },
    ],
  });

  const summed = inv.lines.reduce((s, l) => s + l.amountCents, 0);
  assert.equal(summed, inv.subtotalCents);
  assert.equal(inv.subtotalCents, 190000);
  assert.equal(inv.totalCents, 190000);
  assert.equal(formatCents(inv.totalCents), '$1,900.00');
  assert.equal(inv.dueDate, '2026-09-30'); // default 14 days
});

test('invoice: fractional quantities round per line, and still sum exactly', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-002',
    issueDate: '2026-09-16',
    lineItems: [
      { description: 'Support', quantity: 2.5, unitPrice: 133.33 },
      { description: 'Support', quantity: 1.5, unitPrice: 133.33 },
    ],
  });
  assert.equal(inv.lines[0].amountCents, 33333); // round(13333 * 2.5) = 33332.5 -> 33333
  assert.equal(inv.lines[1].amountCents, 20000); // round(13333 * 1.5) = 19999.5 -> 20000
  assert.equal(inv.subtotalCents, 53333);
  assert.equal(
    inv.lines.reduce((s, l) => s + l.amountCents, 0),
    inv.subtotalCents,
  );
});

test('invoice: tax is applied to the subtotal and rounded once', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-003',
    issueDate: '2026-09-16',
    lineItems: [{ description: 'Build', unitPrice: 1500 }],
    taxRate: 0.0825,
  });
  assert.equal(inv.subtotalCents, 150000);
  assert.equal(inv.taxCents, 12375); // 150000 * 0.0825
  assert.equal(inv.totalCents, 162375);
  assert.equal(formatCents(inv.totalCents), '$1,623.75');
});

test('invoice: due date honours an explicit term', () => {
  const inv = invoice({
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-004',
    issueDate: '2026-12-20',
    dueInDays: 30,
    lineItems: [{ description: 'Care', unitPrice: 400 }],
  });
  assert.equal(inv.dueDate, '2027-01-19');
});

test('invoice: rejects the ways an invoice goes wrong', () => {
  const base = {
    operator: OPERATOR,
    client: CLIENT,
    invoiceNumber: 'INV-005',
    issueDate: '2026-09-16',
    lineItems: [{ description: 'Care', unitPrice: 400 }],
  };
  assert.throws(() => invoice({ ...base, lineItems: [] }), TypeError);
  assert.throws(() => invoice({ ...base, invoiceNumber: '  ' }), TypeError);
  assert.throws(() => invoice({ ...base, client: { name: '' } }), TypeError);
  assert.throws(() => invoice({ ...base, taxRate: 1.5 }), RangeError);
  assert.throws(() => invoice({ ...base, dueInDays: -3 }), RangeError);
  assert.throws(
    () => invoice({ ...base, lineItems: [{ description: 'x', quantity: 0, unitPrice: 1 }] }),
    RangeError,
  );
});

// -------------------------------------------------------------------- SOW
test('SOW: reports what the deal is worth in the worst allowed case', () => {
  const sow = statementOfWork({
    operator: OPERATOR,
    client: CLIENT,
    packageName: 'Build',
    price: 1500,
    startDate: '2026-09-21',
    estimatedHours: 20,
    hourCap: 30,
    deliverables: ['Replace the reorder spreadsheet with a web tool', 'Hand over the source'],
    exclusions: ['Data migration from the legacy system'],
    overageRate: 90,
  });
  assert.equal(sow.priceCents, 150000);
  // At the 30h cap the $1,500 build earns $50/hr — the figure that justifies
  // capping it there rather than letting it run.
  assert.equal(sow.effectiveHourlyAtCap, 5000);
  assert.equal(formatCents(sow.effectiveHourlyAtCap), '$50.00');
  assert.equal(sow.overageRateCents, 9000);
  assert.equal(sow.deliverables.length, 2);
});

test('SOW: a cap below the estimate is not a cap', () => {
  const base = {
    operator: OPERATOR,
    client: CLIENT,
    packageName: 'Build',
    price: 1500,
    startDate: '2026-09-21',
    estimatedHours: 20,
    deliverables: ['A thing'],
  };
  assert.throws(() => statementOfWork({ ...base, hourCap: 10 }), RangeError);
  assert.doesNotThrow(() => statementOfWork({ ...base, hourCap: 20 }));
});

test('SOW: refuses to produce an unscoped scope', () => {
  const base = {
    operator: OPERATOR,
    client: CLIENT,
    packageName: 'Build',
    price: 1500,
    startDate: '2026-09-21',
    estimatedHours: 20,
    hourCap: 30,
  };
  assert.throws(() => statementOfWork({ ...base, deliverables: [] }), TypeError);
  assert.throws(() => statementOfWork({ ...base, deliverables: undefined }), TypeError);
});

test('SOW: overage rate is optional and reported as absent', () => {
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
  assert.equal(sow.overageRateCents, null);
});
