import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { toAed } from "@/lib/fx";
import { addDubaiDays, dubaiDayBoundsUtc, dubaiDayCount, dubaiMonthBounds, dubaiToday } from "@/lib/dubai-day";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { fetchStoreFunnel } from "@/lib/integrations/shopify-analytics";
import { readDispatchSheets } from "@/lib/integrations/dispatch-sheet-read";
import { buildSalesInsights, SITES, type LineItem } from "@/lib/orders/orders-analytics";
import { buildCourierLanes, buildPulse, sumStoreFunnels, type CcOrder } from "@/lib/dashboard/command-center";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/dashboard/command-center?from=YYYY-MM-DD&to=YYYY-MM-DD
//   → { pulse, funnel, adFunnel, topSkus, lanes } for the dashboard's top.
// Sales follow the one sale rule; funnels are what Shopify / the ad platforms
// report; courier fees only what an uploaded courier voucher proves.

/** Order numbers logged in each lane — each month from its own monthly
 *  spreadsheet (the intake sheet only for months without one). */
async function dispatchSheet(fromDay: string, toDay: string) {
  const r = await readDispatchSheets(addDubaiDays(fromDay, -7), addDubaiDays(toDay, 7)).catch(() => null);
  if (!r || r.errors.length) return { road: null, air: null };
  const pick = (tab: "Local" | "SMSA") => new Set(r.rows.filter((x) => x.tab === tab).map((x) => x.order.trim()));
  return { road: pick("Local"), air: pick("SMSA") };
}

/** OnTrack's own charge per order, from the COD remittance vouchers. */
async function roadFees(): Promise<Map<string, number>> {
  const { data: payouts } = await supabase.from("payouts").select("id").eq("gateway", "COD");
  const ids = (payouts ?? []).map((p) => p.id as string);
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("payout_transactions").select("order_ref, fee_aed, is_refund").in("payout_id", ids.slice(i, i + 150));
    for (const t of data ?? []) if (!t.is_refund && t.order_ref) out.set(String(t.order_ref).trim(), (out.get(String(t.order_ref).trim()) ?? 0) + (Number(t.fee_aed) || 0));
  }
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const today = dubaiToday();
  const toDay = DAY.test(sp.get("to") ?? "") ? sp.get("to")! : today;
  const fromDay = DAY.test(sp.get("from") ?? "") ? sp.get("from")! : addDubaiDays(toDay, -29);
  const len = dubaiDayCount(fromDay, toDay);
  const prevFromDay = addDubaiDays(fromDay, -len);
  const prevToDay = addDubaiDays(fromDay, -1);
  const month = dubaiMonthBounds(today, 0);
  const prevMonth = dubaiMonthBounds(today, 1);
  const prevMtdTo = addDubaiDays(prevMonth.fromDay, Number(today.slice(8, 10)) - 1);
  const earliest = [prevFromDay, prevMonth.fromDay].sort()[0];

  try {
    const [orders, adRows, funnels, sheet, fees] = await Promise.all([
      OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(earliest).fromUtc }),
      AdInsightsRepository.listInsights(fromDay, toDay),
      Promise.all(SITES.map(async (s) => [s.code, await fetchStoreFunnel(s.code, fromDay, toDay)] as const)),
      dispatchSheet(fromDay, toDay),
      roadFees(),
    ]);
    const cc = orders as unknown as (CcOrder & { line_items?: LineItem[] | null })[];

    const ad = { spend: 0, value: 0, impressions: 0, clicks: 0, landingPageViews: 0, addToCart: 0, checkout: 0, purchases: 0 };
    for (const r of adRows) {
      ad.spend += toAed(Number(r.spend) || 0, r.currency || "AED");
      ad.value += toAed(Number(r.conversion_value) || 0, r.currency || "AED");
      ad.impressions += Number(r.impressions) || 0;
      ad.clicks += Number(r.clicks) || 0;
      ad.landingPageViews += Number(r.landing_page_views) || 0;
      ad.addToCart += Number(r.add_to_cart) || 0;
      ad.checkout += Number(r.initiate_checkout) || 0;
      ad.purchases += Number(r.conversions) || 0;
    }

    const { topSkus } = buildSalesInsights({ orders: cc, fromDay, toDay, prevFromDay, prevToDay, limit: 8 });

    return NextResponse.json({
      range: { fromDay, toDay },
      pulse: buildPulse(cc, today, month.fromDay, prevMonth.fromDay, prevMtdTo, addDubaiDays(today, -1)),
      funnel: sumStoreFunnels([...funnels]),
      adFunnel: { ...ad, spend: Math.round(ad.spend), value: Math.round(ad.value) },
      topSkus,
      lanes: buildCourierLanes({ orders: cc, fromDay, toDay, sheet: { road: sheet.road, air: sheet.air }, roadFees: fees }),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
