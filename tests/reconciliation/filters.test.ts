import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { matchesQuery, searchTarget, groupLines, type FilterLine } from "@/lib/reconciliation/filters";

function line(over: Partial<FilterLine> = {}): FilterLine {
  return {
    id: "bank-line-0001",
    date: "2026-07-20T00:00:00",
    narration: "FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC",
    reference: "FT26191GY2RS",
    provider: "Stripe",
    bankAmount: 18243.83,
    state: "SETTLED",
    payout: { id: "STRIPE-po_1Tr64ID9", net: 18243.83, source: "stripe-july.csv", currency: null, fxRate: null, fxSource: null },
    resolvedOrders: ["WA55131", "WA55127"],
    unresolvedRefs: [],
    refundedOrders: [],
    transactions: [],
    reviewFlag: false,
    ...over,
  };
}

describe("matchesQuery", () => {
  test("an empty query matches everything", () => {
    assert.equal(matchesQuery(line(), ""), true);
    assert.equal(matchesQuery(line(), "   "), true);
  });

  test("matches the gateway name", () => {
    assert.equal(matchesQuery(line(), "stripe"), true);
    assert.equal(matchesQuery(line(), "tabby"), false);
  });

  test("matches a bank reference regardless of case", () => {
    assert.equal(matchesQuery(line(), "ft26191gy2rs"), true);
    assert.equal(matchesQuery(line(), "FT26191"), true);
  });

  test("matches an order number in resolvedOrders", () => {
    assert.equal(matchesQuery(line(), "WA55131"), true);
    assert.equal(matchesQuery(line(), "55127"), true);
  });

  test("matches an order number that exists ONLY inside the proof table", () => {
    // The proof table's refs are the per-order breakdown; an order can appear
    // there while resolvedOrders is empty (unresolved / refund cases). Search
    // that misses those sends the reader to "not found" for data on screen.
    const l = line({
      resolvedOrders: [],
      transactions: [{ ref: "WA99999", grossShare: 10, feeShare: 1, netShare: 9, isRefund: false, quality: null }],
    });
    assert.equal(matchesQuery(l, "WA99999"), true);
  });

  test("matches narration text and the payout filename", () => {
    assert.equal(matchesQuery(line(), "network international"), true);
    assert.equal(matchesQuery(line(), "stripe-july.csv"), true);
  });

  test("every whitespace token must match — tokens narrow, they do not widen", () => {
    assert.equal(matchesQuery(line(), "stripe 55131"), true);
    assert.equal(matchesQuery(line(), "stripe 00000"), false, "one failing token fails the row");
    assert.equal(matchesQuery(line(), "tabby 55131"), false);
  });

  test("tokens may match different fields", () => {
    assert.equal(matchesQuery(line(), "ft26191 wa55127"), true);
  });

  test("searchTarget includes refunded and unresolved refs", () => {
    const t = searchTarget(line({ refundedOrders: ["WA700"], unresolvedRefs: ["WA800"] }));
    assert.equal(t.includes("wa700"), true);
    assert.equal(t.includes("wa800"), true);
  });
});

describe("groupLines", () => {
  const set = [
    line({ id: "a", provider: "Stripe", state: "SETTLED", bankAmount: 100, date: "2026-07-20T00:00:00" }),
    line({ id: "b", provider: "Tabby", state: "AWAITING_PAYOUT", bankAmount: 400, date: "2026-07-20T00:00:00" }),
    line({ id: "c", provider: "Tabby", state: "PAYOUT_VARIANCE", bankAmount: 50, date: "2026-07-21T00:00:00" }),
  ];

  test("group 'none' returns one group holding everything", () => {
    const groups = groupLines(set, "none");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].lines.length, 3);
    assert.equal(groups[0].total, 550);
  });

  test("every line lands in exactly one group", () => {
    for (const mode of ["gateway", "date", "status", "none"] as const) {
      const ids = groupLines(set, mode).flatMap((g) => g.lines.map((l) => l.id)).sort();
      assert.deepEqual(ids, ["a", "b", "c"], `mode ${mode}`);
    }
  });

  test("subtotals equal the sum of the group's own lines", () => {
    for (const g of groupLines(set, "gateway")) {
      assert.equal(g.total, g.lines.reduce((s, l) => s + l.bankAmount, 0));
      assert.equal(g.count, g.lines.length);
    }
  });

  test("gateway groups are ordered by money, largest first", () => {
    assert.deepEqual(groupLines(set, "gateway").map((g) => g.key), ["Tabby", "Stripe"]);
  });

  test("date groups are newest first", () => {
    assert.deepEqual(groupLines(set, "date").map((g) => g.key), ["2026-07-21", "2026-07-20"]);
  });

  test("the state split adds up to the group total", () => {
    const tabby = groupLines(set, "gateway").find((g) => g.key === "Tabby")!;
    assert.equal(tabby.settled + tabby.awaiting + tabby.exception, tabby.total);
    assert.equal(tabby.awaiting, 400);
    assert.equal(tabby.exception, 50);
  });

  test("undated lines group together rather than disappearing", () => {
    const groups = groupLines([line({ id: "z", date: null })], "date");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].lines.length, 1);
  });

  test("empty input yields no groups", () => {
    assert.deepEqual(groupLines([], "gateway"), []);
  });
});
