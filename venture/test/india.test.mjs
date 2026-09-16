import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  slabTax,
  incomeTaxNewRegime,
  presumptiveIncome,
  annualTakeHome,
  exportAdvantage,
  THRESHOLDS,
} from '../india.mjs';

test('slabs: each boundary computes to the published figure', () => {
  assert.equal(slabTax(0), 0);
  assert.equal(slabTax(400000), 0);
  // 4L-8L at 5%
  assert.equal(slabTax(800000), 20000);
  // + 4L-12L at 10%
  assert.equal(slabTax(1200000), 60000);
  // + 12L-16L at 15%
  assert.equal(slabTax(1600000), 120000);
  // + 16L-20L at 20%
  assert.equal(slabTax(2000000), 200000);
  // + 20L-24L at 25%
  assert.equal(slabTax(2400000), 300000);
  // + 30% above
  assert.equal(slabTax(3400000), 600000);
});

test('87A: the rebate exactly cancels the tax at Rs 12 lakh', () => {
  const t = incomeTaxNewRegime(1200000);
  assert.equal(t.slabTax, 60000);
  assert.equal(t.rebate, 60000);
  assert.equal(t.total, 0);
});

test('87A: everything at or below the limit is nil, cess included', () => {
  for (const income of [0, 400000, 700000, 1199999, 1200000]) {
    assert.equal(incomeTaxNewRegime(income).total, 0, `expected nil tax at ${income}`);
  }
});

test('marginal relief: one rupee over the limit costs one rupee, not sixty thousand', () => {
  const t = incomeTaxNewRegime(1200001);
  // Without relief this would be 60,000 + 15% of the excess. Relief caps it.
  assert.equal(t.taxBeforeCess, 1);
  assert.equal(t.total, 1); // cess on Re 1 rounds to nil
});

test('marginal relief: applies until normal tax becomes the smaller figure', () => {
  // At 12.5L: slab tax = 60,000 + 15% of 50,000 = 67,500; excess = 50,000.
  // Relief binds, so 50,000 is payable.
  const relieved = incomeTaxNewRegime(1250000);
  assert.equal(relieved.taxBeforeCess, 50000);
  assert.equal(relieved.cess, 2000);
  assert.equal(relieved.total, 52000);

  // By 15L the slab tax (1,05,000) is below the excess (3,00,000), so relief
  // stops binding and ordinary tax applies.
  const ordinary = incomeTaxNewRegime(1500000);
  assert.equal(ordinary.taxBeforeCess, 105000);
  assert.equal(ordinary.total, 109200); // + 4% cess
});

test('marginal relief: tax never decreases as income rises', () => {
  let previous = -1;
  for (let income = 1100000; income <= 1700000; income += 5000) {
    const total = incomeTaxNewRegime(income).total;
    assert.ok(total >= previous, `tax fell at income ${income}: ${total} < ${previous}`);
    previous = total;
  }
});

test('44ADA: half of receipts is deemed income', () => {
  assert.equal(presumptiveIncome(2400000), 1200000);
  assert.equal(presumptiveIncome(0), 0);
  assert.throws(() => presumptiveIncome(-1), TypeError);
  assert.throws(() => presumptiveIncome(100, { deemedRate: 0 }), RangeError);
});

test('the headline: receipts up to Rs 24 lakh carry no income tax', () => {
  for (const receipts of [500000, 1500000, 2000000, 2399999, 2400000]) {
    const tax = incomeTaxNewRegime(presumptiveIncome(receipts)).total;
    assert.equal(tax, 0, `expected nil tax on receipts of ${receipts}, got ${tax}`);
  }
  // And the very next rupee is taxed, gently.
  assert.ok(incomeTaxNewRegime(presumptiveIncome(2400002)).total > 0);
});

test('take-home: the full chain from dollars to rupees kept', () => {
  const r = annualTakeHome({ annualUSD: 24000, fxRate: 88, railFeePct: 0.01 });
  assert.equal(r.railFeeUSD, 240);
  assert.equal(r.grossReceiptsINR, Math.round(23760 * 88)); // 20,90,880
  assert.equal(r.deemedIncomeINR, 1045440);
  assert.equal(r.taxINR, 0); // comfortably under the Rs 24L receipts line
  assert.equal(r.keptINR, r.grossReceiptsINR);
  assert.equal(r.effectiveTaxRate, 0);
  // Over Rs 20L of turnover, so GST registration is triggered even though
  // exports are zero-rated.
  assert.equal(r.needsGstRegistration, true);
  assert.equal(r.exceedsPresumptiveCap, false);
});

test('take-home: below the GST line nothing is triggered', () => {
  const r = annualTakeHome({ annualUSD: 12000, fxRate: 88 });
  assert.equal(r.needsGstRegistration, false);
  assert.equal(r.taxINR, 0);
});

test('take-home: the presumptive cap is flagged when crossed', () => {
  const r = annualTakeHome({ annualUSD: 100000, fxRate: 88 });
  assert.equal(r.exceedsPresumptiveCap, true);
  assert.ok(r.taxINR > 0);
  assert.ok(r.effectiveTaxRate > 0 && r.effectiveTaxRate < 0.3);
});

test('take-home: a costlier rail reduces what arrives', () => {
  const cheap = annualTakeHome({ annualUSD: 24000, fxRate: 88, railFeePct: 0.01 });
  const dear = annualTakeHome({ annualUSD: 24000, fxRate: 88, railFeePct: 0.05 });
  assert.ok(dear.grossReceiptsINR < cheap.grossReceiptsINR);
  assert.equal(cheap.grossReceiptsINR - dear.grossReceiptsINR, Math.round(24000 * 0.04 * 88));
});

test('take-home: rejects a missing or impossible exchange rate', () => {
  assert.throws(() => annualTakeHome({ annualUSD: 1000, fxRate: 0 }), RangeError);
  assert.throws(() => annualTakeHome({ annualUSD: 1000, fxRate: -88 }), TypeError);
  assert.throws(() => annualTakeHome({ annualUSD: 1000, fxRate: 88, railFeePct: 1 }), RangeError);
});

test('export advantage: the same hour is worth a multiple abroad', () => {
  // $60/hr exported vs Rs 1,200/hr domestic.
  const a = exportAdvantage({ usdHourlyRate: 60, inrHourlyRate: 1200, fxRate: 88 });
  assert.equal(a.exportedINR, 5280);
  assert.equal(a.domesticINR, 1200);
  assert.equal(a.multiple, 4.4);
});

test('thresholds are the published figures', () => {
  assert.equal(THRESHOLDS.gstRegistration, 2000000);
  assert.equal(THRESHOLDS.incomeTaxStarts, 2400000);
  assert.equal(THRESHOLDS.presumptiveCap, 7500000);
});
