"use client";

/* Admin tab — the money in three numbers (sales, received in bank, pending),
   then one row per day and one row per gateway. A day (or a gateway) opens a
   bottom drawer with its orders, the same columns, totals and charts.

   Every figure comes from /api/dashboard/admin-money, where day, gateway and
   order rows are sums of the same order rows — the check line under the
   tables proves it on screen. Drawer is portaled with self-contained hex
   (see the modal portal fix: position:fixed inside the dashboard breaks). */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Loader2, RefreshCw, X, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { GATEWAY_COLOR, compact } from "../types";

/* ── shapes (mirror lib/dashboard/admin-money) ─────────────────────────── */

type Totals = {
  orders: number; sale: number; fee: number; vat: number; deductions: number; refunds: number; netPayout: number;
  fx: number; netReceived: number; awaiting: number; overdue: number; overdueOrders: number; deductionRate: number; avgDaysToBank: number | null;
};
type Cancelled = { orders: number; amount: number };
type CancelledRow = { day: string; orderNumber: string; store: string; customer: string; gateway: string; amount: number; creditNote: string; cancelledOn: string };
type DayRow = Totals & { day: string; cancelled: Cancelled };
type GatewayRow = Totals & { gateway: string; expectedDays: number; oldestAwaitingDays: number; cancelled: Cancelled };
type OrderRow = {
  uid: string; day: string; orderNumber: string; store: string; customer: string; gateway: string;
  sale: number; fee: number; vat: number; deductions: number; refunds: number; netPayout: number; fx: number; netReceived: number; awaiting: number;
  status: "received" | "awaiting" | "overdue" | "refunded"; feeEstimated: boolean; receivedOn: string | null; ageDays: number; overdueDays: number; reason: string;
};
type View = {
  from: string; to: string; today: string; totals: Totals & { cancelled: Cancelled }; days: DayRow[]; gateways: GatewayRow[]; orders: OrderRow[];
  cancelled: CancelledRow[];
  overdue: { gateway: string; amount: number; orders: number; oldestDays: number; oldestOrder: string }[];
  missingPayoutFiles: { gateway: string; orders: number; grossAed: number }[];
};

/* ── helpers ───────────────────────────────────────────────────────────── */

const n2 = (v: number) => new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const n0 = (v: number) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(v || 0);
const canc = (c?: Cancelled) => (c && c.orders ? `${c.orders} · ${n2(c.amount)}` : "—");
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const gwColor = (g: string) => GATEWAY_COLOR[g] ?? "#94a3b8";
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

