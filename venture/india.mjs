// The India-specific arithmetic: what a foreign invoice is actually worth
// after the payment rail, the rupee, and the Income Tax Act.
//
// The headline finding this module exists to make checkable: under Section
// 44ADA (50% of receipts deemed income) combined with the new regime's 87A
// rebate (nil tax to Rs 12 lakh), gross professional receipts up to
// **Rs 24 lakh a year carry no income tax at all**.
//
// Rupees throughout, as whole rupees — the Act computes in rupees, not paise.
//
// NOT tax advice. These are the published slabs applied arithmetically; a
// chartered accountant signs the return, not this file.

/** New regime slabs, FY 2025-26 (AY 2026-27). [upTo, rate] — upTo is inclusive. */
const NEW_REGIME_SLABS = [
  [400000, 0.0],
  [800000, 0.05],
  [1200000, 0.1],
  [1600000, 0.15],
  [2000000, 0.2],
  [2400000, 0.25],
  [Infinity, 0.3],
];

const REBATE_87A_LIMIT = 1200000; // taxable income at or below which the rebate applies
const REBATE_87A_MAX = 60000;
const CESS_RATE = 0.04; // health & education cess, charged on tax after rebate

export const THRESHOLDS = {
  gstRegistration: 2000000,   // Rs 20L aggregate turnover (Rs 10L in special-category states)
  incomeTaxStarts: 2400000,   // Rs 24L of receipts, via 44ADA + 87A
  presumptiveCap: 7500000,    // Rs 75L, when >=95% of receipts are digital (else Rs 50L)
};

function requireMoney(name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new TypeError(`${name} must be a non-negative finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Slab tax before rebate and cess. */
export function slabTax(taxableIncome) {
  requireMoney('taxableIncome', taxableIncome);
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of NEW_REGIME_SLABS) {
    if (taxableIncome <= lower) break;
    tax += (Math.min(taxableIncome, upTo) - lower) * rate;
    lower = upTo;
  }
  return tax;
}

/**
 * Income tax under the new regime, including the 87A rebate, marginal relief
 * just above the rebate limit, and cess.
 *
 * Marginal relief matters: without it, earning one rupee over Rs 12L would cost
 * Rs 60,000 in tax. The Act caps the tax at the amount by which income exceeds
 * the limit, so the cliff becomes a ramp.
 */
export function incomeTaxNewRegime(taxableIncome) {
  requireMoney('taxableIncome', taxableIncome);

  const base = slabTax(taxableIncome);

  let afterRebate;
  if (taxableIncome <= REBATE_87A_LIMIT) {
    afterRebate = Math.max(0, base - REBATE_87A_MAX);
  } else {
    // Marginal relief: tax cannot exceed the excess over the rebate limit.
    afterRebate = Math.min(base, taxableIncome - REBATE_87A_LIMIT);
  }

  const cess = afterRebate * CESS_RATE;
  return {
    slabTax: Math.round(base),
    rebate: Math.round(base - afterRebate),
    taxBeforeCess: Math.round(afterRebate),
    cess: Math.round(cess),
    total: Math.round(afterRebate + cess),
  };
}

/** Section 44ADA: half of gross receipts is deemed to be income. */
export function presumptiveIncome(grossReceipts, { deemedRate = 0.5 } = {}) {
  requireMoney('grossReceipts', grossReceipts);
  if (!(deemedRate > 0 && deemedRate <= 1)) {
    throw new RangeError(`deemedRate must be in (0, 1], got ${deemedRate}`);
  }
  return Math.round(grossReceipts * deemedRate);
}

/**
 * A year of foreign invoicing, end to end.
 *
 * annualUSD -> payment-rail fee -> rupees -> 44ADA -> new-regime tax -> kept.
 */
export function annualTakeHome({
  annualUSD,
  fxRate,
  railFeePct = 0.01,
  deemedRate = 0.5,
}) {
  requireMoney('annualUSD', annualUSD);
  requireMoney('fxRate', fxRate);
  if (fxRate === 0) throw new RangeError('fxRate must be > 0');
  if (!(railFeePct >= 0 && railFeePct < 1)) {
    throw new RangeError(`railFeePct must be in [0, 1), got ${railFeePct}`);
  }

  const railFeeUSD = annualUSD * railFeePct;
  const netUSD = annualUSD - railFeeUSD;
  const grossReceiptsINR = Math.round(netUSD * fxRate);

  const deemed = presumptiveIncome(grossReceiptsINR, { deemedRate });
  const tax = incomeTaxNewRegime(deemed);
  const keptINR = grossReceiptsINR - tax.total;

  return {
    annualUSD,
    railFeeUSD: Math.round(railFeeUSD * 100) / 100,
    fxRate,
    grossReceiptsINR,
    deemedIncomeINR: deemed,
    taxINR: tax.total,
    taxBreakdown: tax,
    keptINR,
    keptMonthlyINR: Math.round(keptINR / 12),
    effectiveTaxRate: grossReceiptsINR === 0 ? 0 : tax.total / grossReceiptsINR,
    needsGstRegistration: grossReceiptsINR > THRESHOLDS.gstRegistration,
    exceedsPresumptiveCap: grossReceiptsINR > THRESHOLDS.presumptiveCap,
  };
}

/**
 * The same hour sold domestically versus exported.
 *
 * This is the whole strategic argument in one number: an hour billed in USD at
 * a rate that is unremarkable in the client's market is worth a multiple of the
 * same hour billed in rupees at an Indian market rate.
 */
export function exportAdvantage({ usdHourlyRate, inrHourlyRate, fxRate }) {
  requireMoney('usdHourlyRate', usdHourlyRate);
  requireMoney('inrHourlyRate', inrHourlyRate);
  requireMoney('fxRate', fxRate);
  if (inrHourlyRate === 0) throw new RangeError('inrHourlyRate must be > 0');

  const exportedINR = usdHourlyRate * fxRate;
  return {
    exportedINR: Math.round(exportedINR),
    domesticINR: Math.round(inrHourlyRate),
    multiple: exportedINR / inrHourlyRate,
  };
}
