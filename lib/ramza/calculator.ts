// Pure arithmetic behind the value calculator. No benchmarks, no assumed
// recovery rates, no industry averages — every output is a function of the
// four numbers the visitor typed. Kept separate from the component so the
// arithmetic is unit-testable and so it is obvious at a glance that nothing
// here is invented.

export type CalcInput = {
  ordersPerMonth: number;
  gateways: number;
  hoursPerMonth: number;
  hourlyCostAed: number;
};

export type CalcResult = {
  /** Order lines that have to be tied to a bank credit each month. */
  matchesPerMonth: number;
  matchesPerYear: number;
  hoursPerYear: number;
  /** Hours priced at the visitor's own stated cost of that time. */
  monthlyCostAed: number;
  annualCostAed: number;
  /** Whole working days a year, at 8h, spent reconciling. */
  workingDaysPerYear: number;
  /** Seconds per match at the stated pace — a sanity check on their own number. */
  secondsPerMatch: number;
};

const HOURS_PER_WORKING_DAY = 8;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

export function sanitise(input: Partial<CalcInput>): CalcInput {
  return {
    ordersPerMonth: Math.round(clamp(Number(input.ordersPerMonth), 1, 1_000_000)),
    gateways: Math.round(clamp(Number(input.gateways), 1, 20)),
    hoursPerMonth: clamp(Number(input.hoursPerMonth), 0, 744),
    hourlyCostAed: clamp(Number(input.hourlyCostAed), 0, 10_000),
  };
}

export function calculate(raw: Partial<CalcInput>): CalcResult {
  const i = sanitise(raw);

  // One match per order, plus one payout-to-bank reconciliation per gateway
  // per week. Both are stated on the panel so the visitor can see the shape
  // of the estimate rather than being handed a number.
  const payoutReconciliations = i.gateways * 4;
  const matchesPerMonth = i.ordersPerMonth + payoutReconciliations;

  const monthlyCostAed = i.hoursPerMonth * i.hourlyCostAed;
  const hoursPerYear = i.hoursPerMonth * 12;

  return {
    matchesPerMonth,
    matchesPerYear: matchesPerMonth * 12,
    hoursPerYear: +hoursPerYear.toFixed(1),
    monthlyCostAed: +monthlyCostAed.toFixed(2),
    annualCostAed: +(monthlyCostAed * 12).toFixed(2),
    workingDaysPerYear: +(hoursPerYear / HOURS_PER_WORKING_DAY).toFixed(1),
    secondsPerMatch:
      matchesPerMonth > 0 ? +((i.hoursPerMonth * 3600) / matchesPerMonth).toFixed(1) : 0,
  };
}
