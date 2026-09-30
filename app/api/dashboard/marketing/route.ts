import { NextResponse } from "next/server";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { supabase } from "@/lib/supabase";
import { toAed } from "@/lib/fx";

// GET /api/dashboard/marketing?month=YYYY-MM — ad spend per Dubai day (by
// store and platform) plus the platform's own purchase value, for the
// dashboard's marketing card. ROAS against real sales is computed on the
// client from the sales ledger (counted sales only), so it can never disagree
// with the sales numbers beside it. Pixel ROAS stays separate — never averaged
// with it (see app/api/ads/summary).
//
// `accounts` lists every ad account with the last day it has data for, and
// `syncErrors` the latest sync's per-platform errors, so a lapsed token (the
// KSA Meta token expired 2026-08-26) shows up as a stale account rather than
// as a quiet drop in spend.

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const [rows, lookback, runs] = await Promise.all([
    AdInsightsRepository.listInsights(from, to),
    // 60 days back, only to learn each account's last day with data.
    AdInsightsRepository.listInsights(new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10), to),
    supabase.from("ad_sync_runs").select("started_at, platform_results").order("started_at", { ascending: false }).limit(1),
  ]);

  const days = new Map<string, { day: string; spend: number; pixelValue: number; purchases: number; byStore: Record<string, number>; byPlatform: Record<string, number> }>();
  for (const r of rows) {
    const spend = toAed(Number(r.spend) || 0, r.currency || "AED");
    const d = days.get(r.date) ?? { day: r.date, spend: 0, pixelValue: 0, purchases: 0, byStore: {}, byPlatform: {} };
    d.spend += spend;
    d.pixelValue += toAed(Number(r.conversion_value) || 0, r.currency || "AED");
    d.purchases += Number(r.conversions) || 0;
    d.byStore[r.store_id] = (d.byStore[r.store_id] ?? 0) + spend;
    d.byPlatform[r.platform] = (d.byPlatform[r.platform] ?? 0) + spend;
    days.set(r.date, d);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const dayList = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({
    ...d,
    spend: r2(d.spend),
    pixelValue: r2(d.pixelValue),
    byStore: Object.fromEntries(Object.entries(d.byStore).map(([k, v]) => [k, r2(v)])),
    byPlatform: Object.fromEntries(Object.entries(d.byPlatform).map(([k, v]) => [k, r2(v)])),
  }));

  const accounts = new Map<string, { account: string; store: string; platform: string; lastDay: string; monthSpend: number }>();
  for (const r of lookback) {
    const k = `${r.platform}:${r.account_id}`;
    const a = accounts.get(k) ?? { account: r.account_id, store: r.store_id, platform: r.platform, lastDay: r.date, monthSpend: 0 };
    if (r.date > a.lastDay) a.lastDay = r.date;
    if (r.date >= from && r.date <= to) a.monthSpend = r2(a.monthSpend + toAed(Number(r.spend) || 0, r.currency || "AED"));
    accounts.set(k, a);
  }

  const results = (runs.data?.[0]?.platform_results ?? []) as { platform: string; error?: string }[];
  const syncErrors = results.filter((p) => p.error).map((p) => ({
    platform: p.platform,
    // Keep the human part of a Graph API error; drop the JSON envelope.
    error: (p.error!.match(/"message":"([^"]+)"/)?.[1] ?? p.error!).slice(0, 220),
  }));

  const total = dayList.reduce(
    (a, d) => ({ spend: a.spend + d.spend, pixelValue: a.pixelValue + d.pixelValue, purchases: a.purchases + d.purchases }),
    { spend: 0, pixelValue: 0, purchases: 0 },
  );

  return NextResponse.json({
    month,
    days: dayList,
    totals: { spend: r2(total.spend), pixelValue: r2(total.pixelValue), purchases: Math.round(total.purchases) },
    accounts: [...accounts.values()].sort((a, b) => b.monthSpend - a.monthSpend),
    syncErrors,
    lastSyncAt: runs.data?.[0]?.started_at ?? null,
  });
}
