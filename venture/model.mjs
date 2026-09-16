// Survival model for a productized automation service.
//
// Everything here is a pure function over plain numbers: no I/O, no clock, no
// randomness. That is deliberate — these are the numbers a decision to spend
// money gets checked against, so they have to be reproducible and testable.
//
// Money is in whole currency units (dollars), time in months, effort in hours.

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function need(name, value, { min = -Infinity } = {}) {
  if (!isFiniteNumber(value)) {
    throw new TypeError(`${name} must be a finite number, got ${JSON.stringify(value)}`);
  }
  if (value < min) {
    throw new RangeError(`${name} must be >= ${min}, got ${value}`);
  }
  return value;
}

/**
 * Months of survival before cash reaches `floor`.
 *
 * `floor` is a reserve you refuse to spend below — the point at which you stop
 * being a business and start being in trouble. Runway is measured to the floor,
 * not to zero, because zero is already too late.
 *
 * Returns Infinity when revenue covers burn (you are not dying), and 0 when the
 * floor is already breached.
 */
export function monthsOfRunway({ balance, monthlyBurn, monthlyRevenue = 0, floor = 0 }) {
  need('balance', balance);
  need('monthlyBurn', monthlyBurn, { min: 0 });
  need('monthlyRevenue', monthlyRevenue, { min: 0 });
  need('floor', floor, { min: 0 });

  const spendable = balance - floor;
  if (spendable <= 0) return 0;

  const netDrain = monthlyBurn - monthlyRevenue;
  if (netDrain <= 0) return Infinity; // revenue covers burn

  return spendable / netDrain;
}

/**
 * Is a fixed-price package actually worth delivering?
 *
 * The trap in productized services is selling a fixed price against unbounded
 * effort. This converts a package into an effective hourly rate so it can be
 * compared against the rate below which the work is not worth doing.
 */
export function packageEconomics({
  name = 'package',
  price,
  deliveryHours,
  directCost = 0,
  targetHourly = 0,
}) {
  need('price', price, { min: 0 });
  need('deliveryHours', deliveryHours, { min: 0 });
  need('directCost', directCost, { min: 0 });
  need('targetHourly', targetHourly, { min: 0 });

  if (deliveryHours === 0) {
    throw new RangeError('deliveryHours must be > 0; a package with no effort is not a package');
  }

  const grossProfit = price - directCost;
  const effectiveHourly = grossProfit / deliveryHours;
  const grossMargin = price === 0 ? 0 : grossProfit / price;

  return {
    name,
    price,
    deliveryHours,
    directCost,
    grossProfit,
    grossMargin,
    effectiveHourly,
    meetsTarget: effectiveHourly >= targetHourly,
    // How far delivery can overrun before the package stops clearing the target.
    overrunHoursAllowed:
      targetHourly <= 0 ? Infinity : Math.max(0, grossProfit / targetHourly - deliveryHours),
  };
}

/**
 * How many retainer clients are needed to stop the bleeding.
 *
 * Contribution is per-client revenue minus the cost of serving that client, so
 * this is the real break-even count, not a revenue-divided-by-price guess.
 */
export function breakEvenClients({ monthlyBurn, retainerPrice, retainerDirectCost = 0 }) {
  need('monthlyBurn', monthlyBurn, { min: 0 });
  need('retainerPrice', retainerPrice, { min: 0 });
  need('retainerDirectCost', retainerDirectCost, { min: 0 });

  const contribution = retainerPrice - retainerDirectCost;
  if (contribution <= 0) {
    // No number of these clients will ever cover burn; each one loses money.
    return { contribution, clientsNeeded: Infinity, viable: false };
  }
  return {
    contribution,
    clientsNeeded: Math.ceil(monthlyBurn / contribution),
    viable: true,
  };
}

/**
 * Month-by-month cash projection.
 *
 * Retainers churn before new ones land, which is the pessimistic ordering — a
 * client who leaves in month N does not pay in month N. Projects are one-off.
 */
export function project({
  openingBalance,
  months,
  monthlyBurn,
  floor = 0,
  startingRetainers = 0,
  retainerPrice = 0,
  retainerDirectCost = 0,
  newRetainersPerMonth = 0,
  monthlyChurnRate = 0,
  projectsPerMonth = 0,
  projectPrice = 0,
  projectDirectCost = 0,
}) {
  need('openingBalance', openingBalance);
  need('months', months, { min: 1 });
  need('monthlyBurn', monthlyBurn, { min: 0 });
  need('floor', floor, { min: 0 });
  need('startingRetainers', startingRetainers, { min: 0 });
  need('retainerPrice', retainerPrice, { min: 0 });
  need('retainerDirectCost', retainerDirectCost, { min: 0 });
  need('newRetainersPerMonth', newRetainersPerMonth, { min: 0 });
  need('monthlyChurnRate', monthlyChurnRate, { min: 0 });
  need('projectsPerMonth', projectsPerMonth, { min: 0 });
  need('projectPrice', projectPrice, { min: 0 });
  need('projectDirectCost', projectDirectCost, { min: 0 });

  if (monthlyChurnRate > 1) {
    throw new RangeError(`monthlyChurnRate is a fraction 0..1, got ${monthlyChurnRate}`);
  }

  const horizon = Math.floor(months);
  let balance = openingBalance;
  let retainers = startingRetainers;
  const rows = [];

  let ruinMonth = null;
  let breakEvenMonth = null;
  let lowestBalance = openingBalance;

  for (let m = 1; m <= horizon; m += 1) {
    retainers = retainers * (1 - monthlyChurnRate);
    retainers += newRetainersPerMonth;

    const retainerRevenue = retainers * retainerPrice;
    const projectRevenue = projectsPerMonth * projectPrice;
    const revenue = retainerRevenue + projectRevenue;

    const variableCost = retainers * retainerDirectCost + projectsPerMonth * projectDirectCost;
    const costs = monthlyBurn + variableCost;

    const net = revenue - costs;
    balance += net;

    if (net >= 0 && breakEvenMonth === null) breakEvenMonth = m;
    if (balance < lowestBalance) lowestBalance = balance;
    if (balance < floor && ruinMonth === null) ruinMonth = m;

    rows.push({
      month: m,
      retainers,
      revenue,
      costs,
      net,
      balance,
      belowFloor: balance < floor,
    });
  }

  return {
    rows,
    endingBalance: balance,
    lowestBalance,
    ruinMonth,          // first month cash dropped below the floor, or null
    breakEvenMonth,     // first month the business covered its own costs, or null
    survives: ruinMonth === null,
  };
}
