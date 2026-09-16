import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  monthsOfRunway,
  packageEconomics,
  breakEvenClients,
  project,
} from '../model.mjs';

test('runway: burn with no revenue divides the spendable balance', () => {
  // 10,000 with a 2,000 floor leaves 8,000 spendable against 500/mo of burn.
  assert.equal(monthsOfRunway({ balance: 10000, monthlyBurn: 500, floor: 2000 }), 16);
});

test('runway: revenue extends it, and covering burn makes it infinite', () => {
  assert.equal(monthsOfRunway({ balance: 10000, monthlyBurn: 500, monthlyRevenue: 250 }), 40);
  assert.equal(
    monthsOfRunway({ balance: 10000, monthlyBurn: 500, monthlyRevenue: 500 }),
    Infinity,
  );
  assert.equal(
    monthsOfRunway({ balance: 10000, monthlyBurn: 500, monthlyRevenue: 900 }),
    Infinity,
  );
});

test('runway: zero burn is survivable forever', () => {
  assert.equal(monthsOfRunway({ balance: 10000, monthlyBurn: 0 }), Infinity);
});

test('runway: already at or below the floor is zero, never negative', () => {
  assert.equal(monthsOfRunway({ balance: 2000, monthlyBurn: 500, floor: 2000 }), 0);
  assert.equal(monthsOfRunway({ balance: 100, monthlyBurn: 500, floor: 2000 }), 0);
  assert.equal(monthsOfRunway({ balance: -50, monthlyBurn: 500 }), 0);
});

test('runway: rejects nonsense inputs rather than returning a number', () => {
  assert.throws(() => monthsOfRunway({ balance: 'lots', monthlyBurn: 1 }), TypeError);
  assert.throws(() => monthsOfRunway({ balance: 1, monthlyBurn: NaN }), TypeError);
  assert.throws(() => monthsOfRunway({ balance: 1, monthlyBurn: -5 }), RangeError);
});

test('package: converts a fixed price into an effective hourly rate', () => {
  const p = packageEconomics({
    name: 'Starter build',
    price: 750,
    deliveryHours: 10,
    directCost: 0,
    targetHourly: 50,
  });
  assert.equal(p.grossProfit, 750);
  assert.equal(p.effectiveHourly, 75);
  assert.equal(p.grossMargin, 1);
  assert.equal(p.meetsTarget, true);
  // 750 of profit at 50/hr supports 15 hours, so 5 beyond the planned 10.
  assert.equal(p.overrunHoursAllowed, 5);
});

test('package: direct costs cut the margin and the overrun budget', () => {
  const p = packageEconomics({
    price: 750,
    deliveryHours: 10,
    directCost: 150,
    targetHourly: 50,
  });
  assert.equal(p.grossProfit, 600);
  assert.equal(p.effectiveHourly, 60);
  assert.equal(p.grossMargin, 0.8);
  assert.equal(p.overrunHoursAllowed, 2);
});

test('package: an overrunning build fails the target', () => {
  // Same 750 price, but it really took 25 hours.
  const p = packageEconomics({ price: 750, deliveryHours: 25, targetHourly: 50 });
  assert.equal(p.effectiveHourly, 30);
  assert.equal(p.meetsTarget, false);
  assert.equal(p.overrunHoursAllowed, 0);
});

test('package: refuses effortless packages', () => {
  assert.throws(() => packageEconomics({ price: 750, deliveryHours: 0 }), RangeError);
});

test('break-even: counts clients by contribution, not headline price', () => {
  const b = breakEvenClients({ monthlyBurn: 400, retainerPrice: 300, retainerDirectCost: 50 });
  assert.equal(b.contribution, 250);
  assert.equal(b.clientsNeeded, 2); // ceil(400/250)
  assert.equal(b.viable, true);
});

test('break-even: a retainer that loses money per client is never viable', () => {
  const b = breakEvenClients({ monthlyBurn: 400, retainerPrice: 50, retainerDirectCost: 80 });
  assert.equal(b.viable, false);
  assert.equal(b.clientsNeeded, Infinity);
});

