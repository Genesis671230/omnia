import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import {
  agingByGateway,
  feeBurnByGateway,
  settlementTimeline,
  exceptionsByGateway,
  fxDriftRows,
  type InsightLine,
} from "@/lib/reconciliation/insights";

// A minimal line. Every test overrides only what it is actually asserting on,
// so a failure points at one field rather than at fixture drift.
function line(over: Partial<InsightLine> = {}): InsightLine {
  return {
    id: "b1",
    provider: "Tabby",
    date: "2026-07-20T00:00:00",
    bankAmount: 1000,
    state: "AWAITING_PAYOUT",
    variance: 0,
    unresolvedRefs: [],
    transactions: [],
    payout: null,
    rateDriftAed: null,
    fxFeeAed: null,
    ...over,
  };
}

const NOW = new Date("2026-07-23T12:00:00Z").getTime();

describe("agingByGateway", () => {
  test("only AWAITING_PAYOUT money counts as in transit", () => {
    const rows = agingByGateway(
      [
        line({ state: "AWAITING_PAYOUT", bankAmount: 100 }),
        line({ state: "SETTLED", bankAmount: 999 }),
        line({ state: "PAYOUT_VARIANCE", bankAmount: 888 }),
      ],
      NOW,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total, 100);
  });

  test("bucket boundaries: day 7 is still fresh, day 8 is not", () => {
    const at = (days: number) =>
      line({ date: new Date(NOW - days * 86_400_000).toISOString(), bankAmount: 10 });
    const rows = agingByGateway([at(0), at(7), at(8), at(14), at(15), at(90)], NOW);
    const b = rows[0].buckets;
    assert.equal(b["0-7"], 20, "day 0 and day 7 both land in 0-7");
    assert.equal(b["8-14"], 20, "day 8 and day 14 both land in 8-14");
    assert.equal(b["15+"], 20, "day 15 and day 90 both land in 15+");
  });

  test("a credit with no date cannot be aged, so it lands in the oldest bucket", () => {
    // Silently dropping it would understate cash in transit — the one number
    // this view exists to state correctly.
    const rows = agingByGateway([line({ date: null, bankAmount: 50 })], NOW);
    assert.equal(rows[0].buckets["15+"], 50);
    assert.equal(rows[0].undated, 1);
  });

  test("gateways are ordered by money held, largest first", () => {
    const rows = agingByGateway(
      [
        line({ provider: "Tabby", bankAmount: 100 }),
        line({ provider: "Tamara", bankAmount: 500 }),
        line({ provider: "COD", bankAmount: 300 }),
      ],
      NOW,
    );
    assert.deepEqual(rows.map((r) => r.gateway), ["Tamara", "COD", "Tabby"]);
  });

  test("empty input yields no rows, not a zero row", () => {
    assert.deepEqual(agingByGateway([], NOW), []);
  });
});

describe("feeBurnByGateway", () => {
  const withTxns = (provider: string, gross: number, fee: number) =>
    line({
      provider,
      state: "SETTLED",
      transactions: [
        { ref: "A1", grossShare: gross, feeShare: fee, netShare: gross - fee, isRefund: false, quality: null },
      ],
    });

  test("effective rate is fee over gross, summed across the gateway", () => {
    const rows = feeBurnByGateway([withTxns("Tabby", 1000, 60), withTxns("Tabby", 1000, 40)]);
    assert.equal(rows[0].gross, 2000);
    assert.equal(rows[0].fee, 100);
    assert.equal(rows[0].ratePct, 5);
  });

  test("a gateway with no per-order breakdown reports no data, not 0%", () => {
    // Telr's xls carries no per-order fees. Rendering that as "0% fees" would
    // read as the cheapest gateway when it is really the least visible one.
    const rows = feeBurnByGateway([line({ provider: "Telr", state: "SETTLED", transactions: [] })]);
    assert.equal(rows[0].hasData, false);
    assert.equal(rows[0].ratePct, null);
  });

  test("zero gross does not divide by zero", () => {
    const rows = feeBurnByGateway([withTxns("COD", 0, 0)]);
    assert.equal(rows[0].ratePct, null);
    assert.equal(Number.isFinite(rows[0].fee), true);
  });

  test("refunds reduce gross and fee rather than being counted as sales", () => {
    const rows = feeBurnByGateway([
      line({
        provider: "Tamara",
        state: "SETTLED",
        transactions: [
          { ref: "A1", grossShare: 1000, feeShare: 50, netShare: 950, isRefund: false, quality: null },
          { ref: "A2", grossShare: -200, feeShare: -10, netShare: -190, isRefund: true, quality: null },
        ],
      }),
    ]);
    assert.equal(rows[0].gross, 800);
    assert.equal(rows[0].fee, 40);
  });
});

