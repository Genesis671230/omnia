import { supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/integrations/zoho";
import { logStockEvent } from "@/lib/stock-events";

// NOT called by the auto-reconciler — Zoho is the source of truth for
// stock, we don't correct it programmatically. This exists for:
//  1. Admin "force sync master → Zoho" button
//  2. Fixing detected drift where all 4 stores agree AND ops has confirmed
//     Zoho is wrong (rare, human decision)
//  3. Bulk restock imports
// Every caller must supply a warehouse_id + reason — no defaulting.
export async function pushZoho(
  sku: string,
  targetQuantity: number,
  warehouseId: string,
  reason: string,
): Promise<void> {
  const { data: item, error } = await supabase.from("zoho_items")
    .select("item_id, stock_on_hand")
    .eq("sku", sku).maybeSingle();
  if (error) throw new Error(`zoho_items read: ${error.message}`);
  if (!item) throw new Error(`zoho: no item for SKU ${sku}`);

  // Zoho's inventoryadjustments API works in deltas, not absolutes.
  // Read the current on_hand from cache to compute the delta — if the
  // cache is stale by more than a few units the adjustment will be off,
  // so callers should refresh the item cache immediately before calling.
  const delta = targetQuantity - (item.stock_on_hand ?? 0);
  if (delta === 0) return;

  const token = await getAccessToken();
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;

  const res = await fetch(
    `https://www.zohoapis.com/inventory/v1/inventoryadjustments?organization_id=${orgId}`,
    {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        reason,
        adjustment_type: "quantity",
        line_items: [{
          item_id: item.item_id,
          warehouse_id: warehouseId,
          quantity_adjusted: delta,
        }],
      }),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`zoho push HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`zoho push code ${json.code}: ${json.message}`);

  await logStockEvent({
    sku, source: "zoho", event_type: "reconcile_push",
    new_qty: targetQuantity, delta, correlation: json.inventory_adjustment?.inventory_adjustment_id,
    occurred_at: new Date(), raw: { warehouseId, reason, delta },
  });
}