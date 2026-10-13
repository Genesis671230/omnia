"use client";

/* Sales orders — the daily close of Zoho draft sales orders.
 *
 *   day chips (one per packing-sheet tab) · Backlog (drafts not on any day)
 *   stage chips → table of every order: packaging from the sheet, Zoho SO
 *   status, and after "Check" the dry-run verdict (tax fix, packaging lines,
 *   stock, amount vs the order at the fixed rate)
 *   "Close ready" writes only checked-ready orders, capped per run.
 *
 * Data: /api/sales-orders (sheet + SO list, read only), /plan (dry run),
 * /close (live, confirm: true, ≤ 25 per call). */

import { AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, Loader2, PackageCheck, Pencil, RefreshCw, Search, Settings2, ShieldCheck, Sheet, XCircle } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BoardRow, CloseResult } from "@/lib/sales-orders/so-close.service";
import type { ClosePlan } from "@/lib/sales-orders/so-plan";
import type { BatchPick } from "@/lib/sales-orders/zoho-so";
import { OrderAdjustDialog } from "@/components/finance/order-adjust-dialog";
import { SoEditor } from "./so-editor";
import { SoSettings } from "./so-settings";

type Board = { month: string; sheetId: string; days: number[]; rows: BoardRow[]; orgErrors: string[]; maxPerRun: number; rates: Record<string, number> };
/** Per order: a rate typed on the row (blank = the fixed rate). */
type RateInputs = Record<string, string>;
type PlanRes = { orderNumber: string; plan?: ClosePlan; batches?: Record<string, BatchPick[]>; invoiceDate?: string; error?: string };
type Stage = BoardRow["stage"];
type DayKey = number | "all" | "backlog";

const STAGE: Record<Stage, { label: string; tone: string; dot: string }> = {
  to_close: { label: "Draft · dispatched", tone: "bg-sky-50 text-sky-700 ring-sky-200", dot: "#0284C7" },
  confirmed: { label: "Confirmed · not invoiced", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "#4F46E5" },
  not_dispatched: { label: "Draft · not in sheet", tone: "bg-amber-50 text-amber-700 ring-amber-200", dot: "#D97706" },
  no_so: { label: "In sheet · no sales order", tone: "bg-rose-50 text-rose-700 ring-rose-200", dot: "#E11D48" },
  closed: { label: "Closed", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "#059669" },
};
const STAGES: Stage[] = ["to_close", "confirmed", "not_dispatched", "no_so", "closed"];
const CLOSABLE = new Set<Stage>(["to_close", "confirmed"]);
const MAX_PER_RUN = 25;

type Says = NonNullable<BoardRow["sheet"]>["kind"];
const SAYS: Record<Says, { label: string; tone: string; dialog: "cancelled" | "returned" | "exchanged" | null }> = {
  cancelled: { label: "Sheet: cancelled", tone: "bg-rose-50 text-rose-700 ring-rose-200", dialog: "cancelled" },
  returned: { label: "Sheet: returned / refunded", tone: "bg-orange-50 text-orange-700 ring-orange-200", dialog: "returned" },
  partial: { label: "Sheet: some items back", tone: "bg-orange-50 text-orange-700 ring-orange-200", dialog: "returned" },
  exchanged: { label: "Sheet: exchange", tone: "bg-violet-50 text-violet-700 ring-violet-200", dialog: "exchanged" },
  repair: { label: "Sheet: repair", tone: "bg-slate-50 text-slate-600 ring-slate-200", dialog: null },
  pending: { label: "Sheet: item pending", tone: "bg-amber-50 text-amber-700 ring-amber-200", dialog: null },
  note: { label: "Sheet note", tone: "bg-slate-50 text-slate-600 ring-slate-200", dialog: null },
};
/** The sheet names a cancel / return / exchange the app hasn't recorded on the order yet. */
const toRecord = (r: BoardRow) => Boolean(r.sheet && SAYS[r.sheet.kind].dialog && !r.adjustments.some((a) => a.status === "posted"));

