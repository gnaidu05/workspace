// This venture's real numbers, for an operator based in India exporting
// services. `node scenarios.mjs` — no arguments, no network, no state.

import { monthsOfRunway, packageEconomics, breakEvenClients, project } from './model.mjs';
import { annualTakeHome, exportAdvantage, incomeTaxNewRegime, presumptiveIncome, THRESHOLDS }
  from './india.mjs';

// ASSUMPTION, not a quote. Re-run with today's rate before pricing anything.
const FX = 88;
const RAIL_FEE = 0.01; // ~1% all-in on an export-focused rail

const inr = (n) =>
  n === Infinity ? 'never' : `Rs ${Math.round(n).toLocaleString('en-IN')}`;
const lakh = (n) => `Rs ${(n / 100000).toFixed(1)}L`;
const usd = (n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const hr = (s) => console.log(`\n${s}\n${'='.repeat(s.length)}`);

// USD prices: unremarkable in the client's market, excellent once converted.
const PACKAGES = [
  { name: 'Audit', usd: 250, hours: 3 },
  { name: 'Build', usd: 1500, hours: 20 },
  { name: 'Care ', usd: 400, hours: 3, recurring: true },
];

hr('1. Why export rather than sell domestically');
const adv = exportAdvantage({ usdHourlyRate: 60, inrHourlyRate: 1200, fxRate: FX });
console.log(`  An hour billed at ${usd(60)} abroad  = ${inr(adv.exportedINR)}`);
console.log(`  An hour billed at Indian market rate = ${inr(adv.domesticINR)}`);
console.log(`  Same hour, same skill: ${adv.multiple.toFixed(1)}x`);
console.log('\n  $60/hr is an ordinary rate in the US market and a poor one for an');
console.log('  agency there. That gap is the whole strategy.');

hr('2. What each package earns, in rupees per hour');
for (const p of PACKAGES) {
  const e = packageEconomics({
    name: p.name,
    price: p.usd * FX * (1 - RAIL_FEE),
    deliveryHours: p.hours,
    targetHourly: 2500 * 1, // Rs 2,500/hr floor
  });
  console.log(
    `  ${p.name}  ${usd(p.usd).padStart(6)}${p.recurring ? '/mo' : '   '}` +
      ` -> ${inr(e.price).padStart(12)} for ${String(p.hours).padStart(2)}h` +
      ` = ${inr(e.effectiveHourly).padStart(8)}/hr`,
  );
}

hr('3. The tax ladder (44ADA + new regime)');
console.log(`  Receipts up to ${lakh(THRESHOLDS.incomeTaxStarts)}  -> no income tax at all`);
console.log(`  Turnover above  ${lakh(THRESHOLDS.gstRegistration)}  -> GST registration required`);
console.log('                              (exports are zero-rated; file an LUT, charge no GST)');
console.log(`  Receipts above  ${lakh(THRESHOLDS.presumptiveCap)}  -> beyond 44ADA, books + audit`);
console.log('\n  Tax actually payable at each level of receipts:');
for (const receipts of [1000000, 2000000, 2400000, 3000000, 5000000]) {
  const tax = incomeTaxNewRegime(presumptiveIncome(receipts));
  const rate = receipts === 0 ? 0 : (tax.total / receipts) * 100;
  console.log(
    `    ${lakh(receipts).padStart(9)} receipts -> ${inr(tax.total).padStart(12)} tax` +
      ` (${rate.toFixed(1)}% effective)`,
  );
}

hr('4. How many Care clients reach a target income');
console.log('  Care is the only line that compounds, so this is the real ladder.\n');
for (const clients of [1, 3, 5, 6, 10]) {
  const annualUSD = clients * 400 * 12;
  const r = annualTakeHome({ annualUSD, fxRate: FX, railFeePct: RAIL_FEE });
  const flags = [
    r.needsGstRegistration ? 'GST' : '   ',
    r.exceedsPresumptiveCap ? 'AUDIT' : '     ',
  ].join(' ');
  console.log(
    `  ${String(clients).padStart(2)} clients  ${usd(annualUSD).padStart(8)}/yr` +
      ` -> keep ${inr(r.keptINR).padStart(12)}` +
      ` (${inr(r.keptMonthlyINR)}/mo)  tax ${inr(r.taxINR).padStart(10)}  ${flags}`,
  );
}
console.log('\n  5 Care clients clears Rs 20L a year with zero income tax.');
console.log('  That is the target. Not 50 clients, not a product launch. Five.');

hr('5. Runway — and the question the balance depends on');
console.log('  "10K" is ambiguous and the two readings are not close:\n');
for (const [label, balance, floor] of [
  ['Rs 10,000', 10000, 3000],
  ['$10,000 (Rs 8.8L)', 10000 * FX, 300000],
]) {
  console.log(`  ${label}:`);
  for (const burn of [0, 2000, 10000]) {
    const m = monthsOfRunway({ balance, monthlyBurn: burn, floor });
    console.log(
      `      burn ${inr(burn).padStart(10)}/mo -> ${
        m === Infinity ? 'indefinite' : `${m.toFixed(1)} months`
      }`,
    );
  }
}

hr('6. Spend discipline still decides it');
console.log('  Surviving twelve months is a low bar. Watch the capital column.');
const scenarios = [
  {
    label: 'A. Nothing sells all year, free tiers only',
    opts: { monthlyBurn: 2000 },
  },
  {
    label: 'B. One Build a month, half convert to Care',
    opts: {
      monthlyBurn: 2000,
      projectsPerMonth: 1,
      projectPrice: 1500 * FX * (1 - RAIL_FEE),
      newRetainersPerMonth: 0.5,
      retainerPrice: 400 * FX * (1 - RAIL_FEE),
      monthlyChurnRate: 0.05,
    },
  },
  {
    label: 'C. Rs 40,000/mo on ads and tools, nothing sells',
    opts: { monthlyBurn: 42000 },
  },
];
for (const s of scenarios) {
  const r = project({ openingBalance: 10000 * FX, months: 12, floor: 300000, ...s.opts });
  const opening = 10000 * FX;
  const burned = opening - r.endingBalance;
  const burnedPct = (burned / opening) * 100;
  console.log(`\n  ${s.label}`);
  console.log(
    `     ${(r.survives ? 'survives' : `RUIN in month ${r.ruinMonth}`).padEnd(18)}` +
      ` ending ${inr(r.endingBalance).padStart(14)}` +
      `   break-even ${r.breakEvenMonth ? `month ${r.breakEvenMonth}` : 'never'}`,
  );
  console.log(
    `     ${''.padEnd(18)} capital ${
      burned > 0 ? `DESTROYED ${inr(burned)} (${burnedPct.toFixed(0)}%)` : 'grown'
    }`,
  );
}

hr('7. Break-even');
const be = breakEvenClients({
  monthlyBurn: 2000,
  retainerPrice: 400 * FX * (1 - RAIL_FEE),
  retainerDirectCost: 500,
});
console.log(`  ${be.clientsNeeded} Care client covers the entire operation`
  + ` (contribution ${inr(be.contribution)}/client/mo).`);
console.log();
