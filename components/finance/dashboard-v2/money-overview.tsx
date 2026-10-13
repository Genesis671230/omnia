"use client";

/* Money overview — the top of the founder dashboard.
   For every Dubai day: what the stores sold (by gateway), how much is already
   in the bank, what's still pending, roughly what the gateways keep, and what
   marketing spent to get it. Order of the page:
     1. controls (one row)          4. chart by gateway + day inspector
     2. what needs you (alerts)     5. gateway mix + marketing
     3. KPIs, coloured by meaning   6. sales by country (map)
                                    7. day-by-day table with a ring per day
   Every day opens the order drawer that explains it.

   Data: /api/orders/sales-ledger (reduced per day by lib/orders/day-money.ts),
   /api/dashboard/attention (recon snapshot) and /api/dashboard/marketing. */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Bell, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { sumDays, sumGateways, toDayMoney, type DayMoney } from "@/lib/orders/day-money";
import { DaySalesDrawer, STATUS_META, downloadSalesXlsx, type LedgerDay, type LedgerStatus } from "./day-sales-drawer";
import { Card, CountUp, Eyebrow, ProgressRing, Seg, aed, dayLong, fmt, gatewayColor, pct } from "./overview/kit";
import { ui } from "./overview/ui";
import { DailyChart, type ChartMode } from "./overview/daily-chart";
import { GatewayDonut } from "./overview/gateway-donut";
import { AttentionStrip, type Attention, type SyncIssue } from "./overview/attention";
import { MarketingCard, type Marketing } from "./overview/marketing-card";
import { GeoSales } from "./overview/geo-sales";

type Ledger = {
  month: string;
  totals: { statusCounts: Record<LedgerStatus, { orders: number; grossAed: number }> };
  missingPayoutFiles: { gateway: string; orders: number; grossAed: number; days: string[] }[];
  excludedOrders: number;
  days: LedgerDay[];
  payoutSyncErrors?: { provider: string; error: string; at: string | null }[];
};
type Range = "week" | "month";

const REFRESH_MS = 60_000;
const PENDING_ORDER: LedgerStatus[] = ["no_payout_file", "awaiting_payout", "awaiting_bank", "in_review", "cod"];

