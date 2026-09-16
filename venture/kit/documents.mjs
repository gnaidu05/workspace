// Client paperwork as pure data transforms.
//
// A productized service earns its margin on repetition: the same scope letter
// and the same invoice, generated rather than retyped. So the documents are
// built as plain objects first and rendered second — the money arithmetic is
// testable without going near a template.
//
// Money is integer CENTS everywhere internally. Floating-point dollars round
// wrong on exactly the values invoices are made of (0.1 + 0.2 !== 0.3), and an
// invoice that is a cent out is an invoice the client queries.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value, name = 'date') {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new TypeError(`${name} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(value)}`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  // Round-tripping rejects real-looking impossibilities like 2026-02-30, which
  // the Date constructor silently rolls forward into March.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${name} is not a real calendar date: ${value}`);
  }
  return d;
}

export function addDays(isoDate, days) {
  if (!Number.isInteger(days)) throw new TypeError(`days must be an integer, got ${days}`);
  const d = parseDate(isoDate, 'isoDate');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dollars (as written by a human) to integer cents. */
export function toCents(dollars) {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) {
    throw new TypeError(`amount must be a finite number, got ${JSON.stringify(dollars)}`);
  }
  if (dollars < 0) throw new RangeError(`amount must not be negative, got ${dollars}`);
  const cents = Math.round(dollars * 100);
  // Guard against a price written with sub-cent precision silently rounding.
  if (Math.abs(dollars * 100 - cents) > 1e-6) {
    throw new RangeError(`amount ${dollars} is finer than one cent`);
  }
  return cents;
}

export function formatCents(cents) {
  if (!Number.isInteger(cents)) throw new TypeError(`cents must be an integer, got ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * An invoice, totalled exactly.
 *
 * Each line is rounded to the cent before the total is taken, so the printed
 * lines always add up to the printed total — the property a client checks.
 */
export function invoice({
  operator,
  client,
  lineItems,
  issueDate,
  dueInDays = 14,
  invoiceNumber,
  taxRate = 0,
  notes = '',
}) {
  requireParty(operator, 'operator');
  requireParty(client, 'client');
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new TypeError('lineItems must be a non-empty array');
  }
  if (typeof invoiceNumber !== 'string' || invoiceNumber.trim() === '') {
    throw new TypeError('invoiceNumber must be a non-empty string');
  }
  if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
    throw new RangeError(`taxRate must be a fraction 0..1, got ${taxRate}`);
  }
  parseDate(issueDate, 'issueDate');
  if (!Number.isInteger(dueInDays) || dueInDays < 0) {
    throw new RangeError(`dueInDays must be a non-negative integer, got ${dueInDays}`);
  }

  const lines = lineItems.map((item, i) => {
    const { description, quantity = 1, unitPrice } = item;
    if (typeof description !== 'string' || description.trim() === '') {
      throw new TypeError(`lineItems[${i}].description must be a non-empty string`);
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new RangeError(`lineItems[${i}].quantity must be > 0, got ${quantity}`);
    }
    const unitCents = toCents(unitPrice);
    return {
      description: description.trim(),
      quantity,
      unitCents,
      amountCents: Math.round(unitCents * quantity),
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const taxCents = Math.round(subtotalCents * taxRate);

  return {
    invoiceNumber: invoiceNumber.trim(),
    operator,
    client,
    issueDate,
    dueDate: addDays(issueDate, dueInDays),
    lines,
    subtotalCents,
    taxRate,
    taxCents,
    totalCents: subtotalCents + taxCents,
    notes,
  };
}

/**
 * A statement of work that writes the scope cap down.
 *
 * The cap is the whole point: a fixed price against unbounded effort is how a
 * productized build loses money while the sale succeeds. Agreeing the ceiling
 * in writing, before work starts, is what makes the fixed price safe.
 */
export function statementOfWork({
  operator,
  client,
  packageName,
  price,
  startDate,
  estimatedHours,
  hourCap,
  deliverables,
  exclusions = [],
  overageRate,
}) {
  requireParty(operator, 'operator');
  requireParty(client, 'client');
  if (typeof packageName !== 'string' || packageName.trim() === '') {
    throw new TypeError('packageName must be a non-empty string');
  }
  if (!Array.isArray(deliverables) || deliverables.length === 0) {
    throw new TypeError('deliverables must be a non-empty array — an unscoped SOW is not a scope');
  }
  if (!Number.isFinite(estimatedHours) || estimatedHours <= 0) {
    throw new RangeError(`estimatedHours must be > 0, got ${estimatedHours}`);
  }
  if (!Number.isFinite(hourCap) || hourCap < estimatedHours) {
    throw new RangeError(
      `hourCap (${hourCap}) must be >= estimatedHours (${estimatedHours}); a cap below the estimate is not a cap`,
    );
  }
  parseDate(startDate, 'startDate');

  const priceCents = toCents(price);
  const effectiveHourlyAtCap = Math.round(priceCents / hourCap);

  return {
    operator,
    client,
    packageName: packageName.trim(),
    priceCents,
    startDate,
    estimatedHours,
    hourCap,
    // What the deal is worth in the worst allowed case. If this is unacceptable,
    // the cap is wrong and the time to find out is now, not at delivery.
    effectiveHourlyAtCap,
    overageRateCents: overageRate === undefined ? null : toCents(overageRate),
    deliverables: deliverables.map((d) => String(d).trim()).filter(Boolean),
    exclusions: exclusions.map((d) => String(d).trim()).filter(Boolean),
  };
}

function requireParty(p, name) {
  if (!p || typeof p !== 'object') throw new TypeError(`${name} must be an object`);
  if (typeof p.name !== 'string' || p.name.trim() === '') {
    throw new TypeError(`${name}.name must be a non-empty string`);
  }
}
