import { NextResponse } from "next/server";
import { listZohoConnections, withZohoOrg } from "@/lib/integrations/zoho-org";
import { findSalesOrdersByNumber, invoicesForReference } from "@/lib/sales-orders/zoho-so";
import { applyCodZero, checkCodZero } from "@/lib/sales-orders/cod-zero";
import { supabase } from "@/lib/supabase";
import { findOrderInvoices } from "@/lib/orders/order-adjustment.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/sales-orders/cod-zero { order, apply?: true }
//   COD order closed at full value outside House of Omnia → its invoice (and
//   sales order) set to AED 0, stock movement kept. Without apply: dry run.
//   Only COD orders; never the COD org itself. Refused while House of Omnia has
//   no invoice for the order: zeroing then would leave the sale booked nowhere
//   (WA56007/WA56030/WA56033 in Oct 2026 are booked only in Omniastores).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { order?: string; apply?: boolean };
  const order = String(b.order ?? "").trim().toUpperCase();
  if (!order) return NextResponse.json({ error: "order is required" }, { status: 400 });
  const { data: o } = await supabase.from("orders").select("gateway").eq("order_number", order).maybeSingle();
  if ((o?.gateway ?? "").trim().toUpperCase() !== "COD") return NextResponse.json({ error: `${order} is not a COD order` }, { status: 400 });
  try {
    const all = (await listZohoConnections()).filter((c) => c.status !== "disabled");
    const codOrg = all.find((c) => c.defaultForProviders.some((p) => p.toUpperCase() === "COD"));
    const { candidates } = await findOrderInvoices({ order_number: order, gateway: "COD" });
    const booked = candidates.filter((c) => c.connectionId === codOrg?.id && c.total > 0);
    const codNote = booked.length ? `${codOrg!.label} has ${booked.map((c) => `${c.number} (AED ${c.total})`).join(", ")}` : null;
    const conns = all.filter((c) => c.id !== codOrg?.id);
    for (const c of conns) {
      const found = await withZohoOrg(c.id, async () => (await findSalesOrdersByNumber(order)).length > 0 || (await invoicesForReference(order)).length > 0);
      if (!found) continue;
      if (!booked.length) {
        const c0 = await withZohoOrg(c.id, () => checkCodZero(order));
        const { body: _b, ...rest0 } = c0 as typeof c0 & { body?: unknown };
        return NextResponse.json({ org: c.label, applied: false, ...rest0, state: c0.state === "ok" ? "ok" : "blocked",
          reason: c0.state === "ok" ? c0.reason : `${codOrg?.label ?? "The COD organisation"} has no invoice for ${order} yet — create it first; zeroing now would leave the sale booked nowhere` });
      }
      const result = await withZohoOrg(c.id, () => (b.apply ? applyCodZero(order) : checkCodZero(order)));
      const { body: _body, ...rest } = result as typeof result & { body?: unknown };
      return NextResponse.json({ org: c.label, applied: Boolean(b.apply), ...rest, reason: `${rest.reason}${codNote ? ` · ${codNote}` : ""}` });
    }
    return NextResponse.json({ error: `${order}: no sales order or invoice outside the COD organisation` }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