test('projection: zero burn and zero revenue holds the balance flat and survives', () => {
  const r = project({ openingBalance: 10000, months: 12, monthlyBurn: 0 });
  assert.equal(r.endingBalance, 10000);
  assert.equal(r.survives, true);
  assert.equal(r.ruinMonth, null);
  assert.equal(r.rows.length, 12);
  assert.equal(r.breakEvenMonth, 1); // net is 0, which is covering costs
});

test('projection: pure burn eventually breaches the floor and reports when', () => {
  const r = project({ openingBalance: 1000, months: 12, monthlyBurn: 100, floor: 500 });
  // 1000 -> 900, 800, ... below 500 first at month 6 (balance 400).
  assert.equal(r.ruinMonth, 6);
  assert.equal(r.survives, false);
  assert.equal(r.breakEvenMonth, null);
  assert.equal(r.endingBalance, -200);
  assert.equal(r.lowestBalance, -200);
});

test('projection: retainers accumulate and turn the business cash-positive', () => {
  const r = project({
    openingBalance: 10000,
    months: 6,
    monthlyBurn: 300,
    retainerPrice: 400,
    newRetainersPerMonth: 1,
  });
  // Month 1: 1 retainer = 400 revenue vs 300 burn -> net +100, already positive.
  assert.equal(r.breakEvenMonth, 1);
  assert.equal(r.rows[0].retainers, 1);
  assert.equal(r.rows[0].net, 100);
  // Month 6: 6 retainers = 2400 revenue, net +2100.
  assert.equal(r.rows[5].retainers, 6);
  assert.equal(r.rows[5].net, 2100);
  assert.equal(r.survives, true);
});

test('projection: churn caps growth at a steady state', () => {
  const r = project({
    openingBalance: 10000,
    months: 60,
    monthlyBurn: 0,
    retainerPrice: 100,
    newRetainersPerMonth: 1,
    monthlyChurnRate: 0.1,
  });
  // The recurrence r' = r(1 - c) + a converges to a/c = 1/0.1 = 10, approached
  // from below and never reached: after n months it sits at 10 * (1 - 0.9^n).
  const settled = r.rows.at(-1).retainers;
  assert.ok(settled < 10, `steady state is approached from below, got ${settled}`);
  assert.ok(10 - settled < 0.02, `expected within 0.02 of 10, got ${settled}`);
  // Growth is monotonic on the way there.
  for (let i = 1; i < r.rows.length; i += 1) {
    assert.ok(r.rows[i].retainers > r.rows[i - 1].retainers, `month ${i + 1} should grow`);
  }
});

test('projection: total churn means retainers never accumulate', () => {
  const r = project({
    openingBalance: 5000,
    months: 6,
    monthlyBurn: 0,
    startingRetainers: 5,
    retainerPrice: 100,
    newRetainersPerMonth: 1,
    monthlyChurnRate: 1,
  });
  // Everyone churns each month, so only the month's new client ever pays.
  for (const row of r.rows) {
    assert.equal(row.retainers, 1);
    assert.equal(row.revenue, 100);
  }
});

test('projection: one-off projects are counted net of their direct cost', () => {
  const r = project({
    openingBalance: 0,
    months: 3,
    monthlyBurn: 0,
    projectsPerMonth: 2,
    projectPrice: 750,
    projectDirectCost: 50,
  });
  assert.equal(r.rows[0].revenue, 1500);
  assert.equal(r.rows[0].costs, 100);
  assert.equal(r.rows[0].net, 1400);
  assert.equal(r.endingBalance, 4200);
});

test('projection: rejects a churn rate that is not a fraction', () => {
  assert.throws(
    () => project({ openingBalance: 1, months: 1, monthlyBurn: 0, monthlyChurnRate: 1.5 }),
    RangeError,
  );
});
