import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

// Normalized shape shared by Shopify (variant-level) and WooCommerce
// (product-level) live stock — the sync layer maps each platform's raw
// fetcher output into this before it ever reaches the repository.
export type StoreInventoryRow = {
  storeId: "WA" | "UAE" | "KSA" | "WOO";
  sku: string;
  quantity: number | null;
  productTitle: string;
  productStatus: string;
};

const UPSERT_BATCH = 500;

export const StoreInventoryRepository = {
  async upsertMany(rows: StoreInventoryRow[]): Promise<number> {
    // const withSku = rows.filter((r) => r.sku);
    // if (withSku.length === 0) return 0;

    // // Some catalogs reuse one SKU across multiple variants (e.g. color-only
    // // variants sharing a base SKU) — a single upsert() call can't touch the
    // // same (store_id, sku) row twice, so keep the last-seen quantity per key.
    // const bySkuKey = new Map<string, StoreInventoryRow>();
    // for (const r of withSku) bySkuKey.set(`${r.storeId}|${r.sku}`, r);

    // const dbRows = [...bySkuKey.entries()].map(([id, r]) => ({
    //   id,
    //   tenant_id: TENANT,
    //   store_id: r.storeId,
    //   sku: r.sku,
    //   quantity: r.quantity,
    //   product_title: r.productTitle,
    //   product_status: r.productStatus,
    //   synced_at: new Date().toISOString(),
    // }));

    // for (let i = 0; i < dbRows.length; i += UPSERT_BATCH) {
    //   const chunk = dbRows.slice(i, i + UPSERT_BATCH);
    //   const { error } = await supabase.from("store_inventory").upsert(chunk, { onConflict: "id" });
    //   if (error) throw new Error(`store_inventory upsert failed: ${error.message}`);
    // }
    // return dbRows.length;

    const withSku = rows
  .map((r) => ({ ...r, sku: r.sku.trim() }))
  .filter((r) => r.sku);
if (withSku.length === 0) return 0;

// Dedup on the EXACT id that Postgres will conflict on.
const byId = new Map<string, StoreInventoryRow>();
for (const r of withSku) {
  const id = `${r.storeId}|${r.sku}`;
  byId.set(id, r); // last-write-wins per real id
}

const dbRows = [...byId.entries()].map(([id, r]) => ({
  id,
  tenant_id: TENANT,
  store_id: r.storeId,
  sku: r.sku,
  quantity: r.quantity,
  product_title: r.productTitle,
  product_status: r.productStatus,
  synced_at: new Date().toISOString(),
}));

for (let i = 0; i < dbRows.length; i += UPSERT_BATCH) {
  const chunk = dbRows.slice(i, i + UPSERT_BATCH);
  const { error } = await supabase.from("store_inventory").upsert(chunk, { onConflict: "id" });
  if (error) throw new Error(`store_inventory upsert failed: ${error.message}`);
}
return dbRows.length;
  },

  

  // async upsertMany(rows: StoreInventoryRow[]): Promise<number> {
  //   const map = new Map<
  //     string,
  //     {
  //       id: string;
  //       tenant_id: string;
  //       store_id: string;
  //       sku: string;
  //       quantity: number | null;
  //       product_title: string;
  //       product_status: string;
  //       synced_at: string;
  //     }
  //   >();
  
  //   const now = new Date().toISOString();
  
  //   for (const r of rows) {
  //     const sku = (r.sku ?? "").trim();
  //     if (!sku) continue;
  
  //     const id = `${r.storeId}|${sku}`;
  
  //     map.set(id, {
  //       id,
  //       tenant_id: TENANT,
  //       store_id: r.storeId,
  //       sku,
  //       quantity: r.quantity,
  //       product_title: r.productTitle,
  //       product_status: r.productStatus,
  //       synced_at: now,
  //     });
  //   }
  
  //   const dbRows = [...map.values()];
  
  //   for (let i = 0; i < dbRows.length; i += UPSERT_BATCH) {
  //     const chunk = [...new Map(dbRows.slice(i, i + UPSERT_BATCH).map(r => [r.id, r])).values()];
  
  //     const { error } = await supabase
  //       .from("store_inventory")
  //       .upsert(chunk, { onConflict: "id" });
  
  //     if (error) {
  //       throw new Error(`store_inventory upsert failed: ${error.message}`);
  //     }
  //   }
  
  //   return dbRows.length;
  // },

  // Supabase caps a select at 1000 rows — page through the full snapshot.
  async listAll(): Promise<{ store_id: string; sku: string; quantity: number | null; product_title: string; product_status: string }[]> {
    const PAGE = 1000;
    const rows: { store_id: string; sku: string; quantity: number | null; product_title: string; product_status: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("store_inventory")
        .select("store_id, sku, quantity, product_title, product_status")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`store_inventory select failed: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },
};
