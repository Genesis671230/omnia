import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAllPages } from "@/lib/supabase";

// PostgREST caps an unpaginated select at 1000 rows and reports NO error when
// it truncates — you get 1000 rows and a silently wrong answer.
//
// payout_transactions crossed 1000 (1077 rows) and the reconciler stopped
// seeing the order refs of the most recently uploaded payouts. Files uploaded,
// parsed and stored correctly, then showed zero orders on screen with nothing
// logged anywhere. The credit for AED 16,122.22 sat "Confirmed" with 9 refs in
// the database and 0 orders rendered.

/** A fake table of `total` rows that enforces the same 1000-row page cap. */
function fakeTable(total: number, pageCap = 1000) {
  return (from: number, to: number) => {
    const size = Math.min(to - from + 1, pageCap);
    const data = [];
    for (let i = from; i < Math.min(from + size, total); i++) data.push({ i });
    return Promise.resolve({ data, error: null });
  };
}

test("reads every row of a table larger than one page", async () => {
  const rows = await selectAllPages<{ i: number }>(fakeTable(1077));
  assert.equal(rows.length, 1077, "a single unpaginated read would have stopped at 1000");
  assert.equal(rows[0].i, 0);
  assert.equal(rows[1076].i, 1076);
});

test("no rows are duplicated or skipped across page boundaries", async () => {
  const rows = await selectAllPages<{ i: number }>(fakeTable(2500));
  assert.equal(rows.length, 2500);
  assert.equal(new Set(rows.map((r) => r.i)).size, 2500, "page ranges must not overlap or gap");
});

test("a table smaller than one page takes a single round trip", async () => {
  let calls = 0;
  const rows = await selectAllPages<{ i: number }>((from, to) => {
    calls += 1;
    return fakeTable(42)(from, to);
  });
  assert.equal(rows.length, 42);
  assert.equal(calls, 1, "a short read must not fetch a second, empty page");
});

test("an exactly-full final page is followed by one more read", async () => {
  // The boundary case: 1000 rows looks identical to "truncated" from the
  // client's side, so the loop must ask for page 2 and get an empty answer.
  let calls = 0;
  const rows = await selectAllPages<{ i: number }>((from, to) => {
    calls += 1;
    return fakeTable(1000)(from, to);
  });
  assert.equal(rows.length, 1000);
  assert.equal(calls, 2, "a full page is indistinguishable from truncation — must probe once more");
});

test("an empty table yields an empty array", async () => {
  assert.deepEqual(await selectAllPages<{ i: number }>(fakeTable(0)), []);
});

test("an error on any page is raised, never silently swallowed", async () => {
  await assert.rejects(
    () =>
      selectAllPages<{ i: number }>(
        (from) =>
          from === 0
            ? Promise.resolve({ data: null, error: { message: "boom" } })
            : fakeTable(10)(from, from + 999),
        "payout_transactions select",
      ),
    /payout_transactions select failed: boom/,
  );
});

test("an error on a LATER page still raises, rather than returning partial rows", async () => {
  await assert.rejects(
    () =>
      selectAllPages<{ i: number }>((from, to) =>
        from === 0
          ? fakeTable(5000)(from, to)
          : Promise.resolve({ data: null, error: { message: "page 2 died" } }),
      ),
    /page 2 died/,
    "a partial read is exactly the failure mode this helper exists to prevent",
  );
});
