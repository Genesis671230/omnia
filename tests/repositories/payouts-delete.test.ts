import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal fake mirroring the two .from(...).delete().eq(...) calls
// PayoutsRepository.deletePayout makes — proves call order (transactions
// before the parent row) and that both are scoped to the right id, without
// needing a live Supabase instance.
function fakeSupabase() {
  const calls: { table: string; id: string }[] = [];
  return {
    calls,
    from(table: string) {
      return {
        delete() {
          return {
            eq(_col: string, id: string) {
              calls.push({ table, id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test("deletePayout: deletes payout_transactions before the payouts row, both scoped to the id", async () => {
  const fake = fakeSupabase();
  const { makeDeletePayout } = await import("@/lib/repositories/payouts.repository");
  const deletePayout = makeDeletePayout(fake as any);

  await deletePayout("TELR-123");

  assert.deepEqual(fake.calls, [
    { table: "payout_transactions", id: "TELR-123" },
    { table: "payouts", id: "TELR-123" },
  ]);
});
