import { test } from "node:test";
import assert from "node:assert/strict";

function fakeSupabase(existingRows: { month_key: string; spreadsheet_id: string; label: string; created_at: string }[]) {
  const state = { rows: [...existingRows] };
  return {
    state,
    from(table: string) {
      assert.equal(table, "payment_sheet_months");
      return {
        select() {
          return {
            order() {
              return Promise.resolve({ data: state.rows, error: null });
            },
          };
        },
        upsert(row: { month_key: string; spreadsheet_id: string; label: string }, _opts: unknown) {
          state.rows = state.rows.filter((r) => r.month_key !== row.month_key);
          state.rows.push({ ...row, created_at: new Date().toISOString() });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(_col: string, monthKey: string) {
              state.rows = state.rows.filter((r) => r.month_key !== monthKey);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test("list/upsert/remove round-trip through the fake client, ordered by month_key", async () => {
  const fake = fakeSupabase([{ month_key: "2026-08", spreadsheet_id: "old-id", label: "August 2026", created_at: "2026-08-01T00:00:00.000Z" }]);
  const { makePaymentSheetMonthsRepository } = await import("@/lib/repositories/payment-sheet-months.repository");
  const repo = makePaymentSheetMonthsRepository(fake as any);

  await repo.upsert("2026-09", "sept-id", "September 2026");
  const afterUpsert = await repo.list();
  assert.equal(afterUpsert.length, 2);
  assert.ok(afterUpsert.some((m) => m.monthKey === "2026-09" && m.spreadsheetId === "sept-id"));

  await repo.remove("2026-08");
  const afterRemove = await repo.list();
  assert.deepEqual(afterRemove.map((m) => m.monthKey), ["2026-09"]);
});
