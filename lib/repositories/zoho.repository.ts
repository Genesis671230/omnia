import { supabase } from "@/lib/supabase";
import type { ZohoItem, ZohoSalesOrder } from "@/lib/integrations/zoho";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export const ZohoRepository = {
  async upsertItems(items: ZohoItem[]): Promise<number> {
    if (items.length === 0) return 0;
    const rows = items.map((i) => ({
      item_id: i.item_id,
      tenant_id: TENANT,
      sku: i.sku ?? "",
      name: i.name ?? "",
      stock_on_hand: i.stock_on_hand ?? 0,
      available_stock: i.available_stock ?? 0,
      rate: i.rate ?? 0,
      purchase_rate: i.purchase_rate ?? 0,
      status: i.status ?? "",
      synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("zoho_items").upsert(rows, { onConflict: "item_id" });
    if (error) throw new Error(`zoho_items upsert failed: ${error.message}`);
    return rows.length;
  },

  async upsertOrders(orders: ZohoSalesOrder[]): Promise<number> {
    if (orders.length === 0) return 0;
    const rows = orders.map((o) => ({
      salesorder_id: o.salesorder_id,
      tenant_id: TENANT,
      salesorder_number: o.salesorder_number ?? "",
      reference_number: o.reference_number ?? "",
      status: o.status ?? "",
      order_status: o.order_status ?? "",
      total: o.total ?? 0,
      order_date: o.date || null,
      synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("zoho_orders").upsert(rows, { onConflict: "salesorder_id" });
    if (error) throw new Error(`zoho_orders upsert failed: ${error.message}`);
    return rows.length;
  },

  // Supabase caps a select at 1000 rows — page through the full item book.
  async listItems(): Promise<{ sku: string; name: string; stock_on_hand: number; available_stock: number; status: string }[]> {
    const PAGE = 1000;
    const rows: { sku: string; name: string; stock_on_hand: number; available_stock: number; status: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("zoho_items")
        .select("sku, name, stock_on_hand, available_stock, status")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`zoho_items select failed: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },

  async listOrders(): Promise<{ salesorder_number: string; reference_number: string; order_status: string }[]> {
    const PAGE = 1000;
    const rows: { salesorder_number: string; reference_number: string; order_status: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("zoho_orders")
        .select("salesorder_number, reference_number, order_status")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`zoho_orders select failed: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },
};