function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
}
function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
}
function monthName(m: string): string {
  return new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
function daysOfMonth(m: string): string[] {
  const [y, mo] = m.split("-").map(Number);
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error(`Unexpected response (${res.status}) — session may have expired`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

/* ── KPI tile ──────────────────────────────────────────────────────────── */

function Kpi({
  label, value, sub, delay,
}: { label: string; value: number; sub: React.ReactNode; delay: number }) {
  return (
    <Card delay={delay}>
      <Eyebrow>{label}</Eyebrow>
      {/* ui.number = big, light, tight tracking */}
      <div className={`mt-3 ${ui.number}`} title={aed(value)}>
        <span className="mr-1.5 text-[14px] font-normal tracking-normal text-slate-400">AED</span>
        <CountUp value={value} format={(n: number) => fmt(n)} />
      </div>
      <div className={`mt-1 truncate ${ui.caption}`}>{sub}</div>
    </Card>
  );
}

/* ── day inspector ─────────────────────────────────────────────────────── */

function Inspector({
  day, today, onPrev, onNext, canPrev, canNext, onOpen,
}: { day: DayMoney | null; today: string; onPrev: () => void; onNext: () => void; canPrev: boolean; canNext: boolean; onOpen: () => void }) {
  const share = day && day.soldAed ? day.receivedAed / day.soldAed : 0;
  // round, borderless chevrons on the tinted card
  const btn = "inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-700 transition hover:bg-white/80 disabled:opacity-30";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.1 }}
      /* soft blue wash instead of white — the reference's "insight" card */
      className="flex h-full min-w-0 flex-col rounded-[28px] bg-gradient-to-br from-[#F5F8FF] via-[#E9F0FE] to-[#D9E6FD] p-6"
    >
      <div className="mb-4 flex items-center justify-between">
        <Eyebrow>Day</Eyebrow>
        <div className="flex gap-1">
          <button onClick={onPrev} disabled={!canPrev} aria-label="Previous day" className={btn}><ChevronLeft size={16} /></button>
          <button onClick={onNext} disabled={!canNext} aria-label="Next day" className={btn}><ChevronRight size={16} /></button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {day ? (
          <motion.div key={day.day} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }} className="flex flex-1 flex-col">
            <div className="flex items-center gap-4">
              <ProgressRing value={share} size={80} stroke={8} />
              <div className="min-w-0">
                <div className={ui.caption}>{dayLong(day.day)}{day.day === today ? " · today" : ""}</div>
                <div className={ui.number} title={aed(day.soldAed)}>AED {fmt(day.soldAed)}</div>
                <div className={ui.hint}>{day.orders} orders</div>
              </div>
            </div>

            <dl className="mt-6 space-y-3 border-t border-white/80 pt-5 text-[13px]">
              {[
                ["Received", day.receivedAed, ""],
                ["Pending", day.pendingAed, ""],
                ["≈ Gateway fee", day.feeAed, pct(day.feeRate)],
              ].map(([l, v, extra]) => (
                <div key={l as string} className="flex items-baseline justify-between">
                  <dt className="text-slate-500">{l}</dt>
                  <dd className="tabular-nums text-slate-900" title={aed(v as number)}>
                    {extra && <span className="mr-2 text-[12px] font-normal text-slate-400">{extra}</span>}AED {fmt(v as number)}
                  </dd>
                </div>
              ))}
            </dl>

            <button onClick={onOpen} className={`${ui.darkPill} mt-auto w-full`} style={{ marginTop: 24 }}>
              Open the day <ArrowUpRight size={14} />
            </button>
          </motion.div>
        ) : (
          <p className="text-[13px] text-slate-500">No sales this month yet.</p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── panel ─────────────────────────────────────────────────────────────── */

export function MoneyOverview() {
  const today = dubaiToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [marketing, setMarketing] = useState<Marketing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("month");
  const [mode, setMode] = useState<ChartMode>("gateway");
  const [selected, setSelected] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const monthRef = useRef(month);
  monthRef.current = month;

  const load = useCallback(async (silent = false) => {
    const m = monthRef.current;
    if (!silent) setLoading(true);
    // Each source fails on its own: a slow recon snapshot must not hide sales.
    const [l, a, mk] = await Promise.allSettled([
      getJson<Ledger>(`/api/orders/sales-ledger?month=${m}`),
      getJson<Attention>(`/api/dashboard/attention?month=${m}`),
      getJson<Marketing>(`/api/dashboard/marketing?month=${m}`),
    ]);
    if (monthRef.current !== m) return;
    if (l.status === "fulfilled") { setLedger(l.value); setError(null); } else if (!silent) setError((l.reason as Error).message);
    if (a.status === "fulfilled") setAttention(a.value);
    if (mk.status === "fulfilled") setMarketing(mk.value);
    setLoading(false);
  }, []);

  useEffect(() => { setSelected(null); setAttention(null); setMarketing(null); load(); }, [month, load]);
  useEffect(() => {
    if (month !== today.slice(0, 7)) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [month, today, load]);

  const byDay = useMemo(() => new Map((ledger?.days ?? []).map((d) => [d.day, d])), [ledger]);
  const money = useMemo(() => new Map((ledger?.days ?? []).filter((d) => d.orders > 0).map((d) => [d.day, toDayMoney(d)])), [ledger]);
  const monthDays = useMemo(() => daysOfMonth(month), [month]);
  const rangeDays = useMemo(() => {
    if (range === "month") return monthDays;
    const end = monthDays.includes(today) ? today : monthDays[monthDays.length - 1];
    const idx = monthDays.indexOf(end);
    return monthDays.slice(Math.max(idx - 6, 0), idx + 1);
  }, [range, monthDays, today]);

  const inRange = rangeDays.map((d) => money.get(d)).filter(Boolean) as DayMoney[];
  const totals = sumDays(inRange);
  // refunds / returns raised against these days' sales, and what's left (same as Sales & receipts and the management report)
  const rangeSet = new Set(rangeDays);
  const refundsAed = (ledger?.days ?? []).filter((d) => rangeSet.has(d.day)).reduce((t, d) => t + (d.creditedAed ?? 0), 0);
  const gateways = sumGateways(inRange);
  const gatewayNames = sumGateways([...money.values()]).map((g) => g.gateway); // fixed stack order for the month
  const realDays = [...money.keys()].sort();
  const sel = selected && money.has(selected) ? selected : realDays[realDays.length - 1] ?? null;
  const selIdx = sel ? realDays.indexOf(sel) : -1;
  const isCurrent = month === today.slice(0, 7);

  const counts = ledger?.totals.statusCounts;
  const pendingParts = counts ? PENDING_ORDER.map((s) => ({ s, ...counts[s] })).filter((p) => p.grossAed > 0) : [];

  const spend = rangeDays.filter((d) => d <= today).reduce((s, d) => s + (marketing?.days.find((x) => x.day === d)?.spend ?? 0), 0);

  const syncIssues: SyncIssue[] = [
    ...(ledger?.payoutSyncErrors ?? []).map((e) => ({ source: e.provider, error: e.error })),
    ...(marketing?.syncErrors ?? []).map((e) => ({ source: `${e.platform} ads`, error: e.error })),
  ];

  const exportMonth = async () => {
    setExporting(true);
    try { await downloadSalesXlsx({ month }); } catch (e) { toast.error((e as Error).message); } finally { setExporting(false); }
  };

  return (
    <section className="flex flex-col gap-5 text-slate-900">
      {/* 1. controls — month stepper left, round icon buttons + one dark pill right */}
      <div className="flex flex-wrap items-center gap-3">
        <button className={ui.iconButton} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <span className="min-w-[136px] text-center text-[15px] text-slate-900">{monthName(month)}</span>
        <button className={ui.iconButton} onClick={() => setMonth(shiftMonth(month, 1))} disabled={isCurrent} aria-label="Next month"><ChevronRight size={16} /></button>
        <div className="ml-auto flex items-center gap-2.5">

          <span className="relative group inline-flex items-center gap-1.5">
      <AttentionStrip missing={ledger?.missingPayoutFiles ?? []} attention={attention} syncIssues={syncIssues} loading={loading || !attention} />

          </span>
          {isCurrent && (
            <span className={`hidden items-center gap-2 md:inline-flex ${ui.hint}`}>
              {/* pulsing dot = data refreshes every minute */}
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
              Live
            </span>
          )}
          <button className={ui.iconButton} onClick={() => load()} aria-label="Refresh" title="Refresh">{loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}</button>
          <button onClick={exportMonth} disabled={exporting} className={ui.darkPill}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl bg-[#FFF1F2] px-4 py-2.5 text-[13px] text-[#BE123C] ring-1 ring-inset ring-[#FECDD3]">Couldn’t load the sales ledger: {error}</div>}

      {/* 2. what needs you */}

      {/* 4. chart + inspector */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card delay={0.05} className="xl:col-span-8">
          <Eyebrow>Daily sales</Eyebrow>
          {/* header row: legend (left) · the month's total, big and light (centre) · tabs (right) */}
          <div className="mt-5 grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-slate-600">
              {mode === "gateway"
                ? gatewayNames.map((g) => <span key={g} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(g) }} />{g}</span>)
                : (<>
                    <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" />Received</span>
                    <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-300" />Pending</span>
                  </>)}
            </div>
            <div className="text-center">
              <div className={ui.bigNumber} title={aed(totals.soldAed)}>
                <span className="mr-1 align-top text-[16px] font-normal tracking-normal text-slate-400">AED</span>{fmt(totals.soldAed)}
              </div>
              <div className={`mt-2 ${ui.caption}`}>Sold · {fmt(totals.orders)} orders · {pct(totals.soldAed ? totals.receivedAed / totals.soldAed : 0)} in the bank</div>
            </div>
            <div className="flex flex-col items-end gap-2.5">
              <Seg value={range} onChange={setRange} options={[["week", "7 days"], ["month", "Month"]]} />
              <Seg value={mode} onChange={setMode} options={[["gateway", "Gateways"], ["status", "Received"]]} />
            </div>
          </div>
          <div className="mt-4" />
          {loading && !ledger ? (
            <div className="flex h-[300px] items-center justify-center gap-2 text-[13px] text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading the month…</div>
          ) : (
            <DailyChart days={rangeDays} money={money} mode={mode} gateways={gatewayNames} selected={sel} today={today} onSelect={setSelected} onOpen={setOpenDay} />
          )}
        </Card>
        <div className="xl:col-span-4">
          <Inspector
            day={sel ? money.get(sel)! : null}
            today={today}
            canPrev={selIdx > 0}
            canNext={selIdx >= 0 && selIdx < realDays.length - 1}
            onPrev={() => selIdx > 0 && setSelected(realDays[selIdx - 1])}
            onNext={() => selIdx < realDays.length - 1 && setSelected(realDays[selIdx + 1])}
            onOpen={() => sel && setOpenDay(sel)}
          />
        </div>
      </div>

      {/* 3. four small figures under the hero, like the reference's lower cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi delay={0.04} label="Paid in · sales value" value={totals.receivedAed} sub={`${pct(totals.soldAed ? totals.receivedAed / totals.soldAed : 0)} of sales · AED ${fmt(totals.landedNetAed)} cash in bank after fees`} />
        <Kpi delay={0.08} label="Still to come" value={totals.pendingAed} sub={`${pct(totals.soldAed ? totals.pendingAed / totals.soldAed : 0)} of sales`} />
        <Kpi delay={0.1} label="Refunds & returns" value={refundsAed} sub={`net sales AED ${fmt(totals.soldAed - refundsAed)}`} />
        <Kpi delay={0.12} label="≈ Gateway fees" value={totals.feeAed} sub={`${pct(totals.feeRate)} of sales`} />
        <Kpi delay={0.16} label="Ad spend" value={spend} sub={spend ? `ROAS ${(totals.soldAed / spend).toFixed(1)}×` : "no spend"} />
      </div>

      {/* 5. gateway mix + pending + marketing */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card delay={0.1} className="xl:col-span-5">
          <div className="mb-3"><Eyebrow>Gateway mix</Eyebrow></div>
          <GatewayDonut gateways={gateways} />
          {pendingParts.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2"><Eyebrow>Why money is pending</Eyebrow></div>
              <ul className="space-y-1.5">
                {pendingParts.map((p) => (
                  <li key={p.s} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-slate-600">{STATUS_META[p.s].label} <span className="text-slate-400">· {p.orders}</span></span>
                    <span className="tabular-nums text-slate-900" title={aed(p.grossAed)}>AED {fmt(p.grossAed)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <div className="xl:col-span-7">
          <MarketingCard data={marketing} days={rangeDays} money={money} today={today} loading={loading} delay={0.14} />
        </div>
      </div>

      {/* 6. where the sales come from — same range as the chart */}
      <GeoSales from={rangeDays[0]} to={rangeDays[rangeDays.length - 1]} label={range === "week" ? "last 7 days" : monthName(month)} />

      {/* 7. day by day */}
      <Card delay={0.15} className="px-3 pb-3 pt-4">
        <div className="mb-2 flex items-center justify-between px-2">
          <Eyebrow>Day by day</Eyebrow>
          <span className="text-[11.5px] text-slate-400">AED · hover for exact amounts · click for orders</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">
                {["Day", "", "Orders", "Sold", "Paid in", "Still to come", "≈ Fee", "Status"].map((h, index) => (
                  <th key={index} className={`border-b border-slate-100 px-3 py-2 ${index >= 2 && index <= 6 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...money.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d, index) => {
                const meta = STATUS_META[d.headline as LedgerStatus];
                const cell = "border-b border-slate-100 px-3 py-2 text-right tabular-nums";
                return (
                  <tr
                    key={index}
                    onClick={() => setOpenDay(d.day)}
                    onMouseEnter={() => setSelected(d.day)}
                    className={`cursor-pointer ${d.day === sel ? "[&>td]:bg-blue-50/60" : "hover:[&>td]:bg-slate-50"}`}
                  >
                    <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-slate-900">
                      {dayLong(d.day)}{d.day === today && <span className="ml-2 text-[11px] font-medium text-[#2563EB]">today</span>}
                    </td>
                    <td className="w-10 border-b border-slate-100 px-1 py-1.5"><ProgressRing value={d.soldAed ? d.receivedAed / d.soldAed : 0} size={28} stroke={3.5} /></td>
                    <td className={`${cell} text-slate-500`}>{d.orders}</td>
                    <td className={`${cell} font-semibold text-slate-900`} title={aed(d.soldAed)}>{fmt(d.soldAed)}</td>
                    <td className={`${cell} text-slate-900`} title={aed(d.receivedAed)}>{d.receivedAed ? fmt(d.receivedAed) : <span className="text-slate-300">—</span>}</td>
                    <td className={`${cell} text-slate-900`} title={aed(d.pendingAed)}>{d.pendingAed ? fmt(d.pendingAed) : <span className="text-slate-300">—</span>}</td>
                    <td className={`${cell} text-slate-500`} title={`${aed(d.feeAed)} · ${pct(d.feeRate)}${d.feeEstimatedShare > 0.5 ? " · mostly estimated" : ""}`}>{fmt(d.feeAed)}</td>
                    <td className="whitespace-nowrap border-b border-slate-100 px-3 text-[12.5px] text-slate-500">
                      {meta && <span className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full" style={{ background: d.headline === "received" ? "#10B981" : d.headline === "no_payout_file" ? "#E11D48" : "#F59E0B" }} />{meta.label}</span>}
                    </td>
                  </tr>
                );
              })}
              {money.size === 0 && !loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-[13px] text-slate-500">No sales in {monthName(month)}.</td></tr>}
            </tbody>
            {money.size > 0 && (() => {
              const t = sumDays([...money.values()]);
              const c = "px-3 pt-3 text-right tabular-nums";
              return (
                <tfoot>
                  <tr className="text-[13px] font-semibold text-slate-900">
                    <td className="px-3 pt-3">Month</td>
                    <td className="px-1 pt-3"><ProgressRing value={t.soldAed ? t.receivedAed / t.soldAed : 0} size={28} stroke={3.5} /></td>
                    <td className={c}>{fmt(t.orders)}</td>
                    <td className={c} title={aed(t.soldAed)}>{fmt(t.soldAed)}</td>
                    <td className={c} title={aed(t.receivedAed)}>{fmt(t.receivedAed)}</td>
                    <td className={c} title={aed(t.pendingAed)}>{fmt(t.pendingAed)}</td>
                    <td className={c} title={aed(t.feeAed)}>{fmt(t.feeAed)}</td>
                    <td />
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
        {(ledger?.excludedOrders ?? 0) > 0 && <p className="mt-2 px-2 text-[12px] text-slate-400">{ledger!.excludedOrders} unpaid, pending or cancelled orders are not counted as sales.</p>}
      </Card>

      <DaySalesDrawer day={openDay ? byDay.get(openDay) ?? null : null} onClose={() => setOpenDay(null)} onChanged={() => load(true)} />
    </section>
  );
}
