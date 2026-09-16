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

hr('5. Runway on a Rs 10,000 war chest');
const BALANCE = 10000;
const FLOOR = 3000; // keep Rs 3,000 back; zero is already too late
console.log('  Living costs are covered elsewhere, so this is not a survival clock.');
console.log('  It is a war chest that cannot fund customer acquisition.\n');
for (const [what, burn] of [
  ['free tiers only (verified today)', 0],
  ['one domain name', 500],
  ['one modest SaaS subscription', 2000],
  ['a "growth stack" of tools', 6000],
]) {
  const m = monthsOfRunway({ balance: BALANCE, monthlyBurn: burn, floor: FLOOR });
  console.log(
    `  ${inr(burn).padStart(9)}/mo  ${what.padEnd(34)} -> ${
      m === Infinity ? 'indefinite' : `${m.toFixed(1)} months`
    }`,
  );
}
console.log('\n  At this balance a single Rs 2,000/mo subscription is a 3.5-month fuse.');
console.log('  Every tool must be free until a client is paying for it.');

hr('6. What one sale does');
console.log('  The Audit is priced at $250. Converted, that is more than twice');
console.log('  the entire starting balance:\n');
const auditINR = 250 * FX * (1 - RAIL_FEE);
console.log(`    starting balance      ${inr(BALANCE).padStart(12)}`);
console.log(`    one Audit             ${inr(auditINR).padStart(12)}`);
console.log(`    after one Audit       ${inr(BALANCE + auditINR).padStart(12)}  (${((BALANCE + auditINR) / BALANCE).toFixed(1)}x)`);
console.log(`    one Build             ${inr(1500 * FX * (1 - RAIL_FEE)).padStart(12)}`);
console.log(`    one Care client/yr    ${inr(400 * 12 * FX * (1 - RAIL_FEE)).padStart(12)}`);
console.log('\n  Nothing that can be bought with Rs 10,000 moves the needle like');
console.log('  the first sale does. So the plan is not to spend it. It is to sell.');

const twelve = project({
  openingBalance: BALANCE,
  months: 12,
  monthlyBurn: 0,
  floor: FLOOR,
  projectsPerMonth: 0.5,
  projectPrice: 1500 * FX * (1 - RAIL_FEE),
  newRetainersPerMonth: 0.25,
  retainerPrice: 400 * FX * (1 - RAIL_FEE),
  monthlyChurnRate: 0.05,
});
console.log(`\n  A modest year (one Build every two months, half converting to Care):`);
console.log(`     ends at ${inr(twelve.endingBalance)}, break-even month ${twelve.breakEvenMonth}`);

hr('7. Break-even');
const be = breakEvenClients({
  monthlyBurn: 2000,
  retainerPrice: 400 * FX * (1 - RAIL_FEE),
  retainerDirectCost: 500,
});
console.log(`  ${be.clientsNeeded} Care client covers the entire operation`
  + ` (contribution ${inr(be.contribution)}/client/mo).`);
console.log();