function sum(rows: OrderRow[]): Totals {
  const t: Totals = { orders: 0, sale: 0, fee: 0, vat: 0, deductions: 0, refunds: 0, netPayout: 0, fx: 0, netReceived: 0, awaiting: 0, overdue: 0, overdueOrders: 0, deductionRate: 0, avgDaysToBank: null };
  let bd = 0, bn = 0;
  for (const r of rows) {
    t.orders++; t.sale += r.sale; t.fee += r.fee; t.vat += r.vat; t.deductions += r.deductions; t.refunds += r.refunds;
    t.netPayout += r.netPayout; t.fx += r.fx; t.netReceived += r.netReceived; t.awaiting += r.awaiting;
    if (r.status === "overdue") { t.overdue += r.awaiting; t.overdueOrders++; }
    if (r.status === "received" && r.receivedOn) { bd += r.ageDays; bn++; }
  }
  t.deductionRate = t.sale > 0 ? t.deductions / t.sale : 0;
  t.avgDaysToBank = bn ? Math.round((bd / bn) * 10) / 10 : null;
  return t;
}
function groupByGateway(rows: OrderRow[]) {
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

/* ── main ──────────────────────────────────────────────────────────────── */

export function AdminMoney() {
  const today = dubaiToday();
  const [range, setRange] = useState<Range>(presets(today)[0]);
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ title: string; sub: string; orders: OrderRow[]; cancelled: CancelledRow[]; exportQs: string; exportName: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

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

  const exportXlsx = async (key: string, qs: string, name: string) => {
    setExporting(key);
    try { await download(qs, name); } catch (e) { toast.error(`Export failed: ${(e as Error).message}`); } finally { setExporting(null); }
  };

  // On-screen proof that the three views agree.
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

  const openDay = (d: DayRow) => {
    if (!view) return;
    setDrawer({
      title: dayLabel(d.day), sub: `${d.orders} orders${d.cancelled.orders ? ` · ${d.cancelled.orders} cancelled` : ""}`, orders: view.orders.filter((o) => o.day === d.day),
      cancelled: view.cancelled.filter((c) => c.day === d.day),
      exportQs: `from=${d.day}&to=${d.day}`, exportName: `omnia-admin-money-${d.day}.xlsx`,
    });
  };
  const openGateway = (g: GatewayRow) => {
    if (!view) return;
    setDrawer({
      title: g.gateway, sub: `${dayLabel(view.from)} → ${dayLabel(view.to)} · ${g.orders} orders`, orders: view.orders.filter((o) => o.gateway === g.gateway),
      cancelled: view.cancelled.filter((c) => c.gateway === g.gateway),
      exportQs: `from=${view.from}&to=${view.to}&gateway=${encodeURIComponent(g.gateway)}`, exportName: `omnia-${g.gateway.replace(/\W+/g, "-")}-${view.from}_${view.to}.xlsx`,
    });
  };

  const t = view?.totals;

  return (
    <div className="adm">
      <style>{CSS}</style>

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
          <button className="adm-icon" title="Refresh from the latest payouts" onClick={() => load(true)} disabled={loading}>
            {loading ? <Loader2 size={14} className="adm-spin" /> : <RefreshCw size={14} />}
          </button>
          <button className="adm-btn" disabled={!view || exporting === "all"} onClick={() => view && exportXlsx("all", `from=${view.from}&to=${view.to}`, `omnia-admin-money-${view.from}_${view.to}.xlsx`)}>
            {exporting === "all" ? <Loader2 size={13} className="adm-spin" /> : <Download size={13} />} Excel
          </button>
        </div>
      </div>

      {error && <div className="adm-err"><AlertTriangle size={14} /> {error}</div>}
      {!view && loading && <div className="adm-loading"><Loader2 size={16} className="adm-spin" /> Loading the money…</div>}

      {view && t && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* the three numbers, on the dark blue band */}
          <div className="adm-kpis adm-hero">
            <div className="adm-kpi">
              <span >Total sales</span>
              <b style={{fontSize: 40}}>AED {n0(t.sale)}</b>
              <small>{t.orders} orders · deductions AED {n0(t.deductions)} ({pct(t.deductionRate)})</small>
            </div>
            <div className="adm-kpi ok">
              <span>Net received in bank</span>
              <b style={{fontSize: 30,color: "green"}}>AED {n0(t.netReceived)}</b>
              <small>after fees, VAT{t.fx ? ` and AED ${n0(t.fx)} FX` : ""}{t.avgDaysToBank != null ? ` · ${t.avgDaysToBank} days to bank on average` : ""}</small>
            </div>
            <div className={`adm-kpi ${t.overdue > 0 ? "bad" : "warn"}`}>
              <span>Pending payments</span>
              <b style={{fontSize: 30,color: "red"}}>AED {n0(t.awaiting)}</b>
              <small>{t.overdue > 0 ? <><AlertTriangle size={11} /> AED {n0(t.overdue)} overdue · {t.overdueOrders} orders</> : "nothing overdue"}</small>
            </div>
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

          {/* daily table */}
          <section className="adm-card">
            <header><h2>Daily sales</h2><span>click a day for its orders</span></header>
            <div className="adm-scroll">
              <table className="adm-t">
                <thead>
                  <tr>
                    <th>Date</th><th>Orders</th><th>Gross sales</th><th>Fee</th><th>VAT</th><th>Total deductions</th>
                    <th>Net payout</th><th>FX charges</th><th>Net received in bank</th><th>Awaiting</th><th>Cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {view.days.map((d) => (
                    <tr key={d.day} className={d.orders || d.cancelled.orders ? "click" : "empty"} onClick={() => (d.orders || d.cancelled.orders) && openDay(d)}>
                      <td className="l">{dayLabel(d.day)}</td>
                      <td>{d.orders || "—"}</td>
                      <td className="b">{n2(d.sale)}</td>
                      <td>{n2(d.fee)}</td>
                      <td>{n2(d.vat)}</td>
                      <td>{n2(d.deductions)}<i>{d.sale ? pct(d.deductionRate) : ""}</i></td>
                      <td>{n2(d.netPayout)}</td>
                      <td>{d.fx ? n2(d.fx) : "—"}</td>
                      <td className="ok">{n2(d.netReceived)}</td>
                      <td className={d.overdue > 0 ? "bad" : d.awaiting > 0 ? "warn" : ""}>{n2(d.awaiting)}</td>
                      <td className="mut">{canc(d.cancelled)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="l">Total</td><td>{t.orders}</td><td className="b">{n2(t.sale)}</td><td>{n2(t.fee)}</td><td>{n2(t.vat)}</td>
                    <td>{n2(t.deductions)}<i>{pct(t.deductionRate)}</i></td><td>{n2(t.netPayout)}</td><td>{n2(t.fx)}</td>
                    <td className="ok">{n2(t.netReceived)}</td><td className={t.overdue > 0 ? "bad" : "warn"}>{n2(t.awaiting)}</td>
                    <td className="mut">{canc(t.cancelled)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {t.refunds > 0 && <p className="adm-note">Net payout excludes AED {n2(t.refunds)} returned / refunded before payout.</p>}
            {t.cancelled.orders > 0 && <p className="adm-note">Cancelled orders aren&apos;t sales — they&apos;re not in gross sales, only counted in the Cancelled column.</p>}
          </section>

          {/* gateway table */}
          <section className="adm-card">
            <header><h2>Payment gateways</h2><span>{dayLabel(view.from)} → {dayLabel(view.to)} · click a gateway for its orders</span></header>
            <div className="adm-scroll">
              <table className="adm-t">
                <thead>
                  <tr>
                    <th>Gateway</th><th>Orders</th><th>Sales</th><th>Total deductions</th><th>Deductions %</th><th>FX charges</th>
                    <th>Received in bank</th><th>Awaiting</th><th>Overdue</th><th>Days to bank</th><th>Cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {view.gateways.map((g) => (
                    <tr key={g.gateway} className="click" onClick={() => openGateway(g)}>
                      <td className="l"><i className="dot" style={{ background: gwColor(g.gateway) }} />{g.gateway}
                        <button className="adm-icon sm" title={`Excel: ${g.gateway}`} onClick={(e) => { e.stopPropagation(); exportXlsx(g.gateway, `from=${view.from}&to=${view.to}&gateway=${encodeURIComponent(g.gateway)}`, `omnia-${g.gateway.replace(/\W+/g, "-")}-${view.from}_${view.to}.xlsx`); }}>
                          {exporting === g.gateway ? <Loader2 size={12} className="adm-spin" /> : <Download size={12} />}
                        </button>
                      </td>
                      <td>{g.orders}</td>
                      <td className="b">{n2(g.sale)}</td>
                      <td>{n2(g.deductions)}</td>
                      <td>{pct(g.deductionRate)}</td>
                      <td>{g.fx ? n2(g.fx) : "—"}</td>
                      <td className="ok">{n2(g.netReceived)}</td>
                      <td className="warn">{n2(g.awaiting)}</td>
                      <td className={g.overdue > 0 ? "bad" : ""}>{g.overdue > 0 ? `${n2(g.overdue)} · ${g.overdueOrders}` : "—"}</td>
                      <td title={`Usual: ${g.expectedDays} days`}>{g.avgDaysToBank ?? "—"}<i>usual {g.expectedDays}</i></td>
                      <td className="mut">{canc(g.cancelled)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="l">Total</td><td>{t.orders}</td><td className="b">{n2(t.sale)}</td><td>{n2(t.deductions)}</td><td>{pct(t.deductionRate)}</td>
                    <td>{n2(t.fx)}</td><td className="ok">{n2(t.netReceived)}</td><td className="warn">{n2(t.awaiting)}</td>
                    <td className={t.overdue > 0 ? "bad" : ""}>{t.overdue > 0 ? n2(t.overdue) : "—"}</td><td>{t.avgDaysToBank ?? "—"}</td><td className="mut">{canc(t.cancelled)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <GatewayCharts rows={view.gateways.filter((g) => g.orders > 0).map((g) => ({ ...g, oldest: g.oldestAwaitingDays }))} />
          </section>

          {check && (
            <p className={`adm-check ${check.ok ? "ok" : "bad"}`}>
              {check.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {check.ok
                ? "Checked: daily totals = gateway totals = sum of orders, and sales = deductions + refunds + FX + received + awaiting."
                : "Totals don't agree — refresh; if it persists, the export's Orders sheet shows the row."}
              {view.missingPayoutFiles.length > 0 && (
                <span className="muted"> Fees are estimated where the payout file hasn&apos;t arrived: {view.missingPayoutFiles.map((m) => `${m.gateway} (${m.orders})`).join(", ")}.</span>
              )}
            </p>
          )}
        </div>
      )}

      <OrdersDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        exporting={exporting === "drawer"}
        onExport={() => drawer && exportXlsx("drawer", drawer.exportQs, drawer.exportName)}
      />
    </div>
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

/* ── per-gateway charts (gateway table + day drawer share them) ─────────── */

type ChartRow = Totals & { gateway: string; oldest: number };

function GatewayCharts({ rows }: { rows: ChartRow[] }) {
  if (!rows.length) return null;
  const money = rows.map((r) => ({ name: r.gateway, Received: +r.netReceived.toFixed(2), Awaiting: +(r.awaiting - r.overdue).toFixed(2), Overdue: +r.overdue.toFixed(2) }));
  const rate = rows.map((r) => ({ name: r.gateway, pct: +(r.deductionRate * 100).toFixed(2), color: gwColor(r.gateway) })).sort((a, b) => b.pct - a.pct);
  const delay = rows.map((r) => ({ name: r.gateway, days: r.avgDaysToBank ?? 0, oldest: r.oldest, color: gwColor(r.gateway) }));
  const h = Math.max(120, rows.length * 34 + 30);
  const tip = { contentStyle: { borderRadius: 10, border: "1px solid #D8E1F1", fontSize: 12 }, cursor: { fill: "#EEF2FA" } };
  return (
    <div className="adm-charts">
      <div>
        <h3>Received vs awaiting</h3>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={money} layout="vertical" margin={{ left: 0, right: 12 }}>
            <XAxis type="number" tickFormatter={compact} fontSize={11} stroke="#9AA6BD" />
            <YAxis type="category" dataKey="name" width={110} fontSize={11.5} stroke="#46546F" />
            <Tooltip {...tip} formatter={(v: number) => `AED ${n2(v)}`} />
            <Bar dataKey="Received" stackId="a" fill="#10b981" />
            <Bar dataKey="Awaiting" stackId="a" fill="#f59e0b" />
            <Bar dataKey="Overdue" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="adm-legend"><span><i style={{ background: "#10b981" }} />Received</span><span><i style={{ background: "#f59e0b" }} />Awaiting</span><span><i style={{ background: "#ef4444" }} />Overdue</span></div>
      </div>
      <div>
        <h3>Who charges more · deductions % of sales</h3>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={rate} layout="vertical" margin={{ left: 0, right: 12 }}>
            <XAxis type="number" unit="%" fontSize={11} stroke="#9AA6BD" />
            <YAxis type="category" dataKey="name" width={110} fontSize={11.5} stroke="#46546F" />
            <Tooltip {...tip} formatter={(v: number) => `${v.toFixed(2)}%`} />
            <Bar dataKey="pct" name="Deductions" radius={[0, 4, 4, 0]}>{rate.map((r) => <Cell key={r.name} fill={r.color} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h3>Who pays late · days to bank / oldest waiting</h3>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={delay} layout="vertical" margin={{ left: 0, right: 12 }}>
            <XAxis type="number" unit="d" fontSize={11} stroke="#9AA6BD" allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={110} fontSize={11.5} stroke="#46546F" />
            <Tooltip {...tip} formatter={(v: number, k: string) => [`${v} days`, k === "days" ? "Avg days to bank" : "Oldest still waiting"]} />
            <Bar dataKey="days" fill="#2563EB" radius={[0, 4, 4, 0]} />
            <Bar dataKey="oldest" fill="#fca5a5" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="adm-legend"><span><i style={{ background: "#2563EB" }} />Avg days to bank</span><span><i style={{ background: "#fca5a5" }} />Oldest still waiting</span></div>
      </div>
    </div>
  );
}

/* ── bottom drawer: a day's (or a gateway's) orders ────────────────────── */

const STATUS: Record<OrderRow["status"], { label: string; cls: string }> = {
  received: { label: "Received", cls: "ok" },
  awaiting: { label: "Awaiting", cls: "warn" },
  overdue: { label: "Overdue", cls: "bad" },
  refunded: { label: "Refunded", cls: "muted" },
};

function OrdersDrawer({ state, onClose, onExport, exporting }: {
  state: { title: string; sub: string; orders: OrderRow[]; cancelled: CancelledRow[] } | null;
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
              <div className="adm-kpis sm">
                <div className="adm-kpi"><span>Sales</span><b>AED {n2(t.sale)}</b><small>{t.orders} orders</small></div>
                <div className="adm-kpi"><span>Total deductions</span><b>AED {n2(t.deductions)}</b><small>{pct(t.deductionRate)} · fee {n2(t.fee)} · VAT {n2(t.vat)}{t.fx ? ` · FX ${n2(t.fx)}` : ""}</small></div>
                <div className="adm-kpi ok"><span>Net received</span><b>AED {n2(t.netReceived)}</b><small>in the bank</small></div>
                <div className={`adm-kpi ${t.overdue > 0 ? "bad" : "warn"}`}><span>Awaiting</span><b>AED {n2(t.awaiting)}</b><small>{t.overdue > 0 ? `AED ${n2(t.overdue)} overdue` : "on time"}</small></div>
              </div>

              {groups.length > 0 && <GatewayCharts rows={groups} />}

              {groups.length > 1 && (
                <div className="adm-presets chips">
                  <button className={gw === "All" ? "on" : ""} onClick={() => setGw("All")}>All · {all.length}</button>
                  {groups.map((g) => (
                    <button key={g.gateway} className={gw === g.gateway ? "on" : ""} onClick={() => setGw(g.gateway)}>
                      <i className="dot" style={{ background: gwColor(g.gateway) }} />{g.gateway} · {g.orders}
                    </button>
                  ))}
                </div>
              )}

              <div className="adm-scroll">
                <table className="adm-t">
                  <thead>
                    <tr>
                      <th>Order</th><th>Date</th><th>Customer</th><th>Gateway</th><th>Status</th><th>Sale</th><th>Fee</th><th>VAT</th>
                      <th>FX</th><th>Total deductions</th><th>Net received</th><th>Awaiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.uid} title={o.reason}>
                        <td className="l mono">{o.orderNumber}<i>{o.store}</i></td>
                        <td className="l">{dayLabel(o.day)}</td>
                        <td className="l name" dir="auto">{o.customer || "—"}</td>
                        <td className="l"><i className="dot" style={{ background: gwColor(o.gateway) }} />{o.gateway}</td>
                        <td className="l">
                          <span className={`adm-pill ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                          <i>{o.status === "received" ? (o.receivedOn ? `${o.receivedOn.slice(5)} · ${o.ageDays}d` : "") : o.status === "refunded" ? "" : `${o.ageDays}d${o.overdueDays ? ` · ${o.overdueDays}d late` : ""}`}</i>
                        </td>
                        <td className="b">{n2(o.sale)}</td>
                        <td>{n2(o.fee)}{o.feeEstimated && o.fee > 0 ? <i title="Estimated — payout file not in yet">est.</i> : null}</td>
                        <td>{o.vat ? n2(o.vat) : "—"}</td>
                        <td>{o.fx ? n2(o.fx) : "—"}</td>
                        <td>{n2(o.deductions)}</td>
                        <td className="ok">{o.netReceived ? n2(o.netReceived) : "—"}</td>
                        <td className={o.status === "overdue" ? "bad" : o.awaiting ? "warn" : ""}>{o.awaiting ? n2(o.awaiting) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="l" colSpan={5}>Total · {t.orders} orders</td>
                      <td className="b">{n2(t.sale)}</td><td>{n2(t.fee)}</td><td>{n2(t.vat)}</td><td>{n2(t.fx)}</td>
                      <td>{n2(t.deductions)}<i>{pct(t.deductionRate)}</i></td><td className="ok">{n2(t.netReceived)}</td>
                      <td className={t.overdue > 0 ? "bad" : "warn"}>{n2(t.awaiting)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
                          <td className="l"><i className="dot" style={{ background: gwColor(c.gateway) }} />{c.gateway}</td>
                          <td className="l">{c.creditNote || "—"}</td>
                          <td>{n2(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="adm-note" style={{ padding: "0 10px 10px" }}>Cancelled — not sales, so not in the totals above.</p>
                </div>
              )}
              <p className="adm-note">Hover an order for why its money is or isn&apos;t in. &quot;est.&quot; = fee estimated at the gateway&apos;s rate until its payout file arrives.</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const CSS = `
  .adm, .admd { font-family: var(--os-font, ui-sans-serif, system-ui, sans-serif); color: #0F1B3D; }
  .adm { display: flex; flex-direction: column; gap: 16px; }
  .adm *, .admd * { box-sizing: border-box; }
  .adm-spin { animation: admspin 1s linear infinite; } @keyframes admspin { to { transform: rotate(360deg); } }
  .adm-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .adm-presets { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: #fff; border: 1px solid #D8E1F1; border-radius: 999px; }
  .adm-presets button { border: 0; background: none; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 600; color: #5E6B85; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .adm-presets button.on { background: #0F1B3D; color: #fff; }
  .adm-presets.chips { border-radius: 14px; align-self: flex-start; }
  .adm-dates { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: #5E6B85; }
  .adm-dates input { min-width: 0; max-width: 140px; border: 1px solid #D8E1F1; border-radius: 10px; padding: 6px 8px; font: inherit; font-size: 12.5px; color: #0F1B3D; background: #fff; }
  .adm-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #D8E1F1; background: #fff; border-radius: 10px; padding: 7px 12px; font: inherit; font-size: 12.5px; font-weight: 600; color: #1D4ED8; cursor: pointer; }
  .adm-btn:disabled, .adm-icon:disabled { opacity: .5; cursor: default; }
  .adm-icon { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #D8E1F1; background: #fff; border-radius: 10px; width: 32px; height: 32px; cursor: pointer; color: #46546F; }
  .adm-icon.sm { width: 24px; height: 24px; border-radius: 7px; margin-left: 8px; vertical-align: middle; }
  .adm-err { display: flex; gap: 8px; align-items: center; background: #fee2e2; color: #b91c1c; border-radius: 12px; padding: 10px 14px; font-size: 13px; }
  .adm-loading { display: flex; gap: 8px; align-items: center; justify-content: center; padding: 50px; color: #5E6B85; font-size: 14px; }

  .adm-hero { background: radial-gradient(80% 140% at 100% 0%, rgba(37,99,235,.45), transparent 60%), radial-gradient(60% 90% at 0% 100%, rgba(99,102,241,.3), transparent 65%), linear-gradient(135deg, #0B1433, #13235C 55%, #1E3A8A); border-radius: 24px; padding: 18px; box-shadow: 0 24px 50px -30px rgba(15,27,61,.6); }
  .adm-hero .adm-kpi { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.10); border-top: 3px solid rgba(255,255,255,.55); color: #fff; }
  .adm-hero .adm-kpi.ok { border-top-color: #34d399; } .adm-hero .adm-kpi.warn { border-top-color: #fbbf24; } .adm-hero .adm-kpi.bad { border-top-color: #f87171; }
  .adm-hero .adm-kpi span { color: rgba(255,255,255,.65); }
  .adm-hero .adm-kpi b { color: #fff; }
  .adm-hero .adm-kpi small { color: rgba(255,255,255,.6); }
  .adm-hero .adm-kpi.bad small { color: #fecaca; }
  .adm-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .adm-kpis.sm { grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .adm-kpi { background: #fff; border: 1px solid #D8E1F1; border-radius: 20px; padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; border-top: 4px solid #0F1B3D; }
  .adm-kpis.sm .adm-kpi { border-radius: 14px; padding: 12px 14px; border-top-width: 3px; }
  .adm-kpi.ok { border-top-color: #10b981; } .adm-kpi.warn { border-top-color: #f59e0b; } .adm-kpi.bad { border-top-color: #ef4444; }
  .adm-kpi span { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; font-weight: 700; color: #5E6B85; }
  .adm-kpi b { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .adm-kpis.sm .adm-kpi b { font-size: 18px; }
  .adm-kpi small { font-size: 12px; color: #5E6B85; display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
  .adm-kpi.bad small { color: #b91c1c; font-weight: 600; }

  .adm-overdue { display: flex; gap: 8px; align-items: flex-start; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 14px; padding: 10px 14px; font-size: 12.5px; }
  .adm-overdue b { font-weight: 600; }

  .adm-card { background: #fff; border: 1px solid #D8E1F1; border-radius: 22px; padding: 18px 20px; }
  .adm-card > header { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .adm-card h2 { margin: 0; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; font-weight: 700; color: #5E6B85; }
  .adm-card > header span { font-size: 12px; color: #9AA6BD; }

  .adm-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .adm-t { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .adm-t th { text-align: right; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #5E6B85; font-weight: 700; padding: 8px 10px; border-bottom: 1px solid #D8E1F1; background: #F7F9FD; position: sticky; top: 0; z-index: 1; }
  .adm-t th:first-child { text-align: left; }
  .adm-t td { text-align: right; padding: 8px 10px; border-bottom: 1px solid #F3F6FB; }
  .adm-t td.l, .adm-t th.l { text-align: left; }
  .adm-t td.b { font-weight: 700; }
  .adm-t td.ok { color: #047857; } .adm-t td.warn { color: #b45309; } .adm-t td.bad { color: #dc2626; font-weight: 600; }
  .adm-t td i { display: block; font-style: normal; font-size: 10.5px; color: #9AA6BD; font-weight: 500; }
  .adm-t td.l i { display: inline; margin-left: 6px; }
  .adm-t td.mono { font-family: ui-monospace, monospace; }
  .adm-t td.name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
  .adm-t tr.click { cursor: pointer; } .adm-t tr.click:hover td { background: #F3F7FE; }
  .adm-t tr.empty td { color: #C9D5EA; }
  .adm-t td.mut, .adm-t tr.mutrow td { color: #9AA6BD; }
  .adm-t tfoot td { font-weight: 700; border-top: 2px solid #D8E1F1; border-bottom: 0; background: #F7F9FD; }
  .adm-t td i.dot, .adm-presets .dot { display: inline-block; width: 8px; height: 8px; border-radius: 3px; margin-right: 7px; vertical-align: 0; }
  .adm-pill { display: inline-flex; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
  .adm-pill.ok { background: #d1fae5; color: #047857; } .adm-pill.warn { background: #fef3c7; color: #b45309; }
  .adm-pill.bad { background: #fee2e2; color: #dc2626; } .adm-pill.muted { background: #EEF2FA; color: #5E6B85; }
  .adm-note { margin: 10px 0 0; font-size: 11.5px; color: #9AA6BD; }
  .adm-check { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; margin: 0; }
  .adm-check.ok { color: #047857; } .adm-check.bad { color: #b91c1c; } .adm-check .muted { color: #9AA6BD; }

  .adm-charts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
  .adm-charts h3 { margin: 0 0 6px; font-size: 11.5px; font-weight: 700; color: #46546F; }
  .adm-legend { display: flex; gap: 12px; font-size: 11px; color: #5E6B85; flex-wrap: wrap; }
  .adm-legend span { display: inline-flex; align-items: center; gap: 5px; } .adm-legend i { width: 9px; height: 9px; border-radius: 3px; }

  .adm-chase { width: min(640px, calc(100vw - 32px)); background: #fff; border-radius: 18px; box-shadow: 0 20px 50px rgba(15,27,61,.3); }
  .adm-pre { margin: 0; white-space: pre-wrap; font: inherit; font-size: 13px; line-height: 1.55; background: #F7F9FD; border: 1px solid #D8E1F1; border-radius: 12px; padding: 12px 14px; max-height: 50vh; overflow: auto; }
  .admd-back { position: fixed; inset: 0; background: rgba(15,27,61,.35); z-index: 1000; }
  .admd { position: fixed; left: 0; right: 0; bottom: 0; height: 86vh; background: #F1F3F7; border-radius: 22px 22px 0 0; z-index: 1001; display: flex; flex-direction: column; box-shadow: 0 -20px 50px rgba(15,27,61,.25); }
  .admd-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 22px; background: #fff; border-bottom: 1px solid #D8E1F1; border-radius: 22px 22px 0 0; }
  .admd-head h2 { margin: 0; font-size: 18px; font-weight: 700; }
  .admd-head span { font-size: 12px; color: #5E6B85; }
  .admd-actions { display: flex; gap: 8px; }
  .admd-body { flex: 1; overflow-y: auto; padding: 16px 22px 28px; display: flex; flex-direction: column; gap: 14px; }
  .admd-body .adm-charts { background: #fff; border: 1px solid #D8E1F1; border-radius: 16px; padding: 14px; margin: 0; }
  .admd-body > * { flex-shrink: 0; }
  .admd-body .adm-scroll { background: #fff; border: 1px solid #D8E1F1; border-radius: 16px; overflow-y: visible; }

  @media (max-width: 980px) {
    .adm-kpis, .adm-kpis.sm { grid-template-columns: 1fr 1fr; }
    .adm-charts { grid-template-columns: 1fr; }
  }
  @media (max-width: 620px) {
    .adm-kpis, .adm-kpis.sm { grid-template-columns: 1fr; }
    .adm-kpi b { font-size: 24px; }
    .admd { height: 92vh; }
    .admd-head, .admd-body { padding-left: 16px; padding-right: 16px; }
  }
`;
