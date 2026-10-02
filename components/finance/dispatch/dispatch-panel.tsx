"use client";

/* Dispatch — store orders vs Zoho invoices vs the dispatch sheet, live.
 *
 *   three source cards (store · Zoho verified · sheet) with coverage
 *   two lanes: road (Local orders tab, OnTrack) · air (SMSA Orders tab)
 *   status chips → filtered order list; each order shows its three amounts
 *   and opens to the sheet row (comment, payment status, fee, balance)
 *
 * Data: /api/dispatch/reconcile (no Zoho call; refreshes every minute) and
 * /api/dispatch/reconcile/invoices (re-read Zoho invoices, on the button).
 * Export: same endpoint with format=xlsx. */

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy, Download, FileCheck2, Loader2, Plane, RefreshCw, Search, Sheet, Store, Truck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TW_ORDER, TW_PROBLEMS, type TwRow, type TwStatus, type TwSummary } from "@/lib/dispatch/three-way";
import type { Bridge } from "@/lib/dispatch/bridge";

type Data = { rows: TwRow[]; summary: TwSummary; bridge: Bridge; sheetErrors: string[]; sheetSources: string[]; sheetReadAt: string; invoicesUpdatedAt: string | null };
type RangeKey = "this" | "last" | "7d" | "custom";

const STATUS: Record<TwStatus, { label: string; tone: string; dot: string }> = {
  missing_in_sheet: { label: "Missing in sheet", tone: "bg-rose-50 text-rose-700 ring-rose-200", dot: "#E11D48" },
  cancel_mismatch: { label: "Cancel/refund mismatch", tone: "bg-pink-50 text-pink-700 ring-pink-200", dot: "#DB2777" },
  sheet_only: { label: "In sheet, not a sale", tone: "bg-amber-50 text-amber-700 ring-amber-200", dot: "#D97706" },
  amount_diff: { label: "Amounts differ", tone: "bg-orange-50 text-orange-700 ring-orange-200", dot: "#EA580C" },
  duplicate_in_sheet: { label: "Duplicate in sheet", tone: "bg-violet-50 text-violet-700 ring-violet-200", dot: "#7C3AED" },
  no_invoice: { label: "No Zoho invoice", tone: "bg-sky-50 text-sky-700 ring-sky-200", dot: "#0284C7" },
  exchange: { label: "Exchange / repair", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "#4F46E5" },
  other_month: { label: "Store order in another month", tone: "bg-teal-50 text-teal-700 ring-teal-200", dot: "#0D9488" },
  cancelled_refunded: { label: "Cancelled / refunded", tone: "bg-slate-100 text-slate-700 ring-slate-200", dot: "#64748B" },
  ok: { label: "All three agree", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "#059669" },
};
const ORDER: TwStatus[] = TW_ORDER;

const fmt = (n: number | null | undefined, d = 0) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const compact = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : fmt(n));
const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

function rangeFor(k: RangeKey, custom: { from: string; to: string }): { from: string; to: string; label: string } {
  const today = dubaiToday();
  if (k === "custom") return { ...custom, label: `${custom.from} → ${custom.to}` };
  if (k === "7d") return { from: new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), to: today, label: "Last 7 days" };
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + (k === "last" ? -1 : 0), 1));
  const last = k === "last" ? new Date(Date.UTC(y, m - 1, 0)) : new Date(`${today}T00:00:00Z`);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: first.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

