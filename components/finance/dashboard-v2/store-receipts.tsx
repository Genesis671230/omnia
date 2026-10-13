"use client";

/* Dashboard → "Sales & receipts".
 *
 * For any date range: what the stores sold, how much of it is confirmed in
 * the bank, and per store (Shopify Main / KSA / UAE / WhatsApp) every order
 * with whether its money arrived. Each order carries the actions ops need at
 * any time — Received, Cancelled, Returned, Exchanged — which open the
 * existing OrderAdjustDialog (Zoho credit note / payment, dry-run first).
 *
 * Data: /api/orders/sales-ledger, one call per calendar month the range
 * touches, filtered to the range by Dubai day. Same counting rule and status
 * as the day drawer, so the totals match the rest of the dashboard. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { OrderAdjustDialog } from "@/components/finance/order-adjust-dialog";
import { RefundFinderButton } from "./refund-finder";
import { MonthClose } from "./month-close";
import type { LedgerAdjustmentInput, LedgerCancelledOrder, LedgerOrder, LedgerStatus, SalesLedger } from "@/lib/orders/sales-ledger";

const STORES = [
  { id: "MAIN", label: "Shopify Main" },
  { id: "KSA", label: "Shopify KSA" },
  { id: "UAE", label: "Shopify UAE" },
  { id: "WA", label: "Shopify WhatsApp" },
  { id: "WOO", label: "WooCommerce" },
] as const;

type Kind = "received" | "cancelled" | "returned" | "refunded" | "exchanged";
type Row = {
  uid: string; store: string; orderNumber: string; orderDate: string; customerName: string; gateway: string;
  grossAed: number; receivedAed: number; status: LedgerStatus | "cancelled"; reason: string;
  adjustment: LedgerAdjustmentInput | null;
};
type Filter = "all" | "open" | "received" | "adjusted" | "cancelled";

const STATUS_LABEL: Record<Row["status"], string> = {
  received: "Received",
  in_review: "In bank · review",
  awaiting_bank: "Paid out · not in bank",
  awaiting_payout: "Not paid out yet",
  no_payout_file: "Awaiting payout",
  cod: "COD · with courier",
  adjusted: "Adjusted",
  cancelled: "Cancelled",
};
const STATUS_TONE: Record<Row["status"], "ok" | "warn" | "bad" | "muted"> = {
  received: "ok", in_review: "warn", awaiting_bank: "warn", awaiting_payout: "warn", no_payout_file: "bad", cod: "warn", adjusted: "muted", cancelled: "muted",
};

const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;
const aed2 = (n: number) => `AED ${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dubaiToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const prevMonth = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); };
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } if (out.length > 24) break; }
  return out;
}
const isReceived = (r: Row) => r.status === "received" || r.adjustment?.kind === "received";
/** Refunded / returned value raised against the order (credit), whatever its money status. */
const creditOf = (r: Row) => (r.adjustment && (r.adjustment.kind === "returned" || r.adjustment.kind === "refunded") ? Math.min(Number(r.adjustment.creditAed) || 0, r.grossAed) : 0);
const isAdjusted = (r: Row) => r.status === "adjusted" || Boolean(r.adjustment && r.adjustment.kind !== "received" && r.adjustment.kind !== "cancelled");
const isOpen = (r: Row) => !isReceived(r) && r.status !== "adjusted" && r.status !== "cancelled";

