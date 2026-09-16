// Runs the actual numbers for this venture through the model.
// `node scenarios.mjs` — no arguments, no network, no state.

import { monthsOfRunway, packageEconomics, breakEvenClients, project } from './model.mjs';

const CAPITAL = 10000;
const FLOOR = 3000;        // the reserve we refuse to spend below
const TARGET_HOURLY = 60;  // below this, the work is not worth doing

const money = (n) =>
  n === Infinity ? 'never' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = (n) => `${(n * 100).toFixed(0)}%`;
const hr = (s) => console.log(`\n${s}\n${'-'.repeat(s.length)}`);

// ---------------------------------------------------------------- packages
hr('1. Are the packages worth delivering?');

const packages = [
  { name: 'Audit      ', price: 250, deliveryHours: 3 },
  { name: 'Build      ', price: 1500, deliveryHours: 20 },
  { name: 'Care (/mo) ', price: 400, deliveryHours: 3 },
];

for (const p of packages) {
  const e = packageEconomics({ ...p, targetHourly: TARGET_HOURLY });
  const verdict = e.meetsTarget ? 'OK ' : 'BAD';
  console.log(
    `${verdict} ${e.name} ${money(e.price).padStart(7)} / ${String(e.deliveryHours).padStart(3)}h` +
      ` = ${money(e.effectiveHourly).padStart(5)}/hr` +
      `  (can overrun ${e.overrunHoursAllowed.toFixed(1)}h before it stops clearing ${money(TARGET_HOURLY)}/hr)`,
  );
}

// The Build package is the risky one: fixed price against unbounded scope.
hr('2. What if the Build package overruns?');
for (const hours of [20, 30, 40, 60]) {
  const e = packageEconomics({ price: 1500, deliveryHours: hours, targetHourly: TARGET_HOURLY });
  console.log(
    `  ${String(hours).padStart(3)}h -> ${money(e.effectiveHourly).padStart(5)}/hr  ${
      e.meetsTarget ? 'still fine' : 'NOT WORTH DOING'
    }`,
  );
}

// ------------------------------------------------------------- break-even
hr('3. How many Care clients before the business pays for itself?');
for (const burn of [0, 50, 200, 1000, 3000]) {
  const b = breakEvenClients({ monthlyBurn: burn, retainerPrice: 400, retainerDirectCost: 25 });
  console.log(
    `  burn ${money(burn).padStart(6)}/mo -> ${String(b.clientsNeeded).padStart(2)} Care clients` +
      ` (contribution ${money(b.contribution)}/client)`,
  );
}

// ---------------------------------------------------------------- runway
hr('4. Runway on capital alone (floor $3,000, so $7,000 is spendable)');
for (const burn of [0, 50, 200, 1000, 3000]) {
  const m = monthsOfRunway({ balance: CAPITAL, monthlyBurn: burn, floor: FLOOR });
  console.log(
    `  burn ${money(burn).padStart(6)}/mo -> ${
      m === Infinity ? 'indefinite' : `${m.toFixed(1)} months`
    }`,
  );
}

// -------------------------------------------------------------- scenarios
hr('5. Twelve-month scenarios');

const scenarios = [
  {
    label: 'A. Nothing sells, discipline holds',
    note: 'free tiers only, no ad spend',
    opts: { monthlyBurn: 50, projectsPerMonth: 0, newRetainersPerMonth: 0 },
  },
  {
    label: 'B. Slow: one Build every other month',
    note: 'half the Builds convert to Care',
    opts: {
      monthlyBurn: 50,
      projectsPerMonth: 0.5,
      projectPrice: 1500,
      newRetainersPerMonth: 0.25,
      retainerPrice: 400,
      retainerDirectCost: 25,
      monthlyChurnRate: 0.05,
    },
  },
  {
    label: 'C. Working: one Build a month',
    note: 'half convert to Care',
    opts: {
      monthlyBurn: 50,
      projectsPerMonth: 1,
      projectPrice: 1500,
      newRetainersPerMonth: 0.5,
      retainerPrice: 400,
      retainerDirectCost: 25,
      monthlyChurnRate: 0.05,
    },
  },
  {
    label: 'D. Impatient: $1,500/mo on ads, still nothing sells',
    note: 'the way this actually dies',
    opts: { monthlyBurn: 1550, projectsPerMonth: 0, newRetainersPerMonth: 0 },
  },
];

for (const s of scenarios) {
  const r = project({ openingBalance: CAPITAL, months: 12, floor: FLOOR, ...s.opts });
  const status = r.survives ? 'SURVIVES' : `RUIN in month ${r.ruinMonth}`;
  console.log(`\n  ${s.label}  (${s.note})`);
  console.log(
    `     ${status.padEnd(18)} ending ${money(r.endingBalance).padStart(8)}` +
      `   low ${money(r.lowestBalance).padStart(8)}` +
      `   break-even ${r.breakEvenMonth ? `month ${r.breakEvenMonth}` : 'never'}`,
  );
}

hr('6. The sensitivity that matters');
const need = breakEvenClients({ monthlyBurn: 50, retainerPrice: 400, retainerDirectCost: 25 });
console.log(`  Business-only break-even: ${need.clientsNeeded} Care client.`);
console.log('  Personal living costs are NOT modelled here and dominate everything above.');
for (const personal of [1500, 2500, 4000]) {
  const m = monthsOfRunway({ balance: CAPITAL, monthlyBurn: personal + 50, floor: FLOOR });
  const b = breakEvenClients({
    monthlyBurn: personal + 50,
    retainerPrice: 400,
    retainerDirectCost: 25,
  });
  console.log(
    `    at ${money(personal)}/mo personal: ${m.toFixed(1)} months of runway,` +
      ` ${b.clientsNeeded} Care clients to break even`,
  );
}
console.log();
