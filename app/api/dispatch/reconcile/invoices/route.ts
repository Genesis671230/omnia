import { NextResponse } from "next/server";
import { addDubaiDays } from "@/lib/dubai-day";
import { fetchSalesDocs } from "@/lib/integrations/zoho-sales-docs";
import { ZohoInvoiceIndexRepository } from "@/lib/repositories/zoho-invoice-index";
import { zohoConfigured } from "@/lib/integrations/zoho";

export const maxDuration = 120;

// POST /api/dispatch/reconcile/invoices?from=&to= — re-reads Zoho INVOICES
// (both orgs, a few days either side) into zoho_invoice_index. ~5–10 calls a month.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to)) return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  try {
    const z = await fetchSalesDocs(addDubaiDays(from, -3), addDubaiDays(to, 7), ["invoice"]);
    const failed = z.orgs.filter((o) => o.error);
    if (failed.length === z.orgs.length && failed.length) return NextResponse.json({ error: failed.map((o) => `${o.label}: ${o.error}`).join(" · ") }, { status: 502 });
    const n = await ZohoInvoiceIndexRepository.upsertFromDocs(z.docs);
    return NextResponse.json({ invoices: n, zohoCalls: z.calls, orgs: z.orgs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