export function StoreReceipts() {
  const today = dubaiToday();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [store, setStore] = useState<string>("ALL");
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ uid: string; orderNumber: string; kind: Kind } | null>(null);

  const load = useCallback(async () => {
    if (!from || !to || from > to) return;
    setLoading(true); setError("");
    try {
      const ledgers = await Promise.all(monthsBetween(from, to).map(async (m) => {
        const r = await fetch(`/api/orders/sales-ledger?month=${m}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        return j as SalesLedger;
      }));
      const out: Row[] = [];
      for (const l of ledgers) for (const d of l.days) {
        if (d.day < from || d.day > to) continue;
        for (const o of d.orderList as LedgerOrder[]) out.push({
          uid: o.uid, store: o.store, orderNumber: o.orderNumber, orderDate: o.orderDate, customerName: o.customerName, gateway: o.gateway,
          grossAed: o.grossAed, receivedAed: o.receivedAed, status: o.status, reason: o.reason, adjustment: o.adjustment,
        });
        for (const c of d.cancelled.list as LedgerCancelledOrder[]) out.push({
          uid: c.uid, store: c.store, orderNumber: c.orderNumber, orderDate: c.orderDate, customerName: c.customerName, gateway: c.gateway,
          grossAed: c.grossAed, receivedAed: 0, status: "cancelled", reason: "Cancelled — not a sale", adjustment: c.adjustment,
        });
      }
      out.sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || "") || b.orderNumber.localeCompare(a.orderNumber));
      setRows(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const blank = () => ({ sales: 0, orders: 0, receivedGross: 0, receivedNet: 0, openGross: 0, openOrders: 0, adjusted: 0, refunds: 0, exchanges: 0, cancelled: 0 });
    const by: Record<string, ReturnType<typeof blank>> = { ALL: blank() };
    for (const r of rows ?? []) {
      for (const k of ["ALL", r.store]) {
        const s = (by[k] ??= blank());
        if (r.status === "cancelled") { s.cancelled += r.grossAed; continue; }
        s.sales += r.grossAed; s.orders += 1;
        s.refunds += creditOf(r);
        if (r.adjustment?.kind === "exchanged") s.exchanges += 1;
        if (isReceived(r)) { s.receivedGross += r.grossAed; s.receivedNet += r.receivedAed; }
        else if (r.status === "adjusted") s.adjusted += r.grossAed;
        else { s.openGross += r.grossAed; s.openOrders += 1; }
      }
    }
    return by;
  }, [rows]);

  const storeTabs = STORES.filter((s) => s.id !== "WOO" || (summary.WOO?.orders ?? 0) > 0);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) =>
      (store === "ALL" || r.store === store) &&
      (filter === "all" || (filter === "open" ? isOpen(r) : filter === "received" ? isReceived(r) : filter === "adjusted" ? isAdjusted(r) : r.status === filter)) &&
      (!needle || r.orderNumber.toLowerCase().includes(needle) || (r.customerName || "").toLowerCase().includes(needle)));
  }, [rows, store, filter, q]);

  const s = summary[store] ?? summary.ALL;
  const counts = useMemo(() => {
    const base = (rows ?? []).filter((r) => store === "ALL" || r.store === store);
    return {
      all: base.length, open: base.filter(isOpen).length, received: base.filter(isReceived).length,
      adjusted: base.filter(isAdjusted).length, cancelled: base.filter((r) => r.status === "cancelled").length,
    };
  }, [rows, store]);

  return (
    <div className="sr">
      <style>{SR_CSS}</style>

      <section className="sr-panel">
        <header className="sr-head">
          <div>
            <h2>Sales &amp; receipts</h2>
            <p>What the stores sold, and whether each order&apos;s money reached the bank.</p>
          </div>
          <div className="sr-range">
            <button className={`sr-chip ${from === monthStart(today) && to === today ? "on" : ""}`} onClick={() => { setFrom(monthStart(today)); setTo(today); }}>This month</button>
            <button className={`sr-chip ${from === prevMonth(today) && to === monthEnd(prevMonth(today)) ? "on" : ""}`} onClick={() => { const p = prevMonth(today); setFrom(p); setTo(monthEnd(p)); }}>Last month</button>
            <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
            <button className="sr-icon" onClick={load} aria-label="Refresh" disabled={loading}>{loading ? <Loader2 size={15} className="sr-spin" /> : <RefreshCw size={15} />}</button>
          </div>
        </header>

        <div className="sr-kpis">
          <Kpi label="Sales" value={aed(summary.ALL.sales)} sub={`${summary.ALL.orders} orders · net after refunds ${aed(summary.ALL.sales - summary.ALL.refunds)}`} />
          <Kpi label="Paid in · sales value" value={aed(summary.ALL.receivedGross)} sub={`${aed(summary.ALL.receivedNet)} cash in bank after fees`} tone="ok" />
          <Kpi label="Still to come" value={aed(summary.ALL.openGross)} sub={`${summary.ALL.openOrders} orders`} tone={summary.ALL.openGross > 0 ? "warn" : undefined} />
          <Kpi label="Refunds & returns" value={aed(summary.ALL.refunds)} sub={`${summary.ALL.exchanges} exchanges${summary.ALL.cancelled ? ` · ${aed(summary.ALL.cancelled)} cancelled` : ""}`} />
        </div>
        {error && <p className="sr-error">Couldn&apos;t load: {error}</p>}
      </section>

      {rows && from === monthStart(from) && to === monthEnd(from) && to < today && (
        <MonthClose month={from.slice(0, 7)} ledgerSales={summary.ALL.sales} ledgerRefunds={summary.ALL.refunds} ledgerOrders={summary.ALL.orders} />
      )}

      <section className="sr-panel">
        <div className="sr-tabs" role="tablist">
          <button role="tab" aria-selected={store === "ALL"} className={store === "ALL" ? "on" : ""} onClick={() => setStore("ALL")}>
            All stores <span>{aed(summary.ALL.sales)}</span>
          </button>
          {storeTabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={store === t.id} className={store === t.id ? "on" : ""} onClick={() => setStore(t.id)}>
              {t.label} <span>{aed(summary[t.id]?.sales ?? 0)}</span>
            </button>
          ))}
        </div>

        <div className="sr-storeline">
          <span><b>{aed(s.sales)}</b> sales · {s.orders} orders</span>
          <span className="ok"><b>{aed(s.receivedGross)}</b> paid in ({aed(s.receivedNet)} cash after fees)</span>
          <span className={s.openGross > 0 ? "warn" : ""}><b>{aed(s.openGross)}</b> still to come · {s.openOrders} orders</span>
          {s.refunds > 0 && <span><b>{aed(s.refunds)}</b> refunded · net {aed(s.sales - s.refunds)}</span>}
        </div>

        <div className="sr-tools">
          <div className="sr-filters">
            {([["open", "Not received"], ["received", "Received"], ["adjusted", "Returned / exchanged"], ["cancelled", "Cancelled"], ["all", "All"]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} className={`sr-chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l} <span>{counts[k]}</span></button>
            ))}
          </div>
          <div className="sr-tools-right">
            <RefundFinderButton
              defaultMonth={from.slice(0, 7)}
              onApplied={load}
              onOpenOrder={(uid, orderNumber, kind) => setDialog({ uid, orderNumber, kind })}
            />
            <label className="sr-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order no. or customer" /></label>
          </div>
        </div>

        <div className="sr-table-wrap">
          <table className="sr-table">
            <thead>
              <tr><th>Order</th><th>Date</th><th>Store</th><th>Customer</th><th>Gateway</th><th className="num">Sale</th><th className="num">Received</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const received = isReceived(r);
                const tone = received ? "ok" : STATUS_TONE[r.status];
                const credit = creditOf(r);
                const label = received && credit > 0 ? `Received · ${r.adjustment!.kind} ${aed(credit)}`
                  : received && r.adjustment?.kind === "exchanged" ? "Received · exchanged"
                  : received ? (r.status === "received" ? "Received" : "Received (marked)")
                  : r.adjustment && r.adjustment.kind !== "received" ? `${cap(r.adjustment.kind)}${credit > 0 ? ` ${aed(credit)}` : ""}` : STATUS_LABEL[r.status];
                const done = r.status === "adjusted" || r.status === "cancelled" || Boolean(r.adjustment && r.adjustment.kind !== "received");
                return (
                  <tr key={`${r.uid}-${r.status}`} className={isOpen(r) ? "open" : ""}>
                    <td className="mono">#{r.orderNumber}</td>
                    <td className="nowrap">{r.orderDate ? new Date(`${r.orderDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—"}</td>
                    <td>{STORES.find((x) => x.id === r.store)?.label.replace("Shopify ", "") ?? r.store}</td>
                    <td className="name" dir="auto">{r.customerName || "—"}</td>
                    <td>{r.gateway}</td>
                    <td className="num">{aed2(r.grossAed)}</td>
                    <td className="num">{r.receivedAed ? aed2(r.receivedAed) : "—"}</td>
                    <td><span className={`sr-pill ${tone}`} title={r.reason}>{label}</span><div className="sr-reason">{r.reason}</div></td>
                    <td>
                      {done ? (
                        <button className="sr-act ghost" onClick={() => setDialog({ uid: r.uid, orderNumber: r.orderNumber, kind: (r.adjustment?.kind as Kind) ?? "returned" })}>View / undo</button>
                      ) : (
                        <div className="sr-acts">
                          {!received && <button className="sr-act ok" onClick={() => setDialog({ uid: r.uid, orderNumber: r.orderNumber, kind: "received" })}>Received</button>}
                          {!received && <button className="sr-act" onClick={() => setDialog({ uid: r.uid, orderNumber: r.orderNumber, kind: "cancelled" })}>Cancelled</button>}
                          <button className="sr-act" onClick={() => setDialog({ uid: r.uid, orderNumber: r.orderNumber, kind: "returned" })}>Returned</button>
                          <button className="sr-act" onClick={() => setDialog({ uid: r.uid, orderNumber: r.orderNumber, kind: "exchanged" })}>Exchanged</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows && visible.length === 0 && <tr><td colSpan={9} className="sr-empty">Nothing here for this range{filter === "open" ? " — every order's money is in" : ""}.</td></tr>}
              {!rows && <tr><td colSpan={9} className="sr-empty"><Loader2 size={14} className="sr-spin" /> Loading orders…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {dialog && (
        <OrderAdjustDialog
          uid={dialog.uid} orderNumber={dialog.orderNumber} initialKind={dialog.kind}
          onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`sr-kpi ${tone ?? ""}`}>
      <span className="sr-kpi-l">{label}</span>
      <b>{value}</b>
      <span className="sr-kpi-s">{sub}</span>
    </div>
  );
}

const SR_CSS = `
  .sr { display: flex; flex-direction: column; gap: 16px; font-family: var(--os-font); color: var(--os-ink); }
  .sr * { box-sizing: border-box; }
  .sr-panel { background: var(--os-card); border: 1px solid var(--os-line); border-radius: 24px; padding: 20px 22px; }
  .sr-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
  .sr-head h2 { margin: 0; font-size: 18px; font-weight: 700; }
  .sr-head p { margin: 4px 0 0; font-size: 13px; color: var(--os-muted); }
  .sr-range { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12.5px; color: var(--os-muted); }
  .sr-range label { display: inline-flex; gap: 6px; align-items: center; }
  .sr-range input { height: 34px; border: 1px solid var(--os-line); border-radius: 10px; padding: 0 10px; font: inherit; color: var(--os-ink); background: #fff; }
  .sr-chip { height: 34px; border: 1px solid var(--os-line); background: #fff; border-radius: 999px; padding: 0 13px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--os-ink-2); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  .sr-chip span { font-weight: 500; color: var(--os-muted); }
  .sr-chip.on { background: #0F1B3D; border-color: #0F1B3D; color: #fff; }
  .sr-chip.on span { color: #C9D5EA; }
  .sr-icon { height: 34px; width: 34px; border: 1px solid var(--os-line); background: #fff; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--os-ink); }
  .sr-spin { animation: srspin 1s linear infinite; }
  @keyframes srspin { to { transform: rotate(360deg); } }

  .sr-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 18px; }
  .sr-kpi { border: 1px solid var(--os-line); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
  .sr-kpi-l { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: var(--os-muted); }
  .sr-kpi b { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .sr-kpi-s { font-size: 12px; color: var(--os-muted); }
  .sr-kpi.ok b { color: #047857; } .sr-kpi.warn b { color: #B45309; }
  .sr-error { margin: 12px 0 0; color: #BE123C; font-size: 13px; }

  .sr-tabs { display: flex; gap: 6px; overflow-x: auto; border-bottom: 1px solid var(--os-line); margin: -4px -4px 0; padding: 0 4px; }
  .sr-tabs button { border: 0; background: none; padding: 10px 14px 12px; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--os-muted); cursor: pointer; white-space: nowrap; border-bottom: 2.5px solid transparent; margin-bottom: -1px; display: inline-flex; gap: 8px; align-items: baseline; }
  .sr-tabs button span { font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .sr-tabs button.on { color: var(--os-ink); border-bottom-color: #2563EB; }

  .sr-storeline { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 13px; color: var(--os-ink-2); margin: 14px 0 12px; }
  .sr-storeline b { font-variant-numeric: tabular-nums; color: var(--os-ink); }
  .sr-storeline .ok b { color: #047857; } .sr-storeline .warn b { color: #B45309; }

  .sr-tools { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .sr-filters { display: flex; gap: 6px; flex-wrap: wrap; }
  .sr-tools-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .sr-search { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--os-line); border-radius: 999px; padding: 0 12px; height: 34px; color: var(--os-muted); }
  .sr-search input { border: 0; outline: 0; font: inherit; font-size: 13px; width: 190px; color: var(--os-ink); background: transparent; }

  .sr-table-wrap { overflow-x: auto; border: 1px solid var(--os-line); border-radius: 16px; max-height: 70vh; overflow-y: auto; }
  .sr-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .sr-table th { position: sticky; top: 0; background: #F3F6FC; text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--os-muted); font-weight: 700; padding: 10px 12px; z-index: 1; }
  .sr-table td { padding: 10px 10px; border-top: 1px solid #E6ECF7; vertical-align: top; }
  .sr-table tr.open td { background: #FFFDF6; }
  .sr-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sr-table .nowrap { white-space: nowrap; }
  .sr-table .mono { font-family: ui-monospace, monospace; white-space: nowrap; }
  .sr-table .name { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sr-reason { font-size: 11px; color: var(--os-muted); margin-top: 4px; max-width: 200px; line-height: 1.35; }
  .sr-empty { text-align: center; color: var(--os-muted); padding: 28px !important; }
  .sr-pill { display: inline-flex; font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
  .sr-pill.ok { background: #D1FAE5; color: #047857; } .sr-pill.warn { background: #FEF3C7; color: #B45309; }
  .sr-pill.bad { background: #FFE4E6; color: #BE123C; } .sr-pill.muted { background: #EEF2FA; color: #5E6B85; }
  .sr-acts { display: flex; gap: 5px; flex-wrap: nowrap; }
  .sr-act { height: 28px; border: 1px solid var(--os-line); background: #fff; border-radius: 8px; padding: 0 8px; font: inherit; font-size: 11.5px; font-weight: 600; color: var(--os-ink); cursor: pointer; white-space: nowrap; }
  .sr-act:hover { border-color: #2563EB; color: #1D4ED8; }
  .sr-act.ok { background: #047857; border-color: #047857; color: #fff; }
  .sr-act.ok:hover { background: #065F46; color: #fff; }
  .sr-act.ghost { color: var(--os-muted); }

  @media (max-width: 980px) { .sr-kpis { grid-template-columns: repeat(2, 1fr); } }
`;
