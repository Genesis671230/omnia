// COD orders: the sale is booked in House of Omnia (the COD org) as an invoice
// to a customer named "<order no> <name>" (INV-005246 "OS4313 Temitope Adisa").
// In every other org (Omniastores LLC) the order's sales order and invoice
// exist only to move stock, so they must total AED 0. The close flows do that
// (so-plan codZero), but an invoice raised by hand in Zoho at full value
// (OS4349, MNS-054523, 2026-10-10) bypasses them. This finds those and zeroes
// them: every line's rate and discount → 0, items / quantities / warehouses /
// batches kept, so the stock movement is unchanged. Only unpaid, uncredited
// invoices are touched. Callers run it inside withZohoOrg(<the non-COD org>).

import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoBooksBase, zohoOrgId } from "@/lib/integrations/zoho-context";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
import { findSalesOrdersByNumber, getSalesOrder, invoicesForReference, updateSalesOrder } from "./zoho-so";

type Json = Record<string, unknown> & { code?: number; message?: string };

async function books(method: "GET" | "PUT", path: string, body?: unknown): Promise<Json> {
  const token = await getAccessToken();
  const url = new URL(`${zohoBooksBase()}${path}`);
  url.searchParams.set("organization_id", zohoOrgId());
  const res = await zohoThrottledFetch(url.toString(), {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || (json.code !== undefined && json.code !== 0)) throw new Error(`Zoho ${method} ${path.split("?")[0]} (code ${json.code}): ${json.message ?? res.status}`);
  return json;
}

type InvLine = {
  line_item_id: string; item_id?: string; name?: string; description?: string; quantity: number; rate: number;
  discount?: number | string; tax_id?: string; warehouse_id?: string; unit?: string;
  batches?: { batch_id: string; batch_number?: string; out_quantity: number }[];
};
type Invoice = {
  invoice_id: string; invoice_number: string; status: string; total: number; balance: number; customer_id: string;
  line_items: InvLine[]; payments?: unknown[]; credits_applied?: number;
};

export type CodZeroCheck = {
  orderNumber: string;
  invoice: { id: string; number: string; status: string; total: number } | null;
  salesorder: { id: string; status: string; total: number } | null;
  /** "ok" = already 0 / nothing to do · "fix" = can be zeroed · "blocked" = needs a person */
  state: "ok" | "fix" | "blocked";
  reason: string;
};

/** Read-only: does this COD order's invoice in the current (non-COD) org need zeroing? */
export async function checkCodZero(orderNumber: string): Promise<CodZeroCheck & { body?: Record<string, unknown> }> {
  const [so] = await findSalesOrdersByNumber(orderNumber);
  const salesorder = so ? { id: so.salesorder_id, status: so.status, total: so.total } : null;
  const refs = await invoicesForReference(orderNumber);
  const base = { orderNumber, salesorder };
  if (refs.length === 0) {
    return { ...base, invoice: null, state: salesorder && salesorder.total > 0 && salesorder.status !== "draft" ? "blocked" : "ok", reason: salesorder ? `no invoice yet — the sales order (${salesorder.status}, AED ${salesorder.total}) closes at AED 0 through the COD rule` : "no sales order or invoice here" };
  }
  if (refs.length > 1) return { ...base, invoice: null, state: "blocked", reason: `${refs.length} invoices carry ${orderNumber} — pick by hand` };
  const inv = (await books("GET", `/invoices/${refs[0].invoice_id}`)).invoice as Invoice;
  const invoice = { id: inv.invoice_id, number: inv.invoice_number, status: inv.status, total: Number(inv.total) };
  if (Number(inv.total) === 0) return { ...base, invoice, state: "ok", reason: `${inv.invoice_number} is already AED 0` };
  if ((inv.payments?.length ?? 0) > 0 || Number(inv.credits_applied ?? 0) > 0 || Number(inv.balance) !== Number(inv.total)) {
    return { ...base, invoice, state: "blocked", reason: `${inv.invoice_number} has payments or credits applied — remove them first` };
  }
  if (inv.status === "void") return { ...base, invoice, state: "blocked", reason: `${inv.invoice_number} is void` };
  const body = {
    customer_id: inv.customer_id,
    line_items: inv.line_items.map((l) => ({
      line_item_id: l.line_item_id, ...(l.item_id ? { item_id: l.item_id } : {}), ...(l.name ? { name: l.name } : {}),
      description: l.description ?? "", quantity: l.quantity, rate: 0, discount: 0,
      ...(l.tax_id ? { tax_id: l.tax_id } : {}), ...(l.warehouse_id ? { warehouse_id: l.warehouse_id } : {}), ...(l.unit ? { unit: l.unit } : {}),
      ...(l.batches?.length ? { batches: l.batches.map((b) => ({ batch_id: b.batch_id, out_quantity: b.out_quantity })) } : {}),
    })),
    reason: "COD order — the sale is booked in House of Omnia; this invoice only moves stock (AED 0)",
  };
  return { ...base, invoice, state: "fix", reason: `${inv.invoice_number} is AED ${inv.total} — will become AED 0 (items, quantities, warehouses and batches kept)`, body };
}

/** Live: zero the invoice (and the sales order's lines when Zoho allows it), then read back. */
export async function applyCodZero(orderNumber: string): Promise<CodZeroCheck & { steps: string[] }> {
  const c = await checkCodZero(orderNumber);
  const steps: string[] = [];
  if (c.state !== "fix" || !c.body || !c.invoice) return { ...c, steps: [c.reason] };
  await books("PUT", `/invoices/${c.invoice.id}`, c.body);
  const after = (await books("GET", `/invoices/${c.invoice.id}`)).invoice as Invoice;
  steps.push(`invoice ${after.invoice_number}: AED ${c.invoice.total} → AED ${after.total} (${after.status})`);
  if (c.salesorder && c.salesorder.total > 0) {
    try {
      const so = await getSalesOrder(c.salesorder.id);
      const updated = await updateSalesOrder(so.salesorder_id, {
        customer_id: so.customer_id,
        line_items: so.line_items.map((l) => ({ line_item_id: l.line_item_id, item_id: l.item_id, quantity: l.quantity, rate: 0, discount: 0, ...(l.tax_id ? { tax_id: l.tax_id } : {}), ...(l.warehouse_id ? { warehouse_id: l.warehouse_id } : {}) })),
      });
      steps.push(`sales order: AED ${c.salesorder.total} → AED ${updated.total}`);
    } catch (e) {
      steps.push(`sales order left at AED ${c.salesorder.total} — Zoho refused the edit: ${(e as Error).message}`);
    }
  }
  return { ...c, invoice: { id: after.invoice_id, number: after.invoice_number, status: after.status, total: Number(after.total) }, state: Number(after.total) === 0 ? "ok" : "blocked", steps };
}
