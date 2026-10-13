"use client";

/* Command centre — the top of the founder dashboard.
 *
 *   ┌ banner: today, yesterday, month to date (dark blue gradient) ──────────────────┐
 *   │ sales funnel ribbon (store / ads)        │ checkout conversion     │
 *   │ courier lanes (road · air)               │ top products            │
 *   │ ads driving revenue                                                │
 *
 * Data: /api/dashboard/command-center (funnel, SKUs, lanes, pulse) and
 * /api/dashboard/top-ads (Meta creatives, slower — loads on its own). */

import { motion } from "framer-motion";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LaneStats, Pulse, SummedFunnel } from "@/lib/dashboard/command-center";
import type { SkuRow } from "@/lib/orders/orders-analytics";
import { fmt } from "../overview/kit";
import { FunnelRibbon, ConversionGauge, type AdFunnelTotals } from "./funnel";
import { AdClicks, CourierLanes, TopAds, TopProducts, type TopAd } from "./cards";
import { MonthFinancials } from "./financials";

export type CommandData = {
  range: { fromDay: string; toDay: string };
  pulse: Pulse;
  funnel: SummedFunnel;
  adFunnel: AdFunnelTotals;
  topSkus: SkuRow[];
  lanes: LaneStats[];
};
type RangeKey = "1d" | "7d" | "30d" | "month";

function dubaiNow() {
  return new Date(Date.now() + 4 * 3600_000);
}
function dayStr(d: Date) {
  return d.toISOString().slice(0, 10);
}
function rangeFor(k: RangeKey): { from: string; to: string; label: string } {
  const now = dubaiNow();
  const to = dayStr(now);
  if (k === "month") return { from: `${to.slice(0, 7)}-01`, to, label: "this month" };
  const back = new Date(now.getTime() - ((k === "1d" ? 1 : k === "7d" ? 7 : k === "30d" ? 30 : 1) - 1) * 86_400_000);
  return { from: dayStr(back), to, label: k === "1d" ? "last 1 day" : k === "7d" ? "last 7 days" : k === "30d" ? "last 30 days" : "last month" };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!(res.headers.get("content-type") || "").includes("application/json")) throw new Error(`Unexpected response (${res.status}) — session may have expired`);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j as T;
}

/** "finance" = the dashboard (money, Zoho check, couriers);
 *  "marketing" = the Marketing page (funnel, clicks, products, ads). */
export function CommandCenter({ variant = "finance" }: { variant?: "finance" | "marketing" }) {
  const marketing = variant === "marketing";
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const range = useMemo(() => rangeFor(rangeKey), [rangeKey]);
  const [data, setData] = useState<CommandData | null>(null);
  const [ads, setAds] = useState<{ ads: TopAd[]; totalValue?: number; error?: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAds(null);
    const q = `from=${range.from}&to=${range.to}`;
    if (marketing) {
      getJson<{ ads: TopAd[]; totalValue?: number; error?: string }>(`/api/dashboard/top-ads?${q}`)
        .then(setAds)
        .catch((e) => setAds({ ads: [], error: (e as Error).message }));
    }
    try {
      setData(await getJson<CommandData>(`/api/dashboard/command-center?${q}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, marketing]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="mb-8 space-y-5">
      <HeroBanner pulse={data?.pulse ?? null} rangeKey={rangeKey} onRange={setRangeKey} loading={loading} onRefresh={load} />
      {error && <div className="rounded-2xl bg-[#F9ECE7] px-4 py-3 text-[13px] text-[#A6472F]">{error}</div>}

      {marketing ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="xl:col-span-8"><FunnelRibbon funnel={data?.funnel ?? null} ads={data?.adFunnel ?? null} label={range.label} /></div>
          <div className="xl:col-span-4"><ConversionGauge funnel={data?.funnel ?? null} ads={data?.adFunnel ?? null} label={range.label} /></div>
          <div className="xl:col-span-8"><AdClicks ads={data?.adFunnel ?? null} label={range.label} /></div>
          <div className="xl:col-span-4"><TopProducts skus={data?.topSkus ?? null} label={range.label} /></div>
          <div className="xl:col-span-12"><TopAds data={ads} label={range.label} /></div>
        </div>
      ) : (
        <>
          <MonthFinancials />
          <CourierLanes lanes={data?.lanes ?? null} label={range.label} />
        </>
      )}
    </section>
  );
}

/* ── banner ───────────────────────────────────────────────────── */

function Chip({ children, tone = "glass" }: { children: React.ReactNode; tone?: "glass" | "up" | "down" }) {
  const cls = tone === "up" ? "bg-emerald-400/20 text-emerald-100" : tone === "down" ? "bg-rose-400/20 text-rose-100" : "bg-white/10 text-white/90";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] backdrop-blur-md ${cls}`}>{children}</span>;
}

function HeroBanner({ pulse, rangeKey, onRange, loading, onRefresh }: {
  pulse: Pulse | null; rangeKey: RangeKey; onRange: (k: RangeKey) => void; loading: boolean; onRefresh: () => void;
}) {
  const date = dubaiNow().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const vsYesterday = pulse && pulse.yesterday.salesAed > 0 ? (pulse.today.salesAed - pulse.yesterday.salesAed) / pulse.yesterday.salesAed : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-[#0B1433] via-[#13235C] to-[#1E3A8A] px-6 py-5 text-white shadow-[0_30px_60px_-30px_rgba(15,27,61,0.6)] sm:px-9"
    >
      {/* Plain deep-blue gradient — no streaks, no greeting. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_140%_at_100%_0%,rgba(37,99,235,0.45),transparent_60%),radial-gradient(60%_90%_at_0%_100%,rgba(99,102,241,0.30),transparent_65%)]" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[13px] text-white/60">{date}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            {pulse ? (
              <>
                <Chip><Sparkles size={13} /> Today AED {fmt(pulse.today.salesAed)} · {fmt(pulse.today.orders)} orders</Chip>
                {vsYesterday != null && (
                  <Chip tone={vsYesterday >= 0 ? "up" : "down"}>{vsYesterday >= 0 ? "▲" : "▼"} {Math.abs(vsYesterday * 100).toFixed(1)}% vs yesterday</Chip>
                )}
                <Chip>Month to date AED {fmt(pulse.mtd.salesAed)}</Chip>
                {pulse.mtd.change != null && (
                  <Chip tone={pulse.mtd.change >= 0 ? "up" : "down"}>{pulse.mtd.change >= 0 ? "▲" : "▼"} {Math.abs(pulse.mtd.change)}% vs same days last month</Chip>
                )}
              </>
            ) : (
              <Chip><Loader2 size={13} className="animate-spin" /> Reading today&apos;s sales…</Chip>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-white/10 p-1 backdrop-blur-md">
            {([["1d", "1 day"],["7d", "7 days"], ["30d", "30 days"], ["month", "This month"]] as [RangeKey, string][]).map(([k, label]) => (
              <button key={k} onClick={() => onRange(k)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition ${rangeKey === k ? "bg-white text-[#0B1433]" : "text-white/80 hover:text-white"}`}>{label}</button>
            ))}
          </div>
          <button onClick={onRefresh} aria-label="Refresh" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
