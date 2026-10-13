"use client";

/* Admin tab — the money at a glance, styled after the founder's violet
   reference (2026-10-13): a sales curve with its values printed on it, a
   "where the money is" donut, gradient summary cards, the upload log, one row
   per day (1st of the range first, each opening into its gateways) with the
   money summary under it, and a gateways section with its own date range.

   Every figure comes from /api/dashboard/admin-money, where day, gateway and
   order rows are sums of the same order rows. Fees are never estimated: an
   order with no payout file has no deduction and its whole sale is pending.
   Drawer is portaled with self-contained hex (see the modal portal fix:
   position:fixed inside the dashboard breaks). */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Area, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Download, Loader2, RefreshCw, X, CheckCircle2, AlertTriangle, Clock, ChevronRight, Landmark, Upload, List } from "lucide-react";
import { toast } from "sonner";

/* ── shapes (mirror lib/dashboard/admin-money) ─────────────────────────── */

type Totals = {
  orders: number; sale: number; fee: number; vat: number; deductions: number; refunds: number; netPayout: number;
  fx: number; netReceived: number; awaiting: number; inPayout: number; overdue: number; overdueOrders: number; deductionRate: number; avgDaysToBank: number | null;
};
type Cancelled = { orders: number; amount: number };
type CancelledRow = { day: string; orderNumber: string; store: string; customer: string; gateway: string; amount: number; creditNote: string; cancelledOn: string };
type DayRow = Totals & { day: string; cancelled: Cancelled };
type GatewayRow = Totals & { gateway: string; expectedDays: number; oldestAwaitingDays: number; cancelled: Cancelled };
type OrderRow = {
  uid: string; day: string; orderNumber: string; store: string; customer: string; gateway: string;
  sale: number; fee: number; vat: number; deductions: number; refunds: number; netPayout: number; fx: number; netReceived: number; awaiting: number; inPayout: number;
  status: "received" | "awaiting" | "overdue" | "refunded"; receivedOn: string | null; ageDays: number; overdueDays: number; reason: string;
};
type View = {
  from: string; to: string; today: string; totals: Totals & { cancelled: Cancelled }; days: DayRow[]; gateways: GatewayRow[]; orders: OrderRow[];
  cancelled: CancelledRow[];
  overdue: { gateway: string; amount: number; orders: number; oldestDays: number; oldestOrder: string }[];
  missingPayoutFiles: { gateway: string; orders: number; grossAed: number }[];
};
type Uploads = {
  latestPayouts: { gateway: string; payoutId: string; store: string | null; netAed: number; orders: number | null; uploadedAt: string; source: string; viaApi: boolean; last30: number }[];
  latestBank: UploadEvent | null;
  events: UploadEvent[];
};
type UploadEvent = { kind: "bank" | "payout"; provider: string | null; filename: string; summary: string | null; uploadedAt: string };

/* ── palette (the reference: violet rail, electric blue, lilac, sky) ───── */

const C = { ink: "#16133A", violet: "#4C24A8", lilac: "#B86BF5", blue: "#1D5BFF", sky: "#1FB5FF", amber: "#F5A524", red: "#EF4444", line: "#E2DFF1", muted: "#2A2752", faint: "#4A4770" };

/* ── helpers ───────────────────────────────────────────────────────────── */

const n2 = (v: number) => new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const n0 = (v: number) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(v || 0);
const canc = (c?: Cancelled): ReactNode => (c && c.orders ? <>{n2(c.amount)}<i>{c.orders} {c.orders === 1 ? "order" : "orders"}</i></> : "—");
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};

/** The gateways' own logos (public/gateways); a plain name chip for anything else. */
const LOGOS: Record<string, string> = {
  stripe: "/gateways/stripe.png", tabby: "/gateways/tabby.png", tamara: "/gateways/tamara.png", telr: "/gateways/telr.png",
  "shopify payments": "/gateways/shopify.svg", shopify: "/gateways/shopify.svg", checkout: "/gateways/checkout.svg", cod: "/gateways/cod.svg",
};
const WIDE = new Set(["tamara", "telr", "checkout"]);
function GwLogo({ name, size = 22 }: { name: string; size?: number }) {
  const key = (name || "").trim().toLowerCase();
  const src = LOGOS[key];
  if (!src) return <span className="gwl none" style={{ height: size, minWidth: size }}>{(name || "?").slice(0, 1)}</span>;
  return <span className={`gwl${WIDE.has(key) ? " wide" : ""}`} style={{ height: size, width: WIDE.has(key) ? size * 2.6 : size }}><img src={src} alt={name} /></span>;
}
function Gw({ name, size }: { name: string; size?: number }) {
  return <span className="gwn"><GwLogo name={name} size={size} /><span>{name}</span></span>;
}
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
/** Fee + VAT + FX — everything the gateways and the bank kept. */
const kept = (t: Totals) => t.deductions + t.fx;
const keptRate = (t: Totals) => (t.sale > 0 ? kept(t) / t.sale : 0);

function sum(rows: OrderRow[]): Totals {
  const t: Totals = { orders: 0, sale: 0, fee: 0, vat: 0, deductions: 0, refunds: 0, netPayout: 0, fx: 0, netReceived: 0, awaiting: 0, inPayout: 0, overdue: 0, overdueOrders: 0, deductionRate: 0, avgDaysToBank: null };
  let bd = 0, bn = 0;
  for (const r of rows) {
    t.orders++; t.sale += r.sale; t.fee += r.fee; t.vat += r.vat; t.deductions += r.deductions; t.refunds += r.refunds;
    t.netPayout += r.netPayout; t.fx += r.fx; t.netReceived += r.netReceived; t.awaiting += r.awaiting; t.inPayout += r.inPayout;
    if (r.status === "overdue") { t.overdue += r.awaiting; t.overdueOrders++; }
    if (r.status === "received" && r.receivedOn) { bd += r.ageDays; bn++; }
  }
  t.deductionRate = t.sale > 0 ? t.deductions / t.sale : 0;
  t.avgDaysToBank = bn ? Math.round((bd / bn) * 10) / 10 : null;
  return t;
}
type GwGroup = Totals & { gateway: string; oldest: number };
function groupByGateway(rows: OrderRow[]): GwGroup[] {
  const m = new Map<string, OrderRow[]>();
  for (const r of rows) m.set(r.gateway, [...(m.get(r.gateway) ?? []), r]);
  return [...m.entries()].map(([gateway, list]) => ({ gateway, ...sum(list), oldest: list.reduce((a, r) => (r.awaiting > 0 ? Math.max(a, r.ageDays) : a), 0) })).sort((a, b) => b.sale - a.sale);
}

