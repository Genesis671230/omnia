import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { addDubaiDays, dubaiDayBoundsUtc } from "@/lib/dubai-day";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { fetchSalesDocs } from "@/lib/integrations/zoho-sales-docs";
import { verifyMonthSales, type VerifyOrder } from "@/lib/finance/zoho-sales-verify";
import { zohoConfigured } from "@/lib/integrations/zoho";
import { ZohoInvoiceIndexRepository } from "@/lib/repositories/zoho-invoice-index";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET  /api/finance/zoho-sales-verify?month=YYYY-MM → { verification, checkedAt } (stored; no Zoho call)
// POST /api/finance/zoho-sales-verify?month=YYYY-MM → reads Zoho (sales orders,
//      invoices, credit notes in every org), compares with the month's counted
//      sales, stores and returns the result.
const MONTH = /^\d{4}-\d{2}$/;

function bounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { fromDay: `${month}-01`, toDay: `${month}-${String(last).padStart(2, "0")}` };
}

export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const { data, error } = await supabase.from("zoho_sales_verifications").select("*").eq("month", month).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ verification: data?.result ?? null, checkedAt: data?.checked_at ?? null, orgs: data?.orgs ?? [], zohoCalls: data?.zoho_calls ?? 0 });
}

export async function POST(req: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const { fromDay, toDay } = bounds(month);
  try {
    // Zoho documents are often dated a day or two after the order; orders a
    // little before the month are read so their invoices aren't "orphans".
    const [orders, zoho] = await Promise.all([
      OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(addDubaiDays(fromDay, -10)).fromUtc, to: dubaiDayBoundsUtc(addDubaiDays(toDay, 3)).toUtc }),
      fetchSalesDocs(addDubaiDays(fromDay, -3), addDubaiDays(toDay, 7)),
    ]);
    const failed = zoho.orgs.filter((o) => o.error);
    if (failed.length && failed.length === zoho.orgs.length) {
      return NextResponse.json({ error: `Zoho couldn't be read: ${failed.map((o) => `${o.label}: ${o.error}`).join(" · ")}` }, { status: 502 });
    }
    // The same read feeds the Dispatch page's verified amounts.
    await ZohoInvoiceIndexRepository.upsertFromDocs(zoho.docs).catch(() => 0);
    const verification = verifyMonthSales({ fromDay, toDay, orders: orders as unknown as VerifyOrder[], docs: zoho.docs });
    const checkedAt = new Date().toISOString();
    const { error } = await supabase.from("zoho_sales_verifications").upsert({
      month, result: verification, zoho_calls: zoho.calls, orgs: zoho.orgs, checked_at: checkedAt,
    }, { onConflict: "month" });
    if (error) throw new Error(`saving the verification failed: ${error.message}`);
    return NextResponse.json({ verification, checkedAt, orgs: zoho.orgs, zohoCalls: zoho.calls });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