const fmt = (n: number | null | undefined, d = 2) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!(res.headers.get("content-type") || "").includes("json")) throw new Error(`Unexpected response (${res.status}) — session may have expired`);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j as T;
}

export function SalesOrdersPanel() {
  const [month, setMonth] = useState(dubaiToday().slice(0, 7));
  const [sheet, setSheet] = useState("");
  const [data, setData] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [day, setDay] = useState<DayKey>("all");
  const [stage, setStage] = useState<Stage | "all">("to_close");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<Record<string, PlanRes>>({});
  const [results, setResults] = useState<Record<string, CloseResult>>({});
  const [checking, setChecking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [limit, setLimit] = useState(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [rateBy, setRateBy] = useState<RateInputs>({});
  const [adjusting, setAdjusting] = useState<{ uid: string; orderNumber: string; kind?: "cancelled" | "returned" | "exchanged" } | null>(null);
  const [onlyToRecord, setOnlyToRecord] = useState(false);
  // Match SO to order: scale item prices onto paid × rate when closing.
  const [matchAll, setMatchAll] = useState(false);
  const optionsFor = (orders: string[]) => Object.fromEntries(orders.map((n) => [n, {
    ...(rateBy[n] && Number(rateBy[n]) > 0 ? { rateOverride: Number(rateBy[n]) } : {}),
    ...(matchAll ? { matchOrderTotal: true } : {}),
  }]));
  // A changed rate or match setting makes earlier checks stale.
  const forget = (orders?: string[]) => setPlans((p) => {
    if (!orders) return {};
    const n = { ...p };
    for (const o of orders) delete n[o];
    return n;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await api<Board>(`/api/sales-orders?month=${month}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`);
      setData(j);
      setLimit(j.maxPerRun);
      setError("");
      setDay((d) => (d === "all" && j.days.length ? j.days[j.days.length - 1] : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month, sheet]);
  useEffect(() => { load(); }, [load]);

  // Deep link from an order's KSA dispatch card: ?month=YYYY-MM&order=OS4301
  // opens that order's editor. Read once on mount.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const m = sp.get("month"), o = sp.get("order");
    if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
    if (o) { setStage("all"); setDay("all"); setQ(o); setEditing(o.trim().toUpperCase()); }
  }, []);

  const inDay = useMemo(() => {
    const rows = data?.rows ?? [];
    if (day === "all") return rows;
    if (day === "backlog") return rows.filter((r) => r.stage === "not_dispatched");
    return rows.filter((r) => r.day === day);
  }, [data, day]);
  const counts = useMemo(() => {
    const c: Partial<Record<Stage, number>> = {};
    for (const r of inDay) c[r.stage] = (c[r.stage] ?? 0) + 1;
    return c;
  }, [inDay]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (onlyToRecord ? data?.rows ?? [] : inDay)
      .filter((r) => onlyToRecord ? toRecord(r) : stage === "all" || r.stage === stage)
      .filter((r) => !needle || r.orderNumber.toLowerCase().includes(needle) || (r.so?.customer ?? "").toLowerCase().includes(needle));
  }, [inDay, stage, q, onlyToRecord, data]);
  // Month-end view: what the dispatch sheet says vs what is recorded in the app.
  const sheetTally = useMemo(() => {
    const t = { cancelled: [0, 0], returned: [0, 0], exchanged: [0, 0] } as Record<"cancelled" | "returned" | "exchanged", [number, number]>;
    for (const r of data?.rows ?? []) {
      const d = r.sheet ? SAYS[r.sheet.kind].dialog : null;
      if (!d) continue;
      t[d][0] += 1;
      if (!toRecord(r)) t[d][1] += 1;
    }
    return t;
  }, [data]);
  const dayBacklog = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of data?.rows ?? []) if (r.day != null && CLOSABLE.has(r.stage)) m.set(r.day, (m.get(r.day) ?? 0) + 1);
    return m;
  }, [data]);

  const selectable = rows.filter((r) => CLOSABLE.has(r.stage));
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.orderNumber));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(selectable.map((r) => r.orderNumber)));
  const toggle = (n: string) => setPicked((p) => { const s = new Set(p); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  const readyPicked = [...picked].filter((n) => plans[n]?.plan?.state === "ready" && !results[n]);

  async function check(orders = [...picked]) {
    if (!orders.length) return toast.info("Pick orders to check");
    setChecking(true);
    setArmed(false);
    try {
      const out: Record<string, PlanRes> = {};
      for (let i = 0; i < orders.length; i += 30) {
        const j = await api<{ plans: PlanRes[]; missing: string[] }>("/api/sales-orders/plan", { method: "POST", body: JSON.stringify({ month, orders: orders.slice(i, i + 30), sheet: sheet || undefined, options: optionsFor(orders.slice(i, i + 30)) }) });
        for (const p of j.plans) out[p.orderNumber] = p;
      }
      setPlans((p) => ({ ...p, ...out }));
      const ready = Object.values(out).filter((p) => p.plan?.state === "ready").length;
      toast.success(`${ready} of ${orders.length} ready to close`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function closeReady() {
    if (!armed) { setArmed(true); return; }
    const orders = readyPicked.slice(0, limit);
    setClosing(true);
    setArmed(false);
    try {
      const j = await api<{ results: CloseResult[] }>("/api/sales-orders/close", { method: "POST", body: JSON.stringify({ month, orders, confirm: true, limit, sheet: sheet || undefined, options: optionsFor(orders) }) });
      const out: Record<string, CloseResult> = {};
      for (const r of j.results) out[r.orderNumber] = r;
      setResults((p) => ({ ...p, ...out }));
      const done = j.results.filter((r) => r.outcome === "closed").length;
      const failed = j.results.filter((r) => r.outcome === "failed").length;
      (failed ? toast.warning : toast.success)(`${done} closed${failed ? ` · ${failed} failed` : ""}`);
      setPicked(new Set());
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── header ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-light tracking-tight text-slate-900">Sales orders</h1>
          <p className="text-[13px] text-slate-500">Draft sales orders closed from the packing sheet: tax by region, boxes &amp; bags added, stock checked, invoiced.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPlans({}); setResults({}); setPicked(new Set()); setDay("all"); }}
            className="h-9 rounded-full border border-slate-200 bg-white px-3 text-[13px]" />
          <div className="relative">
            <Sheet size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={sheet} onChange={(e) => setSheet(e.target.value)} onBlur={() => sheet && load()} placeholder="Packing sheet link (other months)"
              className="h-9 w-64 rounded-full border border-slate-200 bg-white pl-8 pr-3 text-[13px] focus:border-[#2347D9] focus:outline-none" />
          </div>
          <button onClick={() => setShowSettings(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            <Settings2 size={14} /> Settings
          </button>
          <button onClick={load} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">{error}</div>}
      {data?.orgErrors.map((e) => <div key={e} className="rounded-2xl bg-amber-50 px-4 py-2 text-[12.5px] text-amber-800 ring-1 ring-amber-200">{e}</div>)}

      {/* ── days ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setDay("all")} className={`rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${day === "all" ? "bg-[#0F1B3D] text-white ring-[#0F1B3D]" : "bg-white text-slate-700 ring-slate-200"}`}>Whole month</button>
        {(data?.days ?? []).map((d) => {
          const left = dayBacklog.get(d) ?? 0;
          return (
            <button key={d} onClick={() => setDay(d)} title={left ? `${left} still to close` : "All closed"}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${day === d ? "bg-[#0F1B3D] text-white ring-[#0F1B3D]" : "bg-white text-slate-700 ring-slate-200"}`}>
              Day {d}
              {left ? <span className={`rounded-full px-1.5 text-[10.5px] ${day === d ? "bg-white/20" : "bg-sky-100 text-sky-700"}`}>{left}</span> : <CheckCircle2 size={12} className={day === d ? "text-emerald-300" : "text-emerald-500"} />}
            </button>
          );
        })}
        <button onClick={() => { setDay("backlog"); setStage("all"); }} className={`rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${day === "backlog" ? "bg-amber-500 text-white ring-amber-500" : "bg-white text-amber-700 ring-amber-200"}`}>
          Backlog · not in sheet {fmt((data?.rows ?? []).filter((r) => r.stage === "not_dispatched").length, 0)}
        </button>
      </div>

      {/* ── stages + actions ── */}
      <div className="flex flex-wrap items-center gap-2">
        {STAGES.map((st) => counts[st] ? (
          <button key={st} onClick={() => setStage(st)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${stage === st ? STAGE[st].tone : "bg-white text-slate-700 ring-slate-200"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: STAGE[st].dot }} />{STAGE[st].label} · {counts[st]}
          </button>
        ) : null)}
        <button onClick={() => setStage("all")} className={`rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${stage === "all" ? "bg-[#0F1B3D] text-white ring-[#0F1B3D]" : "bg-white text-slate-700 ring-slate-200"}`}>All · {inDay.length}</button>
        <div className="relative ml-auto">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order or customer" className="h-9 w-48 rounded-full border border-slate-200 bg-white pl-8 pr-3 text-[13px] focus:border-[#2347D9] focus:outline-none" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[22px] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_14px_34px_-26px_rgba(15,23,42,0.25)]">
        <span className="text-[13px] text-slate-600">{picked.size} picked · {readyPicked.length} checked ready</span>
        <button onClick={() => check()} disabled={checking || !picked.size} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
          {checking ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Check (dry run)
        </button>
        <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600" title="Scale the item prices so each sales order totals exactly what the customer paid × the rate (shipping untouched; gaps over 1% stay flagged)">
          <input type="checkbox" checked={matchAll} onChange={(e) => { setMatchAll(e.target.checked); forget(); }} />
          Match SO to order (paid × rate)
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-slate-500">
          Max per run
          <input type="number" min={1} max={MAX_PER_RUN} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(MAX_PER_RUN, Number(e.target.value) || 1)))}
            className="h-8 w-14 rounded-lg border border-slate-200 px-2 text-[13px]" />
        </label>
        <button onClick={closeReady} disabled={closing || !readyPicked.length}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-white disabled:opacity-50 ${armed ? "bg-rose-600 hover:bg-rose-700" : "bg-[#2347D9] hover:bg-[#1c3bb8]"}`}>
          {closing ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
          {armed ? `Confirm: write ${Math.min(limit, readyPicked.length)} to Zoho` : `Close ready · ${Math.min(limit, readyPicked.length)}`}
        </button>
        {armed && <button onClick={() => setArmed(false)} className="text-[12.5px] text-slate-500 hover:underline">Cancel</button>}
      </div>

      {/* ── dispatch sheet: cancellations / returns / exchanges this month ── */}
      {data && sheetTally.cancelled[0] + sheetTally.returned[0] + sheetTally.exchanged[0] > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-slate-500">Dispatch sheet this month:</span>
          {(["cancelled", "returned", "exchanged"] as const).map((k) => (
            <span key={k} className="rounded-full bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-200">
              {k === "returned" ? "Returns / refunds" : k === "cancelled" ? "Cancellations" : "Exchanges"} <b>{sheetTally[k][0]}</b> · recorded {sheetTally[k][1]}
            </span>
          ))}
          <button onClick={() => setOnlyToRecord((v) => !v)} className={`rounded-full px-3 py-1 ring-1 ${onlyToRecord ? "bg-orange-500 text-white ring-orange-500" : "bg-white text-orange-700 ring-orange-200"}`}>
            {onlyToRecord ? "Showing" : "Show"} to record · {(data.rows ?? []).filter(toRecord).length}
          </button>
        </div>
      )}

      {/* ── table ── */}
      <div className="overflow-x-auto rounded-[26px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(15,23,42,0.22)]">
        <table className="w-full min-w-[980px] text-left text-[13px]">
          <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={!selectable.length} /></th>
              <th className="px-2 py-3 font-medium">Day</th>
              <th className="px-2 py-3 font-medium">Order · gateway</th>
              <th className="px-2 py-3 font-medium">Zoho sales order</th>
              <th className="px-2 py-3 text-right font-medium">SO total</th>
              <th className="px-2 py-3 text-right font-medium">Paid · rate · AED</th>
              <th className="px-2 py-3 font-medium">Packaging (sheet)</th>
              <th className="px-2 py-3 font-medium">Check</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr><td colSpan={8} className="px-5 py-10 text-slate-500"><Loader2 size={14} className="mr-2 inline animate-spin" />Reading the packing sheet and Zoho sales orders…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">Nothing here.</td></tr>
            ) : rows.map((r) => <Row key={r.orderNumber} r={r} rates={data?.rates ?? {}} rate={rateBy[r.orderNumber] ?? ""} onRate={(v) => { setRateBy((m) => ({ ...m, [r.orderNumber]: v })); forget([r.orderNumber]); }} picked={picked.has(r.orderNumber)} onPick={() => toggle(r.orderNumber)} plan={plans[r.orderNumber]} result={results[r.orderNumber]} onCheck={() => check([r.orderNumber])} onEdit={() => setEditing(r.orderNumber)} onReload={load}
              onAdjust={r.order?.uid ? () => setAdjusting({ uid: r.order!.uid, orderNumber: r.orderNumber, kind: (r.sheet && SAYS[r.sheet.kind].dialog) || undefined }) : undefined} />)}
          </tbody>
        </table>
      </div>
      {editing && <SoEditor month={month} order={editing} sheet={sheet || undefined} onClose={() => setEditing(null)} onSaved={() => { setPlans((p) => { const n = { ...p }; delete n[editing]; return n; }); load(); }} />}
      {adjusting && <OrderAdjustDialog uid={adjusting.uid} orderNumber={adjusting.orderNumber} initialKind={adjusting.kind} onClose={() => setAdjusting(null)} onDone={load} />}
      {showSettings && <SoSettings onClose={() => setShowSettings(false)} onSaved={() => { setPlans({}); load(); }} />}
    </div>
  );
}

/** Where the money comes from. COD closes at AED 0 here — the sale is in House of Omnia. */
function GatewayChip({ gateway }: { gateway?: string | null }) {
  if (!gateway) return <span className="rounded px-1.5 py-0.5 text-[10.5px] font-normal text-slate-400 ring-1 ring-slate-200">no gateway</span>;
  const cod = gateway.trim().toUpperCase() === "COD";
  return (
    <span title={cod ? "Cash on delivery — this sales order closes at AED 0; the invoice in House of Omnia is marked paid" : undefined}
      className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ${cod ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>
      {cod ? "COD · AED 0" : gateway}
    </span>
  );
}

/** COD: where the sale is booked (House of Omnia invoice) and, when this org's
 *  invoice was closed at full value by hand, a dry-run-then-confirm "zero it". */
function CodLine({ r, onDone }: { r: BoardRow; onDone: () => void }) {
  const cod = r.cod!;
  const [state, setState] = useState<"idle" | "checking" | "armed" | "applying">("idle");
  const [msg, setMsg] = useState("");
  async function go() {
    if (state === "idle") {
      setState("checking");
      try {
        const d = await api<{ state: string; reason: string; org: string }>("/api/sales-orders/cod-zero", { method: "POST", body: JSON.stringify({ order: r.orderNumber }) });
        setMsg(`${d.org}: ${d.reason}`);
        setState(d.state === "fix" ? "armed" : "idle");
      } catch (e) { setMsg((e as Error).message); setState("idle"); }
      return;
    }
    if (state === "armed") {
      setState("applying");
      try {
        const d = await api<{ state: string; steps: string[] }>("/api/sales-orders/cod-zero", { method: "POST", body: JSON.stringify({ order: r.orderNumber, apply: true }) });
        setMsg(d.steps.join(" · "));
        (d.state === "ok" ? toast.success : toast.warning)(`${r.orderNumber}: ${d.steps[0] ?? d.state}`);
        setState("idle");
        onDone();
      } catch (e) { setMsg((e as Error).message); setState("idle"); }
    }
  }
  return (
    <div className="mt-0.5 max-w-[360px] text-[11px]">
      <div className={cod.codInvoice ? "text-slate-500" : "text-amber-700"}>
        COD · {cod.codOrgLabel}: {cod.codInvoice ? `${cod.codInvoice.number} · AED ${fmt(cod.codInvoice.total)} · ${cod.codInvoice.status}` : "no invoice yet"}
      </div>
      {cod.fullValue && (
        <div className="flex flex-wrap items-center gap-1.5 text-rose-700">
          <span>Closed here at AED {fmt(r.so?.total)} — must be AED 0</span>
          {!cod.codInvoice && <span className="text-amber-700">· create the {cod.codOrgLabel} invoice first, or the sale is booked nowhere</span>}
          <button onClick={go} disabled={state === "checking" || state === "applying" || !cod.codInvoice}
            className={`rounded px-1.5 py-0.5 text-[10.5px] ring-1 ${state === "armed" ? "bg-rose-600 text-white ring-rose-600" : "bg-white ring-rose-200 hover:bg-rose-50"}`}>
            {state === "checking" ? "Checking…" : state === "applying" ? "Zeroing…" : state === "armed" ? "Confirm: set to AED 0" : "Zero it"}
          </button>
        </div>
      )}
      {msg && <div className="text-slate-600">{msg}</div>}
    </div>
  );
}

/** What the dispatch sheet says about the order, what the app has recorded,
 *  and the way in: cancel / return some items / exchange a size, per line. */
function SheetLine({ r, onAdjust }: { r: BoardRow; onAdjust?: () => void }) {
  const says = r.sheet ? SAYS[r.sheet.kind] : null;
  const posted = r.adjustments.filter((a) => a.status === "posted");
  const failed = r.adjustments.filter((a) => a.status === "error");
  if (!says && !r.adjustments.length && r.stage !== "closed") return null;
  return (
    <div className="mt-0.5 flex max-w-[380px] flex-wrap items-center gap-1 text-[11px]">
      {says && <span className={`rounded px-1.5 py-0.5 ring-1 ${says.tone}`} title={r.sheet!.notes.join("\n")}>{says.label}{r.sheet!.refundedAed ? ` · AED ${fmt(r.sheet!.refundedAed)}` : ""}</span>}
      {r.sheet?.notes.length ? <span className="italic text-slate-500">“{r.sheet.notes.join(" · ")}”</span> : null}
      {posted.map((a, i) => (
        <span key={i} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200" title={a.markOnly ? "Marked only — no Zoho document from the app" : undefined}>
          {a.kind}{a.creditNote ? ` · ${a.creditNote}` : ""}{a.exchangeInvoice ? ` · ${a.exchangeInvoice}` : ""}{a.creditAed ? ` · AED ${fmt(a.creditAed)}` : ""}
        </span>
      ))}
      {failed.length ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 ring-1 ring-rose-200">{failed.length} adjustment failed — open to retry</span> : null}
      {onAdjust && (r.stage === "closed" || says?.dialog) && (
        <button onClick={onAdjust} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ring-1 ${toRecord(r) ? "bg-orange-500 text-white ring-orange-500" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
          title="Cancel, return some or all items, refund, or exchange (e.g. another size) — per line, with the Zoho credit note">
          <ArrowLeftRight size={11} />{toRecord(r) ? "Record it" : "Return / exchange…"}
        </button>
      )}
    </div>
  );
}

/** What the customer paid, the rate (editable per order) and the AED it makes. */
function PaidCell({ r, p, rates, rate, onRate, editable }: { r: BoardRow; p?: ClosePlan; rates: Record<string, number>; rate: string; onRate: (v: string) => void; editable: boolean }) {
  const cur = (r.order?.currency ?? "").toUpperCase();
  const paid = r.order?.grossOriginal;
  if (!cur || paid == null) return <span className="text-slate-400">—</span>;
  const fixed = rates[cur];
  const used = rate && Number(rate) > 0 ? Number(rate) : fixed;
  const aed = p?.fx?.aed ?? (used != null ? Math.round(paid * used * 100) / 100 : null);
  const diff = p && p.state !== "closed" && !p.cod && aed != null ? Math.round((p.expectedTotal - aed) * 100) / 100 : null;
  const foreign = cur !== "AED";
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[11.5px] text-slate-500">{cur} {fmt(paid)}</span>
      <span className="flex items-center gap-1 text-[11.5px] text-slate-500">
        ×
        {editable && foreign ? (
          <input value={rate} onChange={(e) => onRate(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={fixed != null ? String(fixed) : "rate"}
            title={`Fixed rate ${cur} ${fixed ?? "—"} — type another for this order`}
            className={`h-6 w-16 rounded border px-1 text-right text-[11.5px] ${rate ? "border-sky-400 text-sky-700" : "border-slate-200"}`} />
        ) : <span>{used ?? "—"}</span>}
      </span>
      <span className={`font-medium ${p?.issues.some((i) => i.code === "amount_diff") ? "text-orange-600" : "text-slate-800"}`}>AED {fmt(aed)}</span>
      {p?.cod && <span className="text-[10.5px] text-slate-500" title="COD: the sale is booked in House of Omnia; this SO closes at AED 0">COD · SO at AED 0</span>}
      {diff != null && Math.abs(diff) >= 0.01 && <span className="text-[10.5px] text-orange-600" title="SO total after the fixes minus paid × rate">SO {diff > 0 ? "+" : ""}{fmt(diff)}</span>}
    </div>
  );
}

function Row({ r, rates, rate, onRate, picked, onPick, plan, result, onCheck, onEdit, onReload, onAdjust }: { r: BoardRow; rates: Record<string, number>; rate: string; onRate: (v: string) => void; onReload: () => void; picked: boolean; onPick: () => void; plan?: PlanRes; result?: CloseResult; onCheck: () => void; onEdit: () => void; onAdjust?: () => void }) {
  const [open, setOpen] = useState(false);
  const p = plan?.plan;
  const st = STAGE[r.stage];
  const verdict = result
    ? result.outcome === "closed" ? { t: `Closed · ${result.invoice}`, c: "text-emerald-700", I: CheckCircle2 }
      : result.outcome === "failed" ? { t: "Failed", c: "text-rose-700", I: XCircle } : { t: "Skipped", c: "text-amber-700", I: AlertTriangle }
    : plan?.error ? { t: "Check failed", c: "text-rose-700", I: XCircle }
    : p ? p.state === "ready" ? { t: "Ready", c: "text-emerald-700", I: CheckCircle2 } : p.state === "closed" ? { t: "Closed", c: "text-slate-500", I: CheckCircle2 } : { t: `${p.issues.filter((i) => i.blocking).length} to fix`, c: "text-rose-700", I: AlertTriangle }
    : null;
  return (
    <Fragment>
      <tr className="border-b border-slate-100 hover:bg-slate-50/60">
        <td className="px-4 py-2.5"><input type="checkbox" checked={picked} onChange={onPick} disabled={!CLOSABLE.has(r.stage)} /></td>
        <td className="px-2 py-2.5 tabular-nums text-slate-500">{r.day ?? "—"}{r.duplicateDays.length ? <span className="ml-1 rounded bg-violet-50 px-1 text-[10.5px] text-violet-700" title="Also on these day tabs">+{r.duplicateDays.join(",")}</span> : null}</td>
        <td className="px-2 py-2.5">
          <div className="flex items-center gap-1.5 font-medium text-slate-900">{r.orderNumber}<GatewayChip gateway={r.order?.gateway} />
            {r.ksa && <span className={`rounded px-1.5 py-0.5 text-[10.5px] ring-1 ${r.ksa.issues.length ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`} title={r.ksa.issues.join("\n") || "Sent from SMSA Fulfillment KSA"}>KSA{r.ksa.split ? " · split" : ""}{r.ksa.issues.length ? " · flagged" : ""}</span>}
          </div>
          {r.ksa?.issues.length ? <div className="mt-0.5 max-w-[340px] text-[11px] text-rose-700">{r.ksa.issues.join(" · ")}</div> : null}
          {r.cod && <CodLine r={r} onDone={onReload} />}
          <SheetLine r={r} onAdjust={onAdjust} />
          <div className="text-[11.5px] text-slate-500">{r.order?.country ?? "?"}{r.order?.currency && r.order.currency !== "AED" ? ` · ${r.order.currency} ${fmt(r.order.grossOriginal)}` : ""}</div>
        </td>
        <td className="px-2 py-2.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] ring-1 ${st.tone}`}><span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />{r.so ? r.so.status : "none"}</span>
          <div className="mt-0.5 max-w-[220px] truncate text-[11.5px] text-slate-500">{r.so ? `${r.so.date} · ${r.so.customer}` : st.label}</div>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-slate-800">{fmt(r.so?.total)}{p && p.state !== "closed" && p.expectedTotal !== p.soTotal ? <div className="text-[11px] text-sky-700">→ {fmt(p.expectedTotal)}</div> : null}</td>
        <td className="px-2 py-2.5 text-right tabular-nums"><PaidCell r={r} p={p} rates={rates} rate={rate} onRate={onRate} editable={CLOSABLE.has(r.stage)} /></td>
        <td className="px-2 py-2.5">
          <div className="flex max-w-[260px] flex-wrap gap-1">
            {r.packaging.length ? r.packaging.map((x) => <span key={x.sku} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700" title={x.description}>{x.qty > 1 ? `${x.qty}× ` : ""}{x.sku}</span>) : <span className="text-[11.5px] text-slate-400">{r.day == null ? "not on sheet" : "none listed"}</span>}
          </div>
        </td>
        <td className="px-2 py-2.5">
          {verdict ? (
            <button onClick={() => setOpen((o) => !o)} className={`inline-flex items-center gap-1 text-[12.5px] font-medium ${verdict.c}`}>
              <verdict.I size={13} />{verdict.t}<ChevronDown size={12} className={open ? "rotate-180" : ""} />
            </button>
          ) : CLOSABLE.has(r.stage) ? (
            <button onClick={onCheck} className="text-[12.5px] text-[#2347D9] hover:underline">Check</button>
          ) : <span className="text-[12px] text-slate-400">—</span>}
          {CLOSABLE.has(r.stage) && <button onClick={onEdit} title="Edit sales order" className="ml-2 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-[#2347D9]"><Pencil size={12} />Edit</button>}
        </td>
      </tr>
      {open && (p || plan?.error || result) && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td />
          <td colSpan={7} className="px-2 py-3 text-[12.5px]">
            <div className="grid gap-3 md:grid-cols-3">
              {p && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Will change · {p.region} {p.country}</div>
                  {p.changes.length ? p.changes.map((c) => <div key={c} className="text-slate-700">• {c}</div>) : <div className="text-slate-400">Nothing</div>}
                  {plan?.invoiceDate && <div className="mt-1 text-slate-500">Invoice dated {plan.invoiceDate}</div>}
                  {Object.values(plan?.batches ?? {}).flat().map((b) => <div key={b.batch_id} className="text-slate-500">Batch {b.batch_number} × {b.out_quantity} (FIFO)</div>)}
                </div>
              )}
              {p && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Flags</div>
                  {p.issues.length ? p.issues.map((i) => (
                    <div key={i.message} className={i.blocking ? "text-rose-700" : "text-amber-700"}>{i.blocking ? "✕" : "!"} {i.message}</div>
                  )) : <div className="text-emerald-700">None — inventory and amounts check out</div>}
                </div>
              )}
              {(result || plan?.error) && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Run</div>
                  {plan?.error && <div className="text-rose-700">{plan.error}</div>}
                  {result?.steps.map((s) => <div key={s} className="text-slate-700">• {s}</div>)}
                  {result?.issues?.map((i) => <div key={i.message} className="text-rose-700">✕ {i.message}</div>)}
                  {result?.error && <div className="text-rose-700">{result.error}</div>}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