type Range = { key: string; from: string; to: string };
function presets(today: string): Range[] {
  const m0 = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(m0, -1);
  return [
    { key: "This month", from: m0, to: today },
    { key: "Last month", from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    { key: "Last 7 days", from: addDays(today, -6), to: today },
    { key: "Yesterday", from: addDays(today, -1), to: addDays(today, -1) },
    { key: "Today", from: today, to: today },
  ];
}
const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

async function download(qs: string, name: string) {
  const res = await fetch(`/api/dashboard/admin-money/export?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function useAdminMoney(range: Range) {
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/admin-money?from=${range.from}&to=${range.to}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setView(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);
  return { view, loading, error, load };
}

function RangePicker({ range, setRange, today, children }: { range: Range; setRange: (r: Range) => void; today: string; children?: ReactNode }) {
  return (
    <div className="adm-bar">
      <div className="adm-presets">
        {presets(today).map((p) => (
          <button key={p.key} className={range.key === p.key ? "on" : ""} onClick={() => setRange(p)}>{p.key}</button>
        ))}
      </div>
      <div className="adm-dates">
        <input type="date" value={range.from} max={today} onChange={(e) => e.target.value && setRange({ key: "Custom", from: e.target.value, to: range.to < e.target.value ? e.target.value : range.to })} />
        <span>→</span>
        <input type="date" value={range.to} max={today} onChange={(e) => e.target.value && setRange({ key: "Custom", from: range.from > e.target.value ? e.target.value : range.from, to: e.target.value })} />
        {children}
      </div>
    </div>
  );
}

/* ── main ──────────────────────────────────────────────────────────────── */

type DrawerState = { title: string; sub: string; orders: OrderRow[]; cancelled: CancelledRow[]; exportQs: string; exportName: string };

export function AdminMoney() {
  const today = dubaiToday();
  const [range, setRange] = useState<Range>(presets(today)[0]);
  const { view, loading, error, load } = useAdminMoney(range);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());

  const exportXlsx = async (key: string, qs: string, name: string) => {
    setExporting(key);
    try { await download(qs, name); } catch (e) { toast.error(`Export failed: ${(e as Error).message}`); } finally { setExporting(null); }
  };

  // On-screen proof that the views agree.
  const check = useMemo(() => {
    if (!view) return null;
    const keys: (keyof Totals)[] = ["sale", "deductions", "fx", "netReceived", "awaiting"];
    const daySum = (k: keyof Totals) => view.days.reduce((a, d) => a + (d[k] as number), 0);
    const gwSum = (k: keyof Totals) => view.gateways.reduce((a, g) => a + (g[k] as number), 0);
    const ok = keys.every((k) => Math.abs(daySum(k) - (view.totals[k] as number)) < 0.05 && Math.abs(gwSum(k) - (view.totals[k] as number)) < 0.05);
    const t = view.totals;
    const foot = Math.abs(t.deductions + t.refunds + t.fx + t.netReceived + t.awaiting - t.sale) < 0.05;
    return { ok: ok && foot };
  }, [view]);

  // Each day's gateways, from the same order rows.
  const dayGateways = useMemo(() => {
    const m = new Map<string, GwGroup[]>();
    if (!view) return m;
    const byDay = new Map<string, OrderRow[]>();
    for (const o of view.orders) byDay.set(o.day, [...(byDay.get(o.day) ?? []), o]);
    for (const [d, rows] of byDay) m.set(d, groupByGateway(rows));
    return m;
  }, [view]);

  const openDay = (d: DayRow) => {
    if (!view) return;
    setDrawer({
      title: dayLabel(d.day), sub: `${d.orders} orders${d.cancelled.orders ? ` · ${d.cancelled.orders} cancelled` : ""}`, orders: view.orders.filter((o) => o.day === d.day),
      cancelled: view.cancelled.filter((c) => c.day === d.day),
      exportQs: `from=${d.day}&to=${d.day}`, exportName: `omnia-admin-money-${d.day}.xlsx`,
    });
  };
  const toggleDay = (day: string) => setOpenDays((s) => { const n = new Set(s); if (n.has(day)) n.delete(day); else n.add(day); return n; });

  const t = view?.totals;

  return (
    <div className="adm">
      <style>{CSS}</style>

      <div className="adm-title">
        <div>
          <h1>Money</h1>
          <span>Today, {longDate(today)}</span>
        </div>
        <RangePicker range={range} setRange={setRange} today={today}>
          <button className="adm-icon" title="Refresh from the latest payouts" onClick={() => load(true)} disabled={loading}>
            {loading ? <Loader2 size={14} className="adm-spin" /> : <RefreshCw size={14} />}
          </button>
          <button className="adm-btn" disabled={!view || exporting === "all"} onClick={() => view && exportXlsx("all", `from=${view.from}&to=${view.to}`, `omnia-admin-money-${view.from}_${view.to}.xlsx`)}>
            {exporting === "all" ? <Loader2 size={13} className="adm-spin" /> : <Download size={13} />} Excel
          </button>
        </RangePicker>
      </div>

      {error && <div className="adm-err"><AlertTriangle size={14} /> {error}</div>}
      {!view && loading && <div className="adm-loading"><Loader2 size={16} className="adm-spin" /> Loading the money…</div>}

      {view && t && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* curve + donut, like the reference's Spent summary / Financial record */}
          <div className="adm-hero-grid">
            <section className="adm-card">
              <header><h2>Sales summary</h2><span>gross sales and what reached the bank, per day · AED</span></header>
              <SalesCurve days={view.days} />
            </section>
            <section className="adm-card">
              <header><h2>Where the money is</h2><span>share of gross sales</span></header>
              <MoneyDonut t={t} />
            </section>
          </div>

          {/* gradient cards */}
          <div className="adm-cards">
            <GradCard tone="lilac" label="Gross sales" value={`AED ${n2(t.sale)}`} sub={`${t.orders} orders${t.cancelled.orders ? ` · ${t.cancelled.orders} cancelled (not sales)` : ""}`} />
            <GradCard tone="blue" label="Net received in bank" value={`AED ${n2(t.netReceived)}`} sub={t.avgDaysToBank != null ? `${t.avgDaysToBank} days to bank on average` : "nothing in the bank yet"} />
            <GradCard tone="deep" label="Pending" value={`AED ${n2(t.awaiting)}`} sub={`AED ${n2(t.inPayout)} paid out, not in bank yet${t.overdue > 0 ? ` · AED ${n2(t.overdue)} overdue` : ""}`} />
            <GradCard tone="violet" label="Total deductions" value={`AED ${n2(kept(t))}`} sub={`${pct(keptRate(t))} of gross sales went in fees`} />
          </div>

          {view.overdue.length > 0 && (
            <div className="adm-overdue">
              <Clock size={14} />
              <span style={{ flex: 1 }}>
                Overdue: {view.overdue.map((o) => <b key={o.gateway}>{o.gateway} AED {n0(o.amount)} ({o.orders} orders, oldest {o.oldestDays}d)</b>).reduce<ReactNode[]>((a, el, i) => (i ? [...a, " · ", el] : [el]), [])}
              </span>
              <FollowupButton />
            </div>
          )}

          <UploadsCard />

          {/* daily table — 1st of the range first, each day opens into its gateways */}
          <section className="adm-card">
            <header><h2>Daily sales</h2><span>Click a day to see its gateways · the list button opens its orders</span></header>
            <div className="adm-scroll">
              <table className="adm-t">
                <thead>
                  <tr>
                    <th>Date</th><th>Orders</th><th>Gross sales</th><th>Fee</th><th>VAT</th><th>FX</th><th>Total deductions</th>
                    <th>Net received in bank</th><th>Paid out, not in bank</th><th>Pending</th><th>Cancelled</th><th />
                  </tr>
                </thead>
                <tbody>
                  {view.days.map((d) => {
                    const has = d.orders > 0 || d.cancelled.orders > 0;
                    const open = openDays.has(d.day);
                    const gws = dayGateways.get(d.day) ?? [];
                    return (
                      <Fragment key={d.day}>
                        <tr className={has ? `click${open ? " open" : ""}` : "empty"} onClick={() => has && toggleDay(d.day)}>
                          <td className="l">{has && <ChevronRight size={12} className="adm-chev" style={{ transform: open ? "rotate(90deg)" : undefined }} />}{dayLabel(d.day)}</td>
                          <td>{d.orders || "—"}</td>
                          <td className="b">{n2(d.sale)}</td>
                          <td>{n2(d.fee)}</td>
                          <td>{n2(d.vat)}</td>
                          <td>{d.fx ? n2(d.fx) : "—"}</td>
                          <td>{n2(kept(d))}<i>{d.sale ? pct(keptRate(d)) : ""}</i></td>
                          <td className="ok">{n2(d.netReceived)}</td>
                          <td className={d.inPayout > 0 ? "vio" : ""}>{d.inPayout ? n2(d.inPayout) : "—"}</td>
                          <td className={d.overdue > 0 ? "bad" : d.awaiting - d.inPayout > 0 ? "warn" : ""}>{d.awaiting - d.inPayout > 0.004 ? n2(d.awaiting - d.inPayout) : "—"}</td>
                          <td className="mut">{canc(d.cancelled)}</td>
                          <td>{has && <button className="adm-icon sm" title="This day's orders" onClick={(e) => { e.stopPropagation(); openDay(d); }}><List size={12} /></button>}</td>
                        </tr>
                        {open && gws.map((g) => (
                          <tr key={`${d.day}-${g.gateway}`} className="sub click" onClick={() => setDrawer({
                            title: `${g.gateway} · ${dayLabel(d.day)}`, sub: `${g.orders} orders`,
                            orders: view.orders.filter((o) => o.day === d.day && o.gateway === g.gateway),
                            cancelled: view.cancelled.filter((c) => c.day === d.day && c.gateway === g.gateway),
                            exportQs: `from=${d.day}&to=${d.day}&gateway=${encodeURIComponent(g.gateway)}`, exportName: `omnia-${g.gateway.replace(/\W+/g, "-")}-${d.day}.xlsx`,
                          })}>
                            <td className="l"><Gw name={g.gateway} size={20} /></td>
                            <td>{g.orders}</td>
                            <td className="b">{n2(g.sale)}</td>
                            <td>{n2(g.fee)}</td>
                            <td>{n2(g.vat)}</td>
                            <td>{g.fx ? n2(g.fx) : "—"}</td>
                            <td>{n2(kept(g))}<i>{g.sale ? pct(keptRate(g)) : ""}</i></td>
                            <td className="ok">{n2(g.netReceived)}</td>
                            <td className={g.inPayout > 0 ? "vio" : ""}>{g.inPayout ? n2(g.inPayout) : "—"}</td>
                            <td className={g.overdue > 0 ? "bad" : g.awaiting - g.inPayout > 0 ? "warn" : ""}>{g.awaiting - g.inPayout > 0.004 ? n2(g.awaiting - g.inPayout) : "—"}</td>
                            <td className="mut">{canc(sumCancelledFor(view.cancelled, d.day, g.gateway))}</td>
                            <td />
                          </tr>
                        ))}
                        {open && (
                          <tr className="words-row">
                            <td colSpan={12}><InWords t={d} scope={dayLabel(d.day)} cancelled={d.cancelled} title={`${dayLabel(d.day)} in words`} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="l">Total</td><td>{t.orders}</td><td className="b">{n2(t.sale)}</td><td>{n2(t.fee)}</td><td>{n2(t.vat)}</td><td>{n2(t.fx)}</td>
                    <td>{n2(kept(t))}<i>{pct(keptRate(t))}</i></td>
                    <td className="ok">{n2(t.netReceived)}</td><td className="vio">{n2(t.inPayout)}</td>
                    <td className={t.overdue > 0 ? "bad" : "warn"}>{n2(t.awaiting - t.inPayout)}</td>
                    <td className="mut">{canc(t.cancelled)}</td><td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <MoneySummary t={t} />
            <InWords t={t} scope={view.from === view.to ? dayLabel(view.from) : `${dayLabel(view.from)} → ${dayLabel(view.to)}`} cancelled={t.cancelled} />
            {t.cancelled.orders > 0 && <p className="adm-note">Cancelled orders aren&apos;t sales — they&apos;re not in gross sales, only counted in the Cancelled column.</p>}
          </section>

          {check && (
            <p className={`adm-check ${check.ok ? "ok" : "bad"}`}>
              {check.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {check.ok
                ? "Checked: daily totals = gateway totals = sum of orders, and sales = deductions + refunds + FX + received + pending."
                : "Totals don't agree — refresh; if it persists, the export's Orders sheet shows the row."}
              {view.missingPayoutFiles.length > 0 && (
                <span className="muted"> No payout file yet (whole sale pending, no fee taken): {view.missingPayoutFiles.map((m) => `${m.gateway} (${m.orders})`).join(", ")}.</span>
              )}
            </p>
          )}
        </div>
      )}

      <GatewaysSection today={today} onOpen={setDrawer} exporting={exporting} exportXlsx={exportXlsx} />

      <OrdersDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        exporting={exporting === "drawer"}
        onExport={() => drawer && exportXlsx("drawer", drawer.exportQs, drawer.exportName)}
      />
    </div>
  );
}

function sumCancelledFor(rows: CancelledRow[], day: string, gateway: string): Cancelled {
  const list = rows.filter((c) => c.day === day && c.gateway === gateway);
  return { orders: list.length, amount: list.reduce((a, c) => a + c.amount, 0) };
}

/* ── the summary under the daily table ─────────────────────────────────── */

function MoneySummary({ t }: { t: Totals }) {
  const pending = t.awaiting - t.inPayout;
  const lines: { label: string; value: number; cls?: string; sign?: string; note?: string }[] = [
    { label: "Gross sales", value: t.sale, cls: "b" },
    ...(t.refunds > 0 ? [{ label: "Refunded / returned before payout", value: t.refunds, sign: "−" }] : []),
    { label: "Net received in bank", value: t.netReceived, cls: "ok", sign: "−" },
    { label: "Payout received, not in bank yet", value: t.inPayout, cls: "vio", sign: "−", note: "the gateway has paid it out; the bank credit isn't matched yet" },
    { label: "Pending amount", value: pending, cls: "warn", sign: "−", note: "no payout from the gateway yet" },
  ];
  return (
    <div className="adm-sum">
      <div className="adm-sum-lines">
        {lines.map((l) => (
          <div key={l.label} className="adm-sum-line">
            <em>{l.sign ?? ""}</em><span>{l.label}{l.note && <small>{l.note}</small>}</span>
            <b className={l.cls}>AED {n2(l.value)}</b>
          </div>
        ))}
        <div className="adm-sum-line total">
          <em>=</em><span>Total deductions<small>fee {n2(t.fee)} · VAT {n2(t.vat)}{t.fx ? ` · FX ${n2(t.fx)}` : ""}</small></span>
          <b>AED {n2(kept(t))}</b>
        </div>
      </div>
      <div className="adm-sum-rate">
        <span>Deduction %</span>
        <b>{(keptRate(t) * 100).toFixed(2)}%</b>
        <small>Total deductions ÷ gross sales × 100<br />AED {n2(kept(t))} ÷ AED {n2(t.sale)} × 100</small>
      </div>
    </div>
  );
}

/* ── the same numbers, in sentences ────────────────────────────────────── */

/** Plain sentences under a total: what was sold, what is in the bank, what is
 *  still on its way and what the gateways kept — for a range, a day, a gateway. */
function inWords(t: Totals, opts: { scope: string; cancelled?: Cancelled; payer?: string }): string[] {
  const payer = opts.payer ?? "the gateway";
  const share = (v: number) => (t.sale > 0 ? `${((v / t.sale) * 100).toFixed(1)}%` : "0%");
  const pending = Math.max(t.awaiting - t.inPayout, 0);
  if (!t.orders) return [`${opts.scope}: no sales.`];
  const out = [
    `${opts.scope}: ${t.orders} ${t.orders === 1 ? "order" : "orders"} brought in AED ${n2(t.sale)} in gross sales.`,
    t.netReceived > 0
      ? `AED ${n2(t.netReceived)} (${share(t.netReceived)}) has reached the bank${t.avgDaysToBank != null ? `, ${t.avgDaysToBank} days after the order on average` : ""}.`
      : "Nothing has reached the bank yet.",
  ];
  if (t.inPayout > 0) out.push(`AED ${n2(t.inPayout)} (${share(t.inPayout)}) has been paid out by ${payer} but isn't matched in the bank yet.`);
  if (pending > 0) out.push(`AED ${n2(pending)} (${share(pending)}) is still pending — ${payer} hasn't paid it out yet${t.overdue > 0 ? `; AED ${n2(t.overdue)} of it (${t.overdueOrders} orders) is overdue` : ""}.`);
  if (t.refunds > 0) out.push(`AED ${n2(t.refunds)} was refunded or returned before payout.`);
  const k = kept(t);
  out.push(k > 0
    ? `The gateways${t.fx ? " and the bank" : ""} kept AED ${n2(k)} so far — fee ${n2(t.fee)}, VAT ${n2(t.vat)}${t.fx ? `, FX ${n2(t.fx)}` : ""} — that is ${(keptRate(t) * 100).toFixed(2)}% of gross sales.`
    : "No deductions are known yet.");
  if (t.awaiting > 0.004) out.push(`The fee is only final once the full net amount is in the bank: ${share(t.awaiting)} of these sales hasn't arrived, so this % can still change.`);
  if (opts.cancelled?.orders) out.push(`${opts.cancelled.orders} cancelled ${opts.cancelled.orders === 1 ? "order" : "orders"} (AED ${n2(opts.cancelled.amount)}) are not counted as sales.`);
  return out;
}

function InWords({ t, scope, cancelled, title = "In words" }: { t: Totals; scope: string; cancelled?: Cancelled; title?: string }) {
  return (
    <div className="adm-words">
      <h3>{title}</h3>
      <ul>{inWords(t, { scope, cancelled }).map((line, i) => <li key={i}>{line}</li>)}</ul>
    </div>
  );
}

/* ── charts ────────────────────────────────────────────────────────────── */

function SalesCurve({ days }: { days: DayRow[] }) {
  const data = days.map((d) => ({ day: d.day, label: dayShort(d.day), orders: d.orders, sale: Math.round(d.sale), bank: Math.round(d.netReceived) }));
  const step = data.length > 16 ? 2 : 1; // print every value up to ~2 weeks, every other one beyond
  const lastIdx = data.length - 1;
  const SaleLabel = (p: { x?: number; y?: number; value?: number; index?: number }) => {
    const { x = 0, y = 0, value = 0, index = 0 } = p;
    if (!value) return null;
    if (index === lastIdx) {
      const text = n0(value);
      const w = text.length * 8 + 20;
      return (
        <g>
          <rect x={x - w / 2} y={y - 38} width={w} height={25} rx={6} fill={C.ink} />
          <path d={`M${x - 5} ${y - 14} L${x} ${y - 8} L${x + 5} ${y - 14} Z`} fill={C.ink} />
          <text x={x} y={y - 21} textAnchor="middle" fontSize={13} fontWeight={800} fill="#fff">{text}</text>
        </g>
      );
    }
    if (index % step) return null;
    return <text x={x} y={y - 10} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.violet}>{n0(value)}</text>;
  };
  const Tick = (p: { x?: number; y?: number; payload?: { value: string; index: number } }) => {
    const { x = 0, y = 0, payload } = p;
    const d = data.find((r) => r.label === payload?.value);
    return (
      <g transform={`translate(${x},${y})`}>
        <text y={14} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={C.muted}>{payload?.value}</text>
        {d && <text y={30} textAnchor="middle" fontSize={11.5} fill={C.faint}>{d.orders} ord</text>}
      </g>
    );
  };
  if (!data.length) return null;
  return (
    <>
      <ResponsiveContainer width="100%" height={330}>
        <ComposedChart data={data} margin={{ top: 40, right: 24, left: 4, bottom: 8 }}>
          <defs>
            <linearGradient id="admBank" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.blue} stopOpacity={0.22} />
              <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={C.line} strokeDasharray="2 6" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={<Tick />} height={42} interval={data.length > 16 ? 1 : 0} />
          <YAxis tickLine={false} axisLine={false} fontSize={12.5} stroke={C.faint} width={64} tickFormatter={(v: number) => n0(v)} />
          <Area type="monotone" dataKey="bank" stroke={C.blue} strokeWidth={2.5} fill="url(#admBank)" dot={false} isAnimationActive={false}>
            <LabelList dataKey="bank" content={(p) => {
              const { x = 0, y = 0, value = 0, index = 0 } = p as { x?: number; y?: number; value?: number; index?: number };
              if (!value || index % step || index === lastIdx) return null;
              return <text x={Number(x)} y={Number(y) + 16} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={C.blue}>{n0(Number(value))}</text>;
            }} />
          </Area>
          <Line type="monotone" dataKey="sale" stroke={C.lilac} strokeWidth={2.5} dot={{ r: 2.5, fill: C.lilac, strokeWidth: 0 }} isAnimationActive={false}>
            <LabelList dataKey="sale" content={(p) => <SaleLabel {...(p as object)} />} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
      <div className="adm-legend">
        <span><i style={{ background: C.lilac }} />Gross sales</span>
        <span><i style={{ background: C.blue }} />Net received in bank</span>
      </div>
    </>
  );
}