describe("settlementTimeline", () => {
  test("credits roll up per calendar day, split by state", () => {
    const rows = settlementTimeline([
      line({ date: "2026-07-20T09:00:00", state: "SETTLED", bankAmount: 100 }),
      line({ date: "2026-07-20T18:00:00", state: "AWAITING_PAYOUT", bankAmount: 50 }),
      line({ date: "2026-07-21T09:00:00", state: "PAYOUT_VARIANCE", bankAmount: 25 }),
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { date: "2026-07-20", settled: 100, awaiting: 50, exception: 0, total: 150, count: 2 });
    assert.equal(rows[1].exception, 25);
  });

  test("both exception states collapse into one exception band", () => {
    const rows = settlementTimeline([
      line({ date: "2026-07-20T00:00:00", state: "PAYOUT_VARIANCE", bankAmount: 10 }),
      line({ date: "2026-07-20T00:00:00", state: "ORDERS_UNRESOLVED", bankAmount: 15 }),
    ]);
    assert.equal(rows[0].exception, 25);
  });

  test("undated credits are excluded — a timeline cannot place them", () => {
    const rows = settlementTimeline([line({ date: null, bankAmount: 99 })]);
    assert.deepEqual(rows, []);
  });

  test("days come back in chronological order regardless of input order", () => {
    const rows = settlementTimeline([
      line({ date: "2026-07-22T00:00:00" }),
      line({ date: "2026-07-01T00:00:00" }),
      line({ date: "2026-07-11T00:00:00" }),
    ]);
    assert.deepEqual(rows.map((r) => r.date), ["2026-07-01", "2026-07-11", "2026-07-22"]);
  });
});

describe("exceptionsByGateway", () => {
  test("variance is summed as absolute exposure, not netted to zero", () => {
    // A +500 surplus and a -500 shortfall are two problems, not none.
    const rows = exceptionsByGateway([
      line({ provider: "Checkout", state: "PAYOUT_VARIANCE", variance: 500 }),
      line({ provider: "Checkout", state: "PAYOUT_VARIANCE", variance: -500 }),
    ]);
    assert.equal(rows[0].varianceAed, 1000);
    assert.equal(rows[0].lineCount, 2);
  });

  test("unresolved order refs are counted across lines", () => {
    const rows = exceptionsByGateway([
      line({ provider: "Stripe", state: "ORDERS_UNRESOLVED", unresolvedRefs: ["WA1", "WA2"] }),
      line({ provider: "Stripe", state: "ORDERS_UNRESOLVED", unresolvedRefs: ["WA3"] }),
    ]);
    assert.equal(rows[0].unresolvedOrders, 3);
  });

  test("settled and awaiting lines are not exceptions", () => {
    assert.deepEqual(
      exceptionsByGateway([line({ state: "SETTLED" }), line({ state: "AWAITING_PAYOUT" })]),
      [],
    );
  });
});

describe("fxDriftRows", () => {
  test("only cross-border lines that actually drifted are listed", () => {
    const rows = fxDriftRows([
      line({ id: "a", rateDriftAed: 120.5, fxFeeAed: 40, payout: { id: "P1", net: 1000, source: null, currency: "SAR", fxRate: 0.98, fxSource: "bank" } }),
      line({ id: "b", rateDriftAed: 0, fxFeeAed: 0, payout: { id: "P2", net: 900, source: null, currency: "AED", fxRate: null, fxSource: null } }),
      line({ id: "c", rateDriftAed: null, fxFeeAed: null, payout: null }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "a");
    assert.equal(rows[0].currency, "SAR");
  });

  test("sub-cent drift is noise, not a finding", () => {
    const rows = fxDriftRows([
      line({ rateDriftAed: 0.004, fxFeeAed: 0, payout: { id: "P", net: 1, source: null, currency: "KWD", fxRate: 12, fxSource: "bank" } }),
    ]);
    assert.deepEqual(rows, []);
  });

  test("largest drift first — that is the one worth opening", () => {
    const mk = (id: string, drift: number) =>
      line({ id, rateDriftAed: drift, fxFeeAed: 0, payout: { id, net: 1, source: null, currency: "SAR", fxRate: 1, fxSource: "bank" } });
    const rows = fxDriftRows([mk("small", 5), mk("big", 900), mk("mid", 100)]);
    assert.deepEqual(rows.map((r) => r.id), ["big", "mid", "small"]);
  });
});
