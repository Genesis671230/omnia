// Pure logic, no Supabase import — kept separate from orders.repository.ts
// so it's testable without a live DB (matches this repo's convention: no
// Supabase mocks exist anywhere, DB-touching glue gets manual verification,
// pure decisions get unit tests).
import type { OrderRow } from "@/lib/normalize/order";

type SyncRow = Omit<OrderRow, "payout_status">;
type SyncRowNoCourier = Omit<SyncRow, "courier" | "tracking_number" | "tracking_url">;

// Rows whose uid already has an awb_number recorded — this app's own SMSA
// ship flow has taken over fulfillment for them, so a re-sync must not let
// the store's raw courier/tracking data overwrite that. Return type is a
// genuine union (not Omit<OrderRow, "payout_status"> with courier claimed
// present in both branches) so `"courier" in result` actually narrows
// instead of TS treating the "absent" branch as unreachable.
export function dropClobberRiskFields(
  row: OrderRow,
  shippedUids: Set<string>,
): SyncRow | SyncRowNoCourier {
  const { payout_status: _p, ...rest } = row;
  if (!shippedUids.has(row.uid)) return rest;
  const { courier: _c, tracking_number: _t, tracking_url: _u, ...safe } = rest;
  return safe;
}
