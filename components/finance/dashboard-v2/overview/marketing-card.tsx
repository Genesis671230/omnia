"use client";

/* Marketing: ad spend against the sales it bought.
   • Blended ROAS = counted sales (sales ledger, every store) ÷ ad spend — the
     honest number, it can't be inflated by a pixel.
   • Pixel ROAS = what Meta itself claims. Shown beside it, never averaged in.
   Two small charts share the day axis but not a y-axis (spend in AED, ROAS as
   a multiple), so they are stacked, never overlaid. */

import { Megaphone, TriangleAlert } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayMoney } from "@/lib/orders/day-money";
import { Card, Eyebrow, aed, compact, dayLong, fmt } from "./kit";

export type Marketing = {
  days: { day: string; spend: number; pixelValue: number; purchases: number; byStore: Record<string, number> }[];
  totals: { spend: number; pixelValue: number; purchases: number };
  accounts: { account: string; store: string; platform: string; lastDay: string; monthSpend: number }[];
  syncErrors: { platform: string; error: string }[];
};

const x = (n: number) => `${n.toFixed(2)}×`;

export function MarketingCard({
  data, days, money, today, loading, delay = 0,
}: { data: Marketing | null; days: string[]; money: Map<string, DayMoney>; today: string; loading: boolean; delay?: number }) {
  const spendBy = new Map((data?.days ?? []).map((d) => [d.day, d]));
  const inRange = days.filter((d) => d <= today);
  const spend = inRange.reduce((s, d) => s + (spendBy.get(d)?.spend ?? 0), 0);
  const pixel = inRange.reduce((s, d) => s + (spendBy.get(d)?.pixelValue ?? 0), 0);
  const purchases = inRange.reduce((s, d) => s + (spendBy.get(d)?.purchases ?? 0), 0);
  const sales = inRange.reduce((s, d) => s + (money.get(d)?.soldAed ?? 0), 0);
  const roas = spend > 0 ? sales / spend : 0;
  const pixelRoas = spend > 0 ? pixel / spend : 0;

  const rows = days.map((d) => {
    const s = spendBy.get(d)?.spend ?? 0;
    const sold = money.get(d)?.soldAed ?? 0;
    return { day: d, spend: s, sales: sold, roas: s > 0 ? +(sold / s).toFixed(2) : null };
  });

  // An account that has gone quiet while others still report is almost always a lapsed token.
  const newest = data?.accounts.reduce((m, a) => (a.lastDay > m ? a.lastDay : m), "") ?? "";
  const stale = (data?.accounts ?? []).filter((a) => newest && a.lastDay < newest && daysBetween(a.lastDay, newest) > 3 && a.lastDay >= shiftDays(newest, -60));

  const stat = "text-[22px] font-semibold tracking-tight tabular-nums text-slate-900";
  return (
    <Card delay={delay} className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Eyebrow className="inline-flex items-center gap-1.5"><Megaphone size={13} /> Marketing</Eyebrow>
        <span className="text-[11.5px] text-slate-400">Meta ads</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-[12px] text-slate-500">Ad spend</div>
          <div className={stat} title={aed(spend)}>{loading && !data ? "…" : `AED ${compact(spend)}`}</div>
        </div>
        <div>
          <div className="text-[12px] text-slate-500" title="Counted sales, all stores ÷ ad spend">ROAS on sales</div>
          <div className={stat}>{spend ? x(roas) : "—"}</div>
        </div>
        <div>
          <div className="text-[12px] text-slate-500" title="What Meta's pixel reports">Pixel ROAS</div>
          <div className={`${stat} text-slate-500`}>{spend ? x(pixelRoas) : "—"}</div>
        </div>
      </div>

      <div className="mt-4 min-h-[110px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="day" hide />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "#EEF2FA" }}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !r) return null;
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 shadow-lg">
                    <b>{dayLong(r.day)}</b>
                    <div className="tabular-nums text-slate-600">Spend AED {compact(r.spend)} · sales AED {compact(r.sales)}</div>
                    <div className="tabular-nums">ROAS {r.roas != null ? x(r.roas) : "—"}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="spend" fill="#93A7D0" radius={[3, 3, 0, 0]} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-slate-400">
        <span>Daily ad spend</span>
        <span className="tabular-nums">{fmt(purchases)} purchases{purchases ? ` · AED ${fmt(spend / purchases)} each` : ""}</span>
      </div>

      {stale.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-slate-400" title={data?.syncErrors.map((e) => e.error).join("\n")}>
          <TriangleAlert size={12} className="shrink-0 text-[#F59E0B]" />
          No ad data from {stale.map((a) => `${a.store} since ${dayLong(a.lastDay)}`).join(", ")} — missing from this ROAS.
        </p>
      )}
    </Card>
  );
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
function shiftDays(d: string, n: number) {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