export function DispatchPanel() {
  const [rangeKey, setRangeKey] = useState<RangeKey>(() => (Number(dubaiToday().slice(8)) <= 5 ? "last" : "this"));
  const [custom, setCustom] = useState({ from: dubaiToday().slice(0, 8) + "01", to: dubaiToday() });
  const range = useMemo(() => rangeFor(rangeKey, custom), [rangeKey, custom]);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<TwStatus | "all" | "problems">("problems");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(80);
  const [refreshingZoho, setRefreshingZoho] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dispatch/reconcile?from=${range.from}&to=${range.to}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!(res.headers.get("content-type") || "").includes("json")) throw new Error(`Unexpected response (${res.status}) — session may have expired`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { setData(null); setShown(80); load(true); }, [load]);
  // Live: re-read every minute (the sheet is cached server-side for a minute).
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  const refreshZoho = async () => {
    setRefreshingZoho(true);
    try {
      const res = await fetch(`/api/dispatch/reconcile/invoices?from=${range.from}&to=${range.to}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(`Zoho invoices refreshed — ${j.invoices} read (${j.zohoCalls} calls)`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshingZoho(false);
    }
  };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      (filter === "all" || (filter === "problems" ? TW_PROBLEMS.has(r.status) : r.status === filter)) &&
      (!term || `${r.order} ${r.customer} ${r.store} ${r.invoices.join(" ")} ${r.sheet.map((s) => s.comments).join(" ")}`.toLowerCase().includes(term)));
  }, [data, filter, q]);

  const copyList = async () => {
    const lines = ["Order\tDay\tStatus\tStore AED\tZoho AED\tSheet AED\tWhy", ...rows.map((r) => [r.order, r.day, STATUS[r.status].label, r.oursAed ?? "", r.verifiedAed ?? "", r.sheetAed ?? "", r.reason].join("\t"))];
    await navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    toast.success(`${rows.length} orders copied`);
  };

  const s = data?.summary;
  return (
    <div className="space-y-5 pb-16">
      {/* ── header band ── */}
      <div className="relative overflow-hidden rounded-[30px] bg-gradient-to-br from-[#0B1433] via-[#13286B] to-[#2347D9] px-6 pb-6 pt-6 text-white shadow-[0_30px_60px_-34px_rgba(11,20,51,0.7)] sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_100%_0%,rgba(143,176,255,0.35),transparent_60%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-light tracking-[-0.02em]">Dispatch</h1>
            <p className="mt-1 text-[13px] text-white/60">Every order in the stores, in Zoho and in the dispatch sheet — side by side · {range.label}</p>
            <div className="mt-3 flex items-center gap-2 text-[12px] text-white/60">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
              Live · {data?.sheetSources?.length ? data.sheetSources.join(" + ") : "dispatch sheet"} read {data ? new Date(data.sheetReadAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "…"}
              {data?.invoicesUpdatedAt && <> · Zoho invoices as of {new Date(data.invoicesUpdatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full bg-white/10 p-1 backdrop-blur-md">
              {([["this", "This month"], ["last", "Last month"], ["7d", "7 days"], ["custom", "Custom"]] as [RangeKey, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setRangeKey(k)} className={`rounded-full px-3 py-1.5 text-[12.5px] ${rangeKey === k ? "bg-white text-[#0B1433]" : "text-white/80 hover:text-white"}`}>{l}</button>
              ))}
            </div>
            {rangeKey === "custom" && (
              <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[12px]">
                <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="bg-transparent text-white [color-scheme:dark]" />
                →
                <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="bg-transparent text-white [color-scheme:dark]" />
              </div>
            )}
            <button onClick={refreshZoho} disabled={refreshingZoho} title="Re-read Zoho invoices for this range (a few calls)"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-[12.5px] backdrop-blur-md hover:bg-white/20 disabled:opacity-60">
              {refreshingZoho ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} />} Refresh Zoho
            </button>
            <button onClick={() => load(true)} aria-label="Refresh now" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
            <a href={`/api/dispatch/reconcile?from=${range.from}&to=${range.to}&format=xlsx`}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[12.5px] font-medium text-[#0B1433] hover:bg-[#EEF3FF]">
              <Download size={13} /> Export Excel
            </a>
          </div>
        </div>

        {/* three sources */}
        <div className="relative mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { icon: Store, k: "Store sales", v: s?.ours, sub: "counted sales" },
            { icon: FileCheck2, k: "Zoho verified", v: s?.verified, sub: s ? `${Math.round((s.verified.orders / Math.max(s.ours.orders, 1)) * 100)}% of sales invoiced` : "" },
            { icon: Sheet, k: "Dispatch sheet", v: s?.sheet, sub: s ? `${s.byLane.SMSA.inSheet + s.byLane.Local.inSheet} of ${s.ours.orders} sales logged` : "" },
          ].map((c, i) => (
            <motion.div key={c.k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="rounded-[22px] bg-white/10 px-5 py-4 ring-1 ring-white/15 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-[12.5px] text-white/70"><c.icon size={14} /> {c.k}</div>
              <div className="mt-2 text-[28px] font-light tabular-nums tracking-[-0.02em]">{c.v ? `AED ${compact(c.v.aed)}` : "—"}</div>
              <div className="text-[12px] text-white/60">{c.v ? `${fmt(c.v.orders)} orders` : ""}{c.sub ? ` · ${c.sub}` : ""}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {error && <div className="rounded-2xl bg-[#F9ECE7] px-4 py-3 text-[13px] text-[#A6472F]">{error}</div>}
      {data?.sheetErrors?.length ? <div className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800">Dispatch sheet: {data.sheetErrors.join(" · ")}</div> : null}

      {/* ── lanes ── */}
      {s && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(["Local", "SMSA"] as const).map((lane) => {
            const l = s.byLane[lane];
            const share = l.orders ? l.inSheet / l.orders : 1;
            const Icon = lane === "Local" ? Truck : Plane;
            const color = lane === "Local" ? "#F2705E" : "#6D5BFF";
            return (
              <div key={lane} className="rounded-[26px] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(15,23,42,0.22)]">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: color }}><Icon size={19} /></span>
                  <div className="flex-1">
                    <div className="text-[15px] font-medium text-slate-900">{lane === "Local" ? "Local orders · OnTrack (UAE)" : "SMSA Orders · KSA & Gulf"}</div>
                    <div className="text-[12px] text-slate-500">{fmt(l.orders)} sales · AED {compact(l.oursAed)} · sheet tab total AED {compact(l.sheetAed)}</div>
                  </div>
                  <div className={`text-right text-[22px] font-light tabular-nums ${share < 0.9 ? "text-rose-600" : "text-slate-900"}`}>{fmt(l.inSheet)}<span className="text-[13px] text-slate-400"> / {fmt(l.orders)}</span></div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.9 }} />
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500">
                  {share < 0.9 ? <AlertTriangle size={12} className="text-rose-500" /> : <CheckCircle2 size={12} className="text-emerald-500" />}
                  {Math.round(share * 100)}% of this lane&apos;s sales are in the sheet{share < 0.9 && l.orders - l.inSheet ? ` — ${fmt(l.orders - l.inSheet)} missing` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── what the sheet says beyond amounts ── */}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { k: "Cancelled / refunded (sheet)", v: `AED ${compact(s.sheet.refundedAed)}`, sub: `left after refunds AED ${compact(s.sheet.leftAed)}` },
            { k: "Logged on another day", v: fmt(s.timing.differentDay), sub: `${fmt(s.timing.differentMonth)} in another month` },
            { k: "Foreign-currency orders", v: fmt(s.foreignCurrency), sub: "SAR, KWD, OMR, QAR… converted to AED" },
            { k: "Exchange / repair shipments", v: fmt(s.shipments), sub: "not sales — shipments for earlier orders" },
          ].map((t) => (
            <div key={t.k} className="rounded-[22px] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_14px_34px_-26px_rgba(15,23,42,0.25)]">
              <div className="text-[11.5px] text-slate-500">{t.k}</div>
              <div className="mt-1 text-[20px] font-light tabular-nums text-slate-900">{t.v}</div>
              <div className="text-[11px] text-slate-400">{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {data?.bridge && <BridgeCard b={data.bridge} />}

      {/* ── filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilter("problems")} className={`rounded-full px-3.5 py-1.5 text-[12.5px] ring-1 ${filter === "problems" ? "bg-[#0F1B3D] text-white ring-[#0F1B3D]" : "bg-white text-slate-700 ring-slate-200"}`}>
          To check · {fmt((data?.rows ?? []).filter((r) => TW_PROBLEMS.has(r.status)).length)}
        </button>
        {ORDER.map((st) => {
          const b = s?.byStatus[st];
          if (!b?.orders) return null;
          return (
            <button key={st} onClick={() => setFilter(st)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${filter === st ? STATUS[st].tone : "bg-white text-slate-700 ring-slate-200"}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS[st].dot }} />
              {STATUS[st].label} · {fmt(b.orders)} · AED {compact(Math.max(b.oursAed, b.sheetAed))}
            </button>
          );
        })}
        <button onClick={() => setFilter("all")} className={`rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${filter === "all" ? "bg-[#0F1B3D] text-white ring-[#0F1B3D]" : "bg-white text-slate-700 ring-slate-200"}`}>All · {fmt(data?.rows.length ?? 0)}</button>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, customer, invoice…" className="h-9 w-56 rounded-full border border-slate-200 bg-white pl-8 pr-3 text-[13px] focus:border-[#2347D9] focus:outline-none" />
          </div>
          <button onClick={copyList} className="inline-flex items-center gap-1 text-[12.5px] text-[#2347D9] hover:underline"><Copy size={12} /> Copy list</button>
        </div>
      </div>

      {/* ── orders ── */}
      <div className="overflow-hidden rounded-[26px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(15,23,42,0.22)]">
        <div className="hidden grid-cols-[1.4fr_0.9fr_repeat(3,0.8fr)_1.2fr_24px] gap-3 border-b border-slate-100 px-5 py-3 text-[11px] font-medium uppercase tracking-wide text-slate-400 md:grid">
          <span>Order</span><span>Status</span><span className="text-right">Store</span><span className="text-right">Zoho</span><span className="text-right">Sheet</span><span>Sheet note</span><span />
        </div>
        {!data ? (
          <div className="flex items-center gap-2 px-5 py-10 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Reading the stores, Zoho index and the dispatch sheet…</div>
        ) : !rows.length ? (
          <div className="px-5 py-10 text-center text-[13px] text-slate-500">Nothing here.</div>
        ) : (
          <>
            {rows.slice(0, shown).map((r) => <OrderRow key={`${r.order}-${r.day}`} r={r} />)}
            {rows.length > shown && (
              <button onClick={() => setShown((n) => n + 120)} className="w-full border-t border-slate-100 py-3 text-[13px] font-medium text-[#2347D9] hover:bg-slate-50">Show more · {fmt(rows.length - shown)} left</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Amount({ v, base, warn }: { v: number | null; base?: number | null; warn?: boolean }) {
  const off = v != null && base != null && Math.abs(v - base) > Math.max(1, Math.abs(base) * 0.02);
  return (
    <span className={`text-right text-[13.5px] tabular-nums ${v == null ? "text-slate-300" : off || warn ? "font-medium text-orange-600" : "text-slate-800"}`}>
      {v == null ? "—" : fmt(v, 2)}
    </span>
  );
}

function OrderRow({ r }: { r: TwRow }) {
  const [open, setOpen] = useState(false);
  const s = r.sheet[0] ?? r.shipments[0];
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="grid w-full grid-cols-2 items-center gap-3 px-5 py-3 text-left hover:bg-slate-50/70 md:grid-cols-[1.4fr_0.9fr_repeat(3,0.8fr)_1.2fr_24px]">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-slate-900">{r.order}</span>
            {r.store && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">{r.store}</span>}
            <span title={r.lane === "Local" ? "Local orders / OnTrack" : "SMSA Orders"}>{r.lane === "Local" ? <Truck size={12} className="text-[#F2705E]" /> : <Plane size={12} className="text-[#6D5BFF]" />}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
            <span className="truncate">{r.day}{s?.time ? ` ${s.time}` : ""} · {r.customer || "—"}{r.gateway ? ` · ${r.gateway}` : ""}</span>
            {r.timingDays ? <span className="shrink-0 rounded bg-amber-50 px-1 text-[10.5px] text-amber-700" title={`Store ${r.storeDay} · sheet ${r.sheetDay}`}>{r.timingDays > 0 ? "+" : ""}{r.timingDays}d</span> : null}
            {r.sheetCurrency !== "AED" && <span className="shrink-0 rounded bg-sky-50 px-1 text-[10.5px] text-sky-700">{r.sheetCurrency}</span>}
            {(r.sheetRefundedAed ?? 0) > 0 && <span className="shrink-0 rounded bg-rose-50 px-1 text-[10.5px] text-rose-700">refund {fmt(r.sheetRefundedAed, 0)}</span>}
            {r.shipments.length > 0 && <span className="shrink-0 rounded bg-indigo-50 px-1 text-[10.5px] text-indigo-700">{r.shipments.length} exchange</span>}
          </span>
        </span>
        <span><span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-medium ring-1 ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span></span>
        <Amount v={r.counted ? r.oursAed : null} />
        <Amount v={r.verifiedAed} base={r.oursAed} />
        <Amount v={r.sheetAed} base={r.oursAed} warn={r.sheet.length > 1} />
        <span className="hidden truncate text-[12px] text-slate-500 md:block" title={s?.comments}>{s?.comments || (r.sheet.length ? "" : r.reason)}</span>
        <ChevronDown size={15} className={`hidden text-slate-400 transition md:block ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-3 bg-slate-50/60 px-5 pb-4 pt-1 md:grid-cols-3">
              <Detail title="Store" lines={[["Status", r.financialStatus || "—"], ["Counted sale", r.counted ? "yes" : "no"], ["Order day", r.storeDay ?? "—"], ["Country", r.country || "—"],
                ["Amount", r.oursAed == null ? "—" : `AED ${fmt(r.oursAed, 2)}`], ...(r.storeCurrency !== "AED" ? [["Original", `${r.storeCurrency} ${fmt(r.storeOriginal, 2)}`] as [string, string]] : [])]} />
              <Detail title="Zoho" lines={[["Invoice(s)", r.invoices.join(", ") || "none"], ["Invoiced", r.verifiedAed == null ? "—" : `AED ${fmt(r.verifiedAed, 2)}`]]} />
              <Detail title={s ? `${s.source} · ${s.tab === "Local" ? "Local orders" : "SMSA Orders"} row ${[...r.sheet, ...r.shipments].map((x) => x.row).join(", ")}` : "Sheet"}
                lines={s ? [
                  ["Logged", `${s.day ?? "—"}${s.time ? ` ${s.time}` : ""}${r.timingDays ? ` (${r.timingDays > 0 ? "+" : ""}${r.timingDays} days vs store)` : ""}`],
                  ["Type", `${s.kind.replace("_", " ")}${s.saleType ? ` · ${s.saleType}` : ""}`],
                  ["Amount", `${s.currency} ${fmt(s.amountOriginal, 2)}${s.currency !== "AED" ? ` · AED ${fmt(s.amountAed, 2)}${s.exchangeRate ? ` @ ${s.exchangeRate}` : ""}` : ""}`],
                  ...((s.cancelledRefundedAed ?? 0) > 0 ? [["Cancelled / refunded", `AED ${fmt(s.cancelledRefundedAed, 2)}${s.refundDate ? ` on ${s.refundDate}` : ""}`] as [string, string], ["Original sale", `AED ${fmt(s.grossAed, 2)}`] as [string, string]] : []),
                  ["Payment", [s.paymentAuthorised, s.paymentStatus].filter(Boolean).join(" · ") || "—"], ["Received", s.receivedOn || "—"],
                  ["Fee deducted", s.feeDeducted == null ? "—" : `${fmt(s.feeDeducted, 2)}${s.feePct ? ` (${s.feePct})` : ""}`], ["After deduction", s.balanceReceived == null ? "—" : fmt(s.balanceReceived, 2)],
                  ...(s.voucher || s.otInvoice ? [["Voucher / OT invoice", [s.voucher, s.otInvoice].filter(Boolean).join(" / ")] as [string, string]] : []),
                  ...(s.deliveryBy || s.shipmentStatus ? [["Delivery", [s.deliveryBy, s.shipmentStatus].filter(Boolean).join(" · ")] as [string, string]] : []),
                  ...(s.salesPerson ? [["Sales person", s.salesPerson] as [string, string]] : []),
                  ["Comment", s.comments || "—"],
                  ...r.shipments.map((x) => [`${x.saleType || x.kind}`, `${x.day ?? ""} · AED ${fmt(x.amountAed, 2)} · row ${x.row}`] as [string, string]),
                ] : [["", "Not in the dispatch sheet"]]} />
              <p className="text-[12.5px] text-slate-600 md:col-span-3"><b>Why:</b> {r.reason}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Detail({ title, lines }: { title: string; lines: [string, string][] }) {
  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-slate-100">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{title}</div>
      <dl className="space-y-1 text-[12.5px]">
        {lines.map(([k, v], i) => (
          <div key={i} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="truncate text-right text-slate-800" title={v}>{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

/* ── dashboard → sheet "Overall Sales", reason by reason ─────────────────── */

function BridgeCard({ b }: { b: Bridge }) {
  const [open, setOpen] = useState(false);
  const max = Math.max(...b.byReason.map((r) => Math.abs(r.diffAed)), 1);
  return (
    <div className="rounded-[26px] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(15,23,42,0.22)] sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[20px] font-light tracking-[-0.02em] text-slate-900">Dashboard vs the sheet&apos;s &ldquo;Overall Sales&rdquo;</h3>
          <p className="mt-1 text-[12.5px] text-slate-500">The sheet counts every row: what&apos;s left + cancelled/refunded, exchanges included. Every dirham of the gap, by reason.</p>
        </div>
        <div className="flex items-baseline gap-4 text-[13px] tabular-nums">
          <span className="text-slate-500">Dashboard <b className="text-[16px] font-medium text-slate-900">{fmt(b.dashboardAed, 2)}</b></span>
          <span className="text-slate-500">Sheet <b className="text-[16px] font-medium text-slate-900">{fmt(b.sheetAed, 2)}</b></span>
          <span className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium ${Math.abs(b.diffPct) < 0.5 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {b.diffAed >= 0 ? "+" : "−"}{fmt(Math.abs(b.diffAed), 2)} · {b.diffPct}%
          </span>
        </div>
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <ul className="space-y-2.5">
          {b.byReason.filter((r) => Math.abs(r.diffAed) >= 0.01).map((r) => (
            <li key={r.reason}>
              <div className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-slate-700">{r.label} <span className="text-slate-400">· {r.orders}</span></span>
                <span className={`tabular-nums ${r.diffAed >= 0 ? "text-slate-900" : "text-rose-600"}`}>{r.diffAed >= 0 ? "+" : "−"}{fmt(Math.abs(r.diffAed), 2)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <motion.div className={`h-full rounded-full ${r.diffAed >= 0 ? "bg-[#2347D9]" : "bg-rose-400"}`} initial={{ width: 0 }} animate={{ width: `${(Math.abs(r.diffAed) / max) * 100}%` }} transition={{ duration: 0.8 }} />
              </div>
            </li>
          ))}
        </ul>
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr><th className="pb-2 font-medium">Gateway</th><th className="pb-2 text-right font-medium">Dashboard</th><th className="pb-2 text-right font-medium">Sheet</th><th className="pb-2 text-right font-medium">Diff</th><th className="pb-2 text-right font-medium">%</th></tr>
          </thead>
          <tbody>
            {b.byGateway.map((g) => (
              <tr key={g.gateway} className="border-t border-slate-100" title={g.topReason ? `Mostly: ${g.topReason.replace(/_/g, " ")}` : undefined}>
                <td className="py-1.5 text-slate-800">{g.gateway}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">{fmt(g.dashboardAed)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">{fmt(g.sheetAed)}</td>
                <td className={`py-1.5 text-right tabular-nums ${g.diffAed < 0 ? "text-rose-600" : "text-slate-900"}`}>{g.diffAed >= 0 ? "+" : "−"}{fmt(Math.abs(g.diffAed))}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-500">{g.diffPct == null ? "—" : `${g.diffPct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => setOpen((o) => !o)} className="mt-4 text-[12.5px] font-medium text-[#2347D9] hover:underline">{open ? "Hide" : "Show"} the {b.lines.length} orders behind it</button>
      {open && (
        <div className="mt-3 max-h-80 overflow-y-auto rounded-2xl ring-1 ring-slate-100">
          <table className="w-full text-[12px]">
            <tbody>
              {b.lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{l.order}</td>
                  <td className="px-3 py-1.5 text-slate-500">{l.gateway}</td>
                  <td className="px-3 py-1.5 text-slate-600">{l.reason.replace(/_/g, " ")}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${l.diffAed < 0 ? "text-rose-600" : "text-slate-900"}`}>{l.diffAed >= 0 ? "+" : "−"}{fmt(Math.abs(l.diffAed), 2)}</td>
                  <td className="max-w-[280px] truncate px-3 py-1.5 text-slate-400" title={l.note}>{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