function MoneyDonut({ t }: { t: Totals }) {
  const pending = Math.max(t.awaiting - t.inPayout, 0);
  const parts = [
    { name: "Received in bank", value: t.netReceived, color: C.blue },
    { name: "Paid out, not in bank", value: t.inPayout, color: C.sky },
    { name: "Pending", value: pending, color: C.amber },
    { name: "Deductions", value: kept(t), color: C.lilac },
    { name: "Refunded", value: t.refunds, color: "#CBD5E1" },
  ].filter((p) => p.value > 0.004);
  const share = (v: number) => (t.sale > 0 ? (v / t.sale) * 100 : 0);
  return (
    <div className="adm-donut">
      <div className="adm-donut-ring">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={parts.length ? parts : [{ name: "none", value: 1, color: C.line }]} dataKey="value" innerRadius={66} outerRadius={92} startAngle={90} endAngle={-270} paddingAngle={parts.length > 1 ? 1.5 : 0} stroke="none" isAnimationActive={false}>
              {(parts.length ? parts : [{ color: C.line }]).map((p, i) => <Cell key={i} fill={p.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="adm-donut-mid"><b>{share(t.netReceived).toFixed(0)}%</b><span>in the bank</span></div>
      </div>
      <ul className="adm-donut-legend">
        {parts.map((p) => (
          <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span><b>AED {n0(p.value)}</b><em>{share(p.value).toFixed(1)}%</em></li>
        ))}
      </ul>
    </div>
  );
}

function GradCard({ tone, label, value, sub }: { tone: "lilac" | "blue" | "deep" | "violet"; label: string; value: string; sub: string }) {
  return (
    <div className={`adm-grad ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}

/* ── upload log: latest payout per gateway + bank statements ───────────── */

function UploadsCard() {
  const [u, setU] = useState<Uploads | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    fetch("/api/dashboard/admin-money/uploads", { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); setU(j); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  return (
    <section className="adm-card">
      <header><h2>Latest uploads</h2><span>the last payout from each gateway and when it came in · Dubai time</span></header>
      {err && <div className="adm-err"><AlertTriangle size={14} /> {err}</div>}
      {!u && !err && <div className="adm-loading" style={{ padding: 20 }}><Loader2 size={14} className="adm-spin" /> Loading uploads…</div>}
      {u && (
        <>
          <div className="adm-ups">
            {u.latestBank && (
              <div className="adm-up bank">
                <div className="adm-up-ic"><Landmark size={16} /></div>
                <div className="adm-up-body">
                  <b>Bank statement</b>
                  <span className="fn" title={u.latestBank.filename}>{u.latestBank.filename}</span>
                  <small>{u.latestBank.summary}</small>
                </div>
                <div className="adm-up-when"><b>{stamp(u.latestBank.uploadedAt)}</b><small>{ago(u.latestBank.uploadedAt)}</small></div>
              </div>
            )}
            {u.latestPayouts.map((p) => (
              <div key={p.gateway} className="adm-up">
                <div className="adm-up-logo"><GwLogo name={p.gateway} size={32} /></div>
                <div className="adm-up-body">
                  <b>{p.gateway}{p.store ? <em> · {p.store}</em> : null}</b>
                  <span className="fn" title={p.source}>{p.viaApi ? `synced by API · ${p.payoutId}` : p.source}</span>
                  <small>net AED {n2(p.netAed)}{p.orders ? ` · ${p.orders} lines` : ""} · {p.last30} payouts in 30 days</small>
                </div>
                <div className="adm-up-when"><b>{stamp(p.uploadedAt)}</b><small>{ago(p.uploadedAt)}</small></div>
              </div>
            ))}
          </div>
          {u.events.length > 0 && (
            <>
              <button className="adm-link" onClick={() => setAll((v) => !v)}><Upload size={12} /> {all ? "Hide" : "Show"} upload history ({u.events.length} files)</button>
              {all && (
                <div className="adm-scroll">
                  <table className="adm-t">
                    <thead><tr><th>Uploaded</th><th className="l">Type</th><th className="l">Gateway</th><th className="l">File</th><th className="l">What it held</th></tr></thead>
                    <tbody>
                      {u.events.map((e, i) => (
                        <tr key={i}>
                          <td className="l">{stamp(e.uploadedAt)}</td>
                          <td className="l">{e.kind === "bank" ? "Bank statement" : "Payout file"}</td>
                          <td className="l">{e.provider ? <Gw name={e.provider} size={18} /> : "—"}</td>
                          <td className="l name" title={e.filename}>{e.filename}</td>
                          <td className="l mut">{e.summary || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ── gateways: own date range, a card per gateway with its numbers shown ── */

function GatewaysSection({ today, onOpen, exporting, exportXlsx }: {
  today: string; onOpen: (s: DrawerState) => void; exporting: string | null;
  exportXlsx: (key: string, qs: string, name: string) => void;
}) {
  const [range, setRange] = useState<Range>(presets(today)[0]);
  const { view, loading, error } = useAdminMoney(range);
  const open = (g: GatewayRow) => view && onOpen({
    title: g.gateway, sub: `${dayLabel(view.from)} → ${dayLabel(view.to)} · ${g.orders} orders`, orders: view.orders.filter((o) => o.gateway === g.gateway),
    cancelled: view.cancelled.filter((c) => c.gateway === g.gateway),
    exportQs: `from=${view.from}&to=${view.to}&gateway=${encodeURIComponent(g.gateway)}`, exportName: `omnia-${g.gateway.replace(/\W+/g, "-")}-${view.from}_${view.to}.xlsx`,
  });
  const t = view?.totals;
  return (
    <section className="adm-card">
      <header>
        <h2>Payment gateways</h2>
        <span>{view ? `${dayLabel(view.from)} → ${dayLabel(view.to)} · click a gateway for its orders` : ""}</span>
      </header>
      <div style={{ marginBottom: 14 }}>
        <RangePicker range={range} setRange={setRange} today={today}>{loading && <Loader2 size={14} className="adm-spin" />}</RangePicker>
      </div>
      {error && <div className="adm-err"><AlertTriangle size={14} /> {error}</div>}
      {view && t && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <GatewayCards rows={view.gateways.filter((g) => g.orders > 0).map((g) => ({ ...g, oldest: g.oldestAwaitingDays }))} onPick={(name) => { const g = view.gateways.find((x) => x.gateway === name); if (g) open(g); }} />
          <div className="adm-scroll" style={{ marginTop: 16 }}>
            <table className="adm-t">
              <thead>
                <tr>
                  <th>Gateway</th><th>Orders</th><th>Gross sales</th><th>Total deductions</th><th>Deduction %</th>
                  <th>Net received in bank</th><th>Paid out, not in bank</th><th>Pending</th><th>Overdue</th><th>Days to bank</th><th>Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {view.gateways.map((g) => (
                  <tr key={g.gateway} className="click" onClick={() => open(g)}>
                    <td className="l"><Gw name={g.gateway} size={22} /></td>
                    <td>{g.orders}</td>
                    <td className="b">{n2(g.sale)}</td>
                    <td>{n2(kept(g))}</td>
                    <td>{pct(keptRate(g))}</td>
                    <td className="ok">{n2(g.netReceived)}</td>
                    <td className={g.inPayout ? "vio" : ""}>{g.inPayout ? n2(g.inPayout) : "—"}</td>
                    <td className="warn">{g.awaiting - g.inPayout > 0.004 ? n2(g.awaiting - g.inPayout) : "—"}</td>
                    <td className={g.overdue > 0 ? "bad" : ""}>{g.overdue > 0 ? `${n2(g.overdue)} · ${g.overdueOrders}` : "—"}</td>
                    <td title={`Usual: ${g.expectedDays} days`}>{g.avgDaysToBank ?? "—"}<i>usual {g.expectedDays}</i></td>
                    <td className="mut">{canc(g.cancelled)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="l">Total</td><td>{t.orders}</td><td className="b">{n2(t.sale)}</td><td>{n2(kept(t))}</td><td>{pct(keptRate(t))}</td>
                  <td className="ok">{n2(t.netReceived)}</td><td className="vio">{n2(t.inPayout)}</td><td className="warn">{n2(t.awaiting - t.inPayout)}</td>
                  <td className={t.overdue > 0 ? "bad" : ""}>{t.overdue > 0 ? n2(t.overdue) : "—"}</td><td>{t.avgDaysToBank ?? "—"}</td><td className="mut">{canc(t.cancelled)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="adm-words-grid">
            {view.gateways.filter((g) => g.orders > 0 || g.cancelled.orders > 0).map((g) => (
              <div key={g.gateway} className="adm-words gw">
                <h3>
                  <Gw name={g.gateway} size={22} />
                  <button className="adm-btn ghost" onClick={() => exportXlsx(g.gateway, `from=${view.from}&to=${view.to}&gateway=${encodeURIComponent(g.gateway)}`, `omnia-${g.gateway.replace(/\W+/g, "-")}-${view.from}_${view.to}.xlsx`)}>
                    {exporting === g.gateway ? <Loader2 size={13} className="adm-spin" /> : <Download size={13} />} Excel
                  </button>
                </h3>
                <ul>{inWords(g, { scope: `${g.gateway}, ${dayLabel(view.from)} → ${dayLabel(view.to)}`, cancelled: g.cancelled, payer: g.gateway === "COD" ? "the courier" : undefined }).map((line, i) => <li key={i}>{line}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** One card per gateway: a ring for the share of its sales already in the bank, every figure printed. */
function GatewayCards({ rows, onPick }: { rows: GwGroup[]; onPick?: (gateway: string) => void }) {
  if (!rows.length) return null;
  const total = rows.reduce((a, r) => a + r.sale, 0);
  return (
    <div className="adm-gws">
      {rows.map((r) => {
        const pending = Math.max(r.awaiting - r.inPayout, 0);
        const segs = [
          { v: r.netReceived, c: C.blue }, { v: r.inPayout, c: C.sky }, { v: pending, c: r.overdue > 0 ? C.red : C.amber }, { v: kept(r), c: C.lilac },
        ];
        return (
          <button key={r.gateway} className="adm-gw" onClick={() => onPick?.(r.gateway)} disabled={!onPick}>
            <div className="adm-gw-head">
              <GwLogo name={r.gateway} size={28} />
              <b>{r.gateway}</b>
              <em>{total > 0 ? ((r.sale / total) * 100).toFixed(1) : "0"}% of sales</em>
            </div>
            <div className="adm-gw-main">
              <Ring segs={segs} total={r.sale} label={`${r.sale > 0 ? ((r.netReceived / r.sale) * 100).toFixed(0) : 0}%`} sub="in bank" />
              <dl>
                <div><dt>Gross sales</dt><dd className="b">{n2(r.sale)}</dd></div>
                <div><dt>Deductions</dt><dd>{n2(kept(r))} <span className="rate">{pct(keptRate(r))}</span></dd></div>
                <div><dt><i style={{ background: C.blue }} />In bank</dt><dd>{n2(r.netReceived)}</dd></div>
                <div><dt><i style={{ background: C.sky }} />Paid out, not in bank</dt><dd>{n2(r.inPayout)}</dd></div>
                <div><dt><i style={{ background: r.overdue > 0 ? C.red : C.amber }} />Pending</dt><dd className={r.overdue > 0 ? "bad" : ""}>{n2(pending)}</dd></div>
              </dl>
            </div>
            <div className="adm-gw-foot">
              <span>{r.orders} orders</span>
              <span>{r.avgDaysToBank != null ? `${r.avgDaysToBank} days to bank` : "none in bank yet"}</span>
              {r.oldest > 0 && <span className={r.overdue > 0 ? "bad" : ""}>oldest waiting {r.oldest}d</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Ring({ segs, total, label, sub }: { segs: { v: number; c: string }[]; total: number; label: string; sub: string }) {
  const R = 34, L = 2 * Math.PI * R;
  let off = 0;
  return (
    <svg width={88} height={88} viewBox="0 0 88 88" className="adm-ring" aria-hidden>
      <circle cx={44} cy={44} r={R} fill="none" stroke={C.line} strokeWidth={9} />
      {total > 0 && segs.map((s, i) => {
        const len = (Math.max(s.v, 0) / total) * L;
        const el = <circle key={i} cx={44} cy={44} r={R} fill="none" stroke={s.c} strokeWidth={9} strokeDasharray={`${len} ${L - len}`} strokeDashoffset={-off} transform="rotate(-90 44 44)" />;
        off += len;
        return el;
      })}
      <text x={44} y={45} textAnchor="middle" fontSize={18} fontWeight={800} fill={C.ink}>{label}</text>
      <text x={44} y={59} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={C.muted}>{sub}</text>
    </svg>
  );
}

/* ── chase overdue money: preview, then Telegram / call ─────────────────── */

type Followup = { message: string | null; callScript: string | null; overdueTotal: number; telegram: { configured: boolean }; call: { configured: boolean; to: string; minAed: number } };

function FollowupButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Followup | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const openIt = async () => {
    setOpen(true);
    if (f) return;
    try {
      const r = await fetch("/api/dashboard/admin-money/followup", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setF(j);
    } catch (e) { toast.error((e as Error).message); setOpen(false); }
  };
  const send = async (action: "telegram" | "call") => {
    setBusy(action);
    try {
      const r = await fetch("/api/dashboard/admin-money/followup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      if (action === "telegram") toast.success(j.sent ? "Posted to the Telegram group" : "Nothing overdue to post");
      else toast[j.called ? "success" : "message"](j.called ? "Calling now" : j.reason || "No call placed");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <>
      <button className="adm-btn" onClick={openIt}>Chase now</button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="admd-back" style={{ display: "grid", placeItems: "center" }} onClick={() => setOpen(false)}>
          <style>{CSS}</style>
          <div className="adm-chase" onClick={(e) => e.stopPropagation()}>
            <div className="admd-head" style={{ borderRadius: "18px 18px 0 0" }}>
              <div><h2>Chase overdue payments</h2><span>Also sent automatically at 10:00 and 16:00 Dubai</span></div>
              <button className="adm-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {!f ? <div className="adm-loading"><Loader2 size={16} className="adm-spin" /> Building the message…</div> : (
                <>
                  <pre className="adm-pre" dangerouslySetInnerHTML={{ __html: (f.message ?? "Nothing overdue.").replace(/\n/g, "<br/>") }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button className="adm-btn" disabled={!f.message || !f.telegram.configured || !!busy} onClick={() => send("telegram")}>
                      {busy === "telegram" ? <Loader2 size={13} className="adm-spin" /> : null} Send to Telegram now
                    </button>
                    <button className="adm-btn" disabled={!f.callScript || !f.call.configured || !f.call.to || !!busy} onClick={() => send("call")}
                      title={!f.call.configured ? "Needs TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM" : !f.call.to ? "Set the phone number in Settings" : `Calls ${f.call.to}`}>
                      {busy === "call" ? <Loader2 size={13} className="adm-spin" /> : null} Call now{f.call.to ? ` (${f.call.to})` : ""}
                    </button>
                    {!f.telegram.configured && <span className="adm-note" style={{ margin: 0 }}>Telegram CFO bot not configured.</span>}
                    {(!f.call.configured || !f.call.to) && <span className="adm-note" style={{ margin: 0 }}>Daily call: {!f.call.configured ? "add Twilio keys" : "set a phone number in Settings"} · calls when overdue &gt; AED {n0(f.call.minAed)}.</span>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── bottom drawer: a day's (or a gateway's) orders ────────────────────── */

const STATUS: Record<OrderRow["status"], { label: string; cls: string }> = {
  received: { label: "Received", cls: "ok" },
  awaiting: { label: "Pending", cls: "warn" },
  overdue: { label: "Overdue", cls: "bad" },
  refunded: { label: "Refunded", cls: "muted" },
};

function OrdersDrawer({ state, onClose, onExport, exporting }: {
  state: DrawerState | null;
  onClose: () => void; onExport: () => void; exporting: boolean;
}) {
  const [gw, setGw] = useState<string>("All");
  useEffect(() => { setGw("All"); }, [state]);
  useEffect(() => {
    if (!state) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [state, onClose]);

  const all = state?.orders ?? [];
  const groups = useMemo(() => groupByGateway(all), [all]);
  const rows = gw === "All" ? all : all.filter((o) => o.gateway === gw);
  const t = useMemo(() => sum(rows), [rows]);
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {state && (
        <>
          <motion.div className="admd-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="admd" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 280 }} role="dialog" aria-label={state.title}>
            <style>{CSS}</style>
            <div className="admd-head">
              <div>
                <h2>{state.title}</h2>
                <span>{state.sub}</span>
              </div>
              <div className="admd-actions">
                <button className="adm-btn" onClick={onExport} disabled={exporting}>{exporting ? <Loader2 size={13} className="adm-spin" /> : <Download size={13} />} Excel</button>
                <button className="adm-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
              </div>
            </div>

            <div className="admd-body">
              <div className="adm-cards">
                <GradCard tone="lilac" label="Gross sales" value={`AED ${n2(t.sale)}`} sub={`${t.orders} orders`} />
                <GradCard tone="violet" label="Total deductions" value={`AED ${n2(kept(t))}`} sub={`${pct(keptRate(t))} · fee ${n2(t.fee)} · VAT ${n2(t.vat)}${t.fx ? ` · FX ${n2(t.fx)}` : ""}`} />
                <GradCard tone="blue" label="Net received in bank" value={`AED ${n2(t.netReceived)}`} sub="in the bank" />
                <GradCard tone="deep" label="Pending" value={`AED ${n2(t.awaiting)}`} sub={`AED ${n2(t.inPayout)} paid out, not in bank${t.overdue > 0 ? ` · AED ${n2(t.overdue)} overdue` : ""}`} />
              </div>

              {groups.length > 0 && <div className="admd-panel"><GatewayCards rows={groups} onPick={groups.length > 1 ? (g) => setGw(g) : undefined} /></div>}

              {groups.length > 1 && (
                <div className="adm-presets chips">
                  <button className={gw === "All" ? "on" : ""} onClick={() => setGw("All")}>All · {all.length}</button>
                  {groups.map((g) => (
                    <button key={g.gateway} className={gw === g.gateway ? "on" : ""} onClick={() => setGw(g.gateway)}>
                      <GwLogo name={g.gateway} size={18} />{g.gateway} · {g.orders}
                    </button>
                  ))}
                </div>
              )}

              <div className="adm-scroll">
                <table className="adm-t">
                  <thead>
                    <tr>
                      <th>Order</th><th>Date</th><th>Customer</th><th>Gateway</th><th>Status</th><th>Sale</th><th>Fee</th><th>VAT</th>
                      <th>FX</th><th>Total deductions</th><th>Net received</th><th>Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.uid} title={o.reason}>
                        <td className="l mono">{o.orderNumber}<i>{o.store}</i></td>
                        <td className="l">{dayLabel(o.day)}</td>
                        <td className="l name" dir="auto">{o.customer || "—"}</td>
                        <td className="l"><Gw name={o.gateway} size={18} /></td>
                        <td className="l">
                          <span className={`adm-pill ${o.inPayout > 0 && o.status !== "overdue" ? "vio" : STATUS[o.status].cls}`}>{o.inPayout > 0 && o.status !== "overdue" ? "Paid out" : STATUS[o.status].label}</span>
                          <i>{o.status === "received" ? (o.receivedOn ? `${o.receivedOn.slice(5)} · ${o.ageDays}d` : "") : o.status === "refunded" ? "" : `${o.ageDays}d${o.overdueDays ? ` · ${o.overdueDays}d late` : ""}`}</i>
                        </td>
                        <td className="b">{n2(o.sale)}</td>
                        <td>{o.fee ? n2(o.fee) : "—"}</td>
                        <td>{o.vat ? n2(o.vat) : "—"}</td>
                        <td>{o.fx ? n2(o.fx) : "—"}</td>
                        <td>{o.deductions + o.fx ? n2(o.deductions + o.fx) : "—"}</td>
                        <td className="ok">{o.netReceived ? n2(o.netReceived) : "—"}</td>
                        <td className={o.status === "overdue" ? "bad" : o.awaiting ? "warn" : ""}>{o.awaiting ? n2(o.awaiting) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="l" colSpan={5}>Total · {t.orders} orders</td>
                      <td className="b">{n2(t.sale)}</td><td>{n2(t.fee)}</td><td>{n2(t.vat)}</td><td>{n2(t.fx)}</td>
                      <td>{n2(kept(t))}<i>{pct(keptRate(t))}</i></td><td className="ok">{n2(t.netReceived)}</td>
                      <td className={t.overdue > 0 ? "bad" : "warn"}>{n2(t.awaiting)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <InWords t={t} scope={gw === "All" ? state.title : `${state.title} · ${gw}`}
                cancelled={{ orders: state.cancelled.filter((c) => gw === "All" || c.gateway === gw).length, amount: state.cancelled.filter((c) => gw === "All" || c.gateway === gw).reduce((a, c) => a + c.amount, 0) }} />
              {(state.cancelled?.length ?? 0) > 0 && (
                <div className="adm-scroll">
                  <table className="adm-t">
                    <thead><tr><th>Cancelled order</th><th className="l">Date</th><th className="l">Customer</th><th className="l">Gateway</th><th className="l">Credit note</th><th>Order amount</th></tr></thead>
                    <tbody>
                      {state.cancelled.filter((c) => gw === "All" || c.gateway === gw).map((c) => (
                        <tr key={c.orderNumber} className="mutrow">
                          <td className="l mono">{c.orderNumber}<i>{c.store}</i></td>
                          <td className="l">{dayLabel(c.day)}</td>
                          <td className="l name" dir="auto">{c.customer || "—"}</td>
                          <td className="l"><Gw name={c.gateway} size={18} /></td>
                          <td className="l">{c.creditNote || "—"}</td>
                          <td>{n2(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="adm-note" style={{ padding: "0 10px 10px" }}>Cancelled — not sales, so not in the totals above.</p>
                </div>
              )}
              <p className="adm-note">Hover an order for why its money is or isn&apos;t in. No payout file yet = no fee taken; the whole sale shows as pending until the file arrives.</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const CSS = `
  .adm, .admd { font-family: var(--os-font, ui-sans-serif, system-ui, sans-serif); color: #16133A; font-size: 15px; }
  .adm { display: flex; flex-direction: column; gap: 24px; }
  .adm *, .admd * { box-sizing: border-box; }
  .adm-spin { animation: admspin 1s linear infinite; } @keyframes admspin { to { transform: rotate(360deg); } }
  .adm-title { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
  .adm-title h1 { margin: 0; font-size: 38px; font-weight: 800; letter-spacing: -.02em; color: #16133A; line-height: 1.1; }
  .adm-title > div > span { font-size: 15px; color: #3F3C66; }
  .adm-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .adm-presets { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: #fff; border: 1px solid #DAD6EE; border-radius: 12px; }
  .adm-presets button { border: 0; background: none; border-radius: 9px; padding: 8px 14px; font: inherit; font-size: 14px; font-weight: 600; color: #3F3C66; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
  .adm-presets button.on { background: #1D5BFF; color: #fff; }
  .adm-presets.chips { align-self: flex-start; }
  .adm-dates { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; color: #3F3C66; }
  .adm-dates input { min-width: 0; max-width: 160px; border: 1px solid #DAD6EE; border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 14px; color: #16133A; background: #fff; }
  .adm-btn { display: inline-flex; align-items: center; gap: 7px; border: 0; background: #1D5BFF; border-radius: 10px; padding: 10px 16px; font: inherit; font-size: 14px; font-weight: 700; color: #fff; cursor: pointer; }
  .adm-btn:disabled, .adm-icon:disabled { opacity: .5; cursor: default; }
  .adm-icon { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #DAD6EE; background: #fff; border-radius: 10px; width: 38px; height: 38px; cursor: pointer; color: #3B1D72; }
  .adm-icon.sm { width: 28px; height: 28px; border-radius: 8px; margin-left: 10px; vertical-align: middle; }
  .adm-link { align-self: flex-start; display: inline-flex; gap: 7px; align-items: center; border: 0; background: none; padding: 14px 0 4px; font: inherit; font-size: 14px; font-weight: 700; color: #1D5BFF; cursor: pointer; }
  .adm-err { display: flex; gap: 8px; align-items: center; background: #FEE2E2; color: #991B1B; border-radius: 12px; padding: 12px 16px; font-size: 14px; }
  .adm-loading { display: flex; gap: 8px; align-items: center; justify-content: center; padding: 50px; color: #3F3C66; font-size: 15px; }

  .adm-card { min-width: 0; background: #fff; border: 1px solid #E2DFF1; border-radius: 18px; padding: 26px 28px; display: flex; flex-direction: column; }
  .adm-card > header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .adm-card h2 { margin: 0; font-size: 21px; font-weight: 800; color: #16133A; letter-spacing: -.01em; }
  .adm-card > header span { font-size: 14px; color: #4A4770; }

  .adm-hero-grid { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); gap: 24px; }
  .adm-legend { display: flex; gap: 18px; font-size: 14px; color: #3F3C66; flex-wrap: wrap; font-weight: 600; }
  .adm-legend span { display: inline-flex; align-items: center; gap: 7px; } .adm-legend i { width: 11px; height: 11px; border-radius: 99px; }

  .adm-donut { display: flex; flex-direction: column; gap: 14px; flex: 1; justify-content: center; }
  .adm-donut-ring { position: relative; }
  .adm-donut-mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
  .adm-donut-mid b { font-size: 34px; font-weight: 800; color: #16133A; line-height: 1; }
  .adm-donut-mid span { font-size: 14px; color: #3F3C66; margin-top: 6px; font-weight: 600; }
  .adm-donut-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .adm-donut-legend li { display: grid; grid-template-columns: 12px 1fr auto 58px; gap: 10px; align-items: center; font-size: 14.5px; }
  .adm-donut-legend i { width: 11px; height: 11px; border-radius: 99px; }
  .adm-donut-legend span { color: #2A2752; font-weight: 600; }
  .adm-donut-legend b { font-variant-numeric: tabular-nums; font-weight: 800; }
  .adm-donut-legend em { font-style: normal; text-align: right; color: #3F3C66; font-variant-numeric: tabular-nums; font-weight: 600; }

  .adm-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
  .adm-grad { border-radius: 16px; padding: 22px 24px; color: #fff; display: flex; flex-direction: column; gap: 8px; min-height: 132px; }
  .adm-grad.lilac { background: linear-gradient(135deg, #8E3FD6, #B86BF5); }
  .adm-grad.blue { background: linear-gradient(135deg, #0B47E6, #1D5BFF); }
  .adm-grad.deep { background: linear-gradient(135deg, #24114D, #3B1D72); }
  .adm-grad.violet { background: linear-gradient(135deg, #4C24A8, #6A45E8); }
  .adm-grad span { font-size: 15px; font-weight: 700; color: #fff; }
  .adm-grad b { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .adm-grad small { font-size: 14px; color: #fff; font-weight: 500; line-height: 1.45; }

  .adm-overdue { display: flex; gap: 10px; align-items: center; background: #FFF4E5; border: 1px solid #F5C98A; color: #7A3A00; border-radius: 14px; padding: 14px 18px; font-size: 14.5px; }
  .adm-overdue b { font-weight: 700; }

  .adm-ups { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 14px; }
  .adm-up { display: flex; gap: 14px; align-items: center; border: 1px solid #E2DFF1; border-radius: 14px; padding: 16px; background: #fff; min-width: 0; }
  .adm-up.bank { background: #F5F1FF; border-color: #CFC3F3; }
  .adm-up-ic { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: #3B1D72; color: #fff; flex-shrink: 0; }
  .adm-up-logo { width: 84px; flex-shrink: 0; display: flex; justify-content: center; }
  .adm-up-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .adm-up-body b { font-size: 15px; } .adm-up-body b em { font-style: normal; font-weight: 600; color: #3F3C66; }
  .adm-up-body .fn { font-size: 13.5px; color: #2A2752; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .adm-up-body small { font-size: 13px; color: #3F3C66; }
  .adm-up-when { text-align: right; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
  .adm-up-when b { font-size: 14.5px; font-variant-numeric: tabular-nums; } .adm-up-when small { font-size: 13px; color: #3F3C66; }

  .gwl { display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; overflow: hidden; background: #fff; flex-shrink: 0; border: 1px solid #E2DFF1; vertical-align: middle; }
  .gwl img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .gwl.wide { padding: 2px 4px; }
  .gwl.none { background: #3B1D72; color: #fff; font-size: 12px; font-weight: 800; border: 0; padding: 0 4px; }
  .gwn { display: inline-flex; align-items: center; gap: 10px; vertical-align: middle; font-weight: 600; }

  .adm-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .adm-t { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; color: #16133A; }
  .adm-t th { text-align: right; font-size: 13px; letter-spacing: .01em; color: #16133A; font-weight: 800; padding: 12px 8px; white-space: normal; line-height: 1.25; vertical-align: bottom; border-bottom: 2px solid #DAD6EE; background: #F4F2FC; position: sticky; top: 0; z-index: 1; }
  .adm-t th:first-child { text-align: left; }
  .adm-t td { text-align: right; padding: 12px 8px; border-bottom: 1px solid #ECEAF6; }
  .adm-t td.l, .adm-t th.l { text-align: left; }
  .adm-t td.b { font-weight: 800; }
  .adm-t td.ok { color: #0B47E6; font-weight: 700; } .adm-t td.warn { color: #8A4B00; font-weight: 600; } .adm-t td.bad { color: #B91C1C; font-weight: 700; } .adm-t td.vio { color: #075E8C; font-weight: 600; }
  .adm-t td i { display: block; font-style: normal; font-size: 12.5px; color: #4A4770; font-weight: 600; margin-top: 2px; }
  .adm-t td.l i { display: inline; margin-left: 8px; }
  .adm-t td.mono { font-family: ui-monospace, monospace; }
  .adm-t td.name { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
  .adm-t tr.click { cursor: pointer; } .adm-t tr.click:hover td { background: #F4F0FF; }
  .adm-t tr.open td { background: #EFEAFE; font-weight: 700; }
  .adm-t tr.sub td { background: #FBFAFF; font-size: 14px; }
  .adm-t tr.sub td:first-child { padding-left: 30px; }
  .adm-t td:first-child, .adm-t th:first-child { padding-left: 14px; }
  .adm-t tr.words-row td { background: #FBFAFF; padding: 14px 14px 18px 38px; white-space: normal; text-align: left; }
  .adm-chev { display: inline-block; margin-right: 8px; vertical-align: -1px; color: #3B1D72; transition: transform .15s; }
  .adm-t tr.empty td { color: #8F8CAE; }
  .adm-t td.mut, .adm-t tr.mutrow td { color: #4A4770; }
  .adm-t tfoot td { font-weight: 800; border-top: 2px solid #DAD6EE; border-bottom: 0; background: #F4F2FC; font-size: 15px; }
  .adm-pill { display: inline-flex; font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .adm-pill.ok { background: #DCE6FF; color: #0B3FCC; } .adm-pill.warn { background: #FDECC8; color: #7A3A00; }
  .adm-pill.bad { background: #FEE2E2; color: #991B1B; } .adm-pill.muted { background: #ECEAF6; color: #2A2752; } .adm-pill.vio { background: #D8F0FF; color: #075E8C; }
  .adm-note { margin: 14px 0 0; font-size: 14px; color: #3F3C66; }
  .adm-check { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 14px; margin: 0; font-weight: 600; }
  .adm-check.ok { color: #0B47E6; } .adm-check.bad { color: #991B1B; } .adm-check .muted { color: #3F3C66; font-weight: 500; }

  .adm-sum { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 20px; margin-top: 22px; }
  .adm-sum-lines { border: 1px solid #E2DFF1; border-radius: 14px; padding: 8px 20px; background: #fff; }
  .adm-sum-line { display: flex; align-items: center; gap: 12px; padding: 13px 0; border-bottom: 1px solid #ECEAF6; font-size: 15px; }
  .adm-sum-line:last-child { border-bottom: 0; }
  .adm-sum-line span { flex: 1; display: flex; flex-direction: column; gap: 2px; color: #16133A; font-weight: 600; }
  .adm-sum-line > em { font-style: normal; width: 16px; flex-shrink: 0; text-align: center; color: #3B1D72; font-weight: 800; font-size: 17px; }
  .adm-sum-line small { font-size: 13px; color: #4A4770; font-weight: 500; }
  .adm-sum-line b { font-variant-numeric: tabular-nums; font-size: 16px; font-weight: 800; }
  .adm-sum-line b.ok { color: #0B47E6; } .adm-sum-line b.warn { color: #8A4B00; } .adm-sum-line b.vio { color: #075E8C; }
  .adm-sum-line.total { border-top: 2px solid #DAD6EE; }
  .adm-sum-line.total b { font-size: 19px; color: #3B1D72; }
  .adm-sum-rate { border-radius: 14px; padding: 24px; color: #fff; background: linear-gradient(150deg, #24114D, #3B1D72); display: flex; flex-direction: column; gap: 10px; justify-content: center; }
  .adm-sum-rate span { font-size: 15px; color: #fff; font-weight: 700; }
  .adm-sum-rate b { font-size: 44px; font-weight: 800; line-height: 1; color: #fff; }
  .adm-sum-rate small { font-size: 13.5px; color: #fff; line-height: 1.6; }

  .adm-words { margin-top: 20px; border: 1px solid #DAD6EE; border-left: 4px solid #3B1D72; border-radius: 12px; padding: 16px 20px; background: #fff; }
  .adm-words h3 { margin: 0 0 10px; font-size: 16px; font-weight: 800; color: #16133A; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .adm-btn.ghost { background: #fff; color: #1D5BFF; border: 1px solid #C9D6FF; padding: 6px 12px; font-size: 13px; }
  .adm-words ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 7px; }
  .adm-words li { font-size: 15px; line-height: 1.55; color: #16133A; }
  .adm-t .adm-words { margin-top: 0; }
  .adm-words-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; margin-top: 20px; }
  .adm-words-grid .adm-words { margin-top: 0; }

  .adm-gws { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  .adm-gw { text-align: left; font: inherit; color: inherit; border: 1px solid #E2DFF1; border-radius: 16px; background: #fff; padding: 18px; display: flex; flex-direction: column; gap: 14px; cursor: pointer; transition: border-color .15s; }
  .adm-gw:disabled { cursor: default; }
  .adm-gw:not(:disabled):hover { border-color: #3B1D72; }
  .adm-gw-head { display: flex; align-items: center; gap: 10px; }
  .adm-gw-head b { font-size: 16px; flex: 1; }
  .adm-gw-head em { font-style: normal; font-size: 13px; color: #3B1D72; background: #EFEAFE; padding: 3px 10px; border-radius: 99px; font-weight: 700; }
  .adm-gw-main { display: flex; gap: 16px; align-items: center; }
  .adm-ring { flex-shrink: 0; }
  .adm-gw dl { margin: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .adm-gw dl > div { display: flex; justify-content: space-between; gap: 8px; font-size: 13.5px; }
  .adm-gw dt { color: #2A2752; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 500; }
  .adm-gw dt i { width: 9px; height: 9px; border-radius: 99px; }
  .adm-gw dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
  .adm-gw dd.b { font-weight: 800; } .adm-gw dd.bad { color: #B91C1C; }
  .adm-gw dd .rate { font-size: 12.5px; color: #3B1D72; background: #EFEAFE; border-radius: 6px; padding: 1px 6px; margin-left: 4px; }
  .adm-gw-foot { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13.5px; color: #3F3C66; border-top: 1px solid #ECEAF6; padding-top: 12px; font-weight: 500; }
  .adm-gw-foot .bad { color: #B91C1C; font-weight: 700; }

  .adm-chase { width: min(660px, calc(100vw - 32px)); background: #fff; border-radius: 18px; border: 1px solid #DAD6EE; }
  .adm-pre { margin: 0; white-space: pre-wrap; font: inherit; font-size: 14.5px; line-height: 1.6; background: #F7F5FD; border: 1px solid #E2DFF1; border-radius: 12px; padding: 14px 16px; max-height: 50vh; overflow: auto; }
  .admd-back { position: fixed; inset: 0; background: rgba(22,19,58,.45); z-index: 1000; }
  .admd { position: fixed; left: 0; right: 0; bottom: 0; height: 88vh; background: #F3F2FA; border-radius: 20px 20px 0 0; z-index: 1001; display: flex; flex-direction: column; }
  .admd-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 18px 28px; background: #fff; border-bottom: 1px solid #E2DFF1; border-radius: 20px 20px 0 0; }
  .admd-head h2 { margin: 0; font-size: 21px; font-weight: 800; }
  .admd-head span { font-size: 14px; color: #3F3C66; }
  .admd-actions { display: flex; gap: 10px; }
  .admd-body { flex: 1; overflow-y: auto; padding: 22px 28px 36px; display: flex; flex-direction: column; gap: 18px; }
  .admd-panel { background: #fff; border: 1px solid #E2DFF1; border-radius: 16px; padding: 18px; }
  .admd-body > * { flex-shrink: 0; }
  .admd-body .adm-scroll { background: #fff; border: 1px solid #E2DFF1; border-radius: 16px; overflow-y: visible; }
  .admd-body .adm-words { margin-top: 0; }

  @media (max-width: 1100px) {
    .adm-hero-grid { grid-template-columns: 1fr; }
    .adm-cards { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 760px) {
    .adm-sum { grid-template-columns: 1fr; }
    .adm-words-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 620px) {
    .adm-cards { grid-template-columns: 1fr; }
    .adm-title h1 { font-size: 30px; }
    .adm-grad b { font-size: 24px; }
    .adm-card { padding: 18px; }
    .adm-ups, .adm-gws { grid-template-columns: 1fr; }
    .admd { height: 92vh; }
    .admd-head, .admd-body { padding-left: 16px; padding-right: 16px; }
  }
`;
