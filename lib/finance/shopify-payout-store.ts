// Which Shopify store an uploaded Shopify Payments export belongs to.
//
// The export never names the store, but the order numbers in it do: UAE and
// WA use bare numbers (#3439), KSA "SA…", Main "OS…", and every one of them is
// already in the orders table with its store_id. Majority vote over the refs
// decides; the settlement currency (SAR → KSA) is the fallback for a file
// whose orders haven't synced yet. Never guessed beyond that — a payout keyed
// to the wrong store would collide with, or duplicate, the API's own row.

import { supabase } from "@/lib/supabase";
import { SHOPIFY_UNKNOWN_STORE, withShopifyStore, type ParsedPayout } from "@/lib/parsers/payouts";

const SHOPIFY_STORES = ["UAE", "KSA", "WA", "MAIN"];

/** Pure: pick the store from the store_ids the file's order numbers resolved to. */
export function pickShopifyStore(
  orderStores: string[],
  currency: string | undefined,
): string | null {
  const votes = new Map<string, number>();
  for (const s of orderStores) if (SHOPIFY_STORES.includes(s)) votes.set(s, (votes.get(s) ?? 0) + 1);
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0 && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) return ranked[0][0];
  if ((currency || "").toUpperCase() === "SAR") return "KSA";
  return null;
}

export async function assignShopifyStores(payouts: ParsedPayout[], storeHint?: string | null): Promise<ParsedPayout[]> {
  const out: ParsedPayout[] = [];
  for (const p of payouts) {
    if (p.provider !== "Shopify Payments" || !p.id.includes(`-${SHOPIFY_UNKNOWN_STORE}-`)) {
      out.push(p);
      continue;
    }
    let store = storeHint && SHOPIFY_STORES.includes(storeHint) ? storeHint : null;
    if (!store) {
      const refs = p.orderRefs.slice(0, 300);
      const { data, error } = refs.length
        ? await supabase.from("orders").select("store_id, order_number").in("order_number", refs).in("store_id", SHOPIFY_STORES)
        : { data: [], error: null };
      if (error) throw new Error(`store lookup failed: ${error.message}`);
      store = pickShopifyStore((data ?? []).map((r) => r.store_id), p.originalCurrency ?? "AED");
    }
    if (!store) {
      throw new Error(
        "Couldn't tell which Shopify store this payout export belongs to — none of its orders are synced yet. " +
          "Pick the store and upload again.",
      );
    }
    out.push(withShopifyStore(p, store));
  }
  return out;
}
