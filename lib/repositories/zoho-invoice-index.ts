// Zoho invoices indexed by order number — what the Dispatch page shows as the
// "verified" amount. Written from a Zoho read (refresh button, month check);
// read by every page load.

import { supabase } from "@/lib/supabase";
import { orderNumberOf, type ZohoDoc } from "@/lib/finance/zoho-sales-verify";
import type { InvoiceIndex } from "@/lib/dispatch/three-way";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";
const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();

export const ZohoInvoiceIndexRepository = {
  /** Upsert every invoice in `docs` (other kinds ignored). Void ones are kept with their status. */
  async upsertFromDocs(docs: ZohoDoc[]): Promise<number> {
    const rows = docs.filter((d) => d.kind === "invoice").map((d) => ({
      invoice_id: d.id, tenant_id: TENANT, org: d.org, invoice_number: d.number, order_number: orderNumberOf(d),
      invoice_date: d.date || null, status: d.status, total: d.total, customer: d.customer, updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("zoho_invoice_index").upsert(rows.slice(i, i + 500), { onConflict: "invoice_id" });
      if (error) throw new Error(`zoho_invoice_index write failed: ${error.message}`);
    }
    return rows.length;
  },

  /** Live (non-void, non-draft) invoices for these order numbers, summed per order. */
  async forOrders(orderNumbers: string[]): Promise<InvoiceIndex> {
    const out: InvoiceIndex = new Map();
    const keys = [...new Set(orderNumbers.map(norm).filter(Boolean))];
    for (let i = 0; i < keys.length; i += 300) {
      const { data, error } = await supabase.from("zoho_invoice_index")
        .select("invoice_number, order_number, total, status, org").in("order_number", keys.slice(i, i + 300));
      if (error) throw new Error(`zoho_invoice_index read failed: ${error.message}`);
      for (const r of data ?? []) {
        if (r.status === "void" || r.status === "draft") continue;
        const k = norm(r.order_number);
        const cur = out.get(k) ?? { numbers: [] as string[], totalAed: 0, org: String(r.org) };
        cur.numbers.push(String(r.invoice_number));
        cur.totalAed += Number(r.total) || 0;
        out.set(k, cur);
      }
    }
    return out;
  },

  async lastUpdated(): Promise<string | null> {
    const { data } = await supabase.from("zoho_invoice_index").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    return (data?.updated_at as string | undefined) ?? null;
  },
};
