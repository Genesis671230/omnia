"use client";

/* Month close — on Sales & receipts when the range is one whole month.
 *
 * One place that says whether the three dashboard reports agree for the month
 * and, if not, exactly which orders make the difference:
 *   1. Sales:   this tab (sales ledger) ↔ the management report's sales
 *               (cancelled in the dispatch sheet only, refunded in the store).
 *   2. Refunds: credits marked in the app ↔ the official refund
 *               (gateway cash, else Zoho credit note, else the sheet).
 *   3. Cash:    cash in bank + fees + FX − refunds on received + still to come
 *               = net sales (the management report's tie).
 *   4. Open items for the accountants, each with its orders.
 * The month counts as closed when 1–3 agree to the dirham and nothing is
 * cancelled/refunded only in the sheet. Data: /api/reports/management. */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ManagementReport } from "@/lib/reports/management-report";

const aed = (n: number) => `AED ${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** What to do about each open item — plain words for the team. */
const FIX: Record<string, string> = {
  cancelled_in_sheet_only: "Mark these Cancelled (Find refunds & cancellations).",
  store_not_updated: "Refund the order in Shopify too, so the store stops showing it as paid.",
  no_credit_note: "Raise the refund credit note in Zoho (or Open the order → Refunded).",
  zoho_ne_gateway: "Correct the Zoho credit note to the amount the gateway actually refunded.",
  sheet_ne_gateway: "Correct the dispatch sheet's refund amount to the gateway's.",
  refund_over_order: "Check the order total — the refund is larger than the sale.",
  exchange_reinvoiced: "Void the second Zoho invoice — the exchange is not a new sale.",
  store_refunded_no_amount: "Find the refund (gateway / Zoho) or reopen the order in the store.",
};

export function MonthClose({ month, ledgerSales, ledgerRefunds, ledgerOrders }: {
  month: string; ledgerSales: number; ledgerRefunds: number; ledgerOrders: number;
}) {
  const [r, setR] = useState<ManagementReport | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setR(null); setError("");
    fetch(`/api/reports/management?month=${month}`, { cache: "no-store" })
      .then(async (res) => { const j = await res.json(); if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`); return j; })
      .then((j) => live && setR(j as ManagementReport))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [month]);

  if (error) return <section className="mc"><style>{MC_CSS}</style><p className="mc-err">Month close couldn&apos;t load: {error}</p></section>;
  if (!r) return <section className="mc"><style>{MC_CSS}</style><p className="mc-quiet"><Loader2 size={14} className="mc-spin" /> Checking {monthLabel(month)} against the management report…</p></section>;

  const w = r.waterfall, t = r.cash.tie;
  const salesDiff = Math.round((ledgerSales - w.grossSales.aed) * 100) / 100;
  const refundDiff = Math.round((ledgerRefunds - w.refunds.aed) * 100) / 100;
  const tieSum = t.receivedAed + t.feesOnReceivedAed + t.fxOtherAed - t.refundsOnReceivedAed + t.receivableAed;
  const tieDiff = Math.round((tieSum - t.netSalesAed) * 100) / 100;
  const sheetOnly = r.issues.find((i) => i.key === "cancelled_in_sheet_only")?.orders ?? [];
  const reportsAgree = Math.abs(salesDiff) <= 1 && Math.abs(refundDiff) <= 1 && sheetOnly.length === 0;
  const closed = reportsAgree && Math.abs(tieDiff) <= 1;
  const openItems = r.issues.filter((i) => i.key !== "cancelled_in_sheet_only");

  return (
    <section className="mc">
      <style>{MC_CSS}</style>
      <header className="mc-head">
        <div>
          <h3>{monthLabel(month)} close</h3>
          <p>Sales &amp; receipts, the daily view and the management report, checked against each other.</p>
        </div>
        <span className={`mc-badge ${closed ? "ok" : "warn"}`}>
          {closed ? (openItems.length ? `Reports agree · ${openItems.reduce((n, i) => n + i.orders.length, 0)} accountant items open` : "Closed") : "Not closed — see below"}
        </span>
      </header>

      <div className="mc-grid">
        <div className="mc-card">
          <span className="mc-l">1 · Sales</span>
          <Row k="This tab & daily view" v={aed(ledgerSales)} n={`${ledgerOrders} orders`} />
          <Row k="− cancelled in the dispatch sheet only" v={aed(r.fromDashboard.sheetCancelled.aed)} n={`${r.fromDashboard.sheetCancelled.orders}`} />
          <Row k="+ refunded in the store (store shows 0)" v={aed(r.fromDashboard.refundedInStore.aed)} n={`${r.fromDashboard.refundedInStore.orders}`} />
          <Row k="= Management report sales" v={aed(w.grossSales.aed)} n={`${w.grossSales.orders} orders`} strong />
          {sheetOnly.length > 0 && <p className="mc-warn">Cancelled in the sheet, still a sale here: {sheetOnly.join(", ")} — mark them Cancelled.</p>}
        </div>

        <div className="mc-card">
          <span className="mc-l">2 · Refunds &amp; returns</span>
          <Row k="Marked on orders (this tab)" v={aed(ledgerRefunds)} />
          <Row k="Official refunds (gateway → Zoho → sheet)" v={aed(w.refunds.aed)} n={`${w.refunds.orders} orders`} />
          <Row k="Difference" v={aed(refundDiff)} strong tone={Math.abs(refundDiff) <= 1 ? "ok" : "warn"} />
          <Row k="Net sales" v={aed(w.netSales.aed)} strong />
          <p className="mc-note">Refunds count against the order&apos;s month. Paid out in {monthLabel(month)} for any month: {aed(r.refundsPaidThisMonth.aed)}.</p>
        </div>

        <div className="mc-card">
          <span className="mc-l">3 · Cash proof</span>
          <Row k="Cash in bank (after fees)" v={aed(t.receivedAed)} />
          <Row k="+ gateway fees on it" v={aed(t.feesOnReceivedAed)} />
          <Row k="+ FX / other" v={aed(t.fxOtherAed)} />
          <Row k="− refunds taken from received money" v={aed(t.refundsOnReceivedAed)} />
          <Row k="+ still to come" v={aed(t.receivableAed)} />
          <Row k="= Net sales" v={aed(tieSum)} strong tone={Math.abs(tieDiff) <= 1 ? "ok" : "warn"} n={Math.abs(tieDiff) <= 1 ? "ties" : `off by ${aed(tieDiff)}`} />
        </div>
      </div>

      <div className="mc-cards-2">
        <div className="mc-mini"><b>{w.cancelled.orders}</b> cancelled · {aed(w.cancelled.aed)}</div>
        <div className="mc-mini"><b>{r.exchanges.orders}</b> exchanged · {aed(r.exchanges.extraCollectedAed)} extra collected</div>
        <div className="mc-mini"><b>{w.failedUnpaid.orders}</b> failed / unpaid · not sales</div>
      </div>

      {openItems.length > 0 && (
        <div className="mc-items">
          <span className="mc-l">Open items for the accountants</span>
          {openItems.map((i) => (
            <div key={i.key} className="mc-item">
              <button onClick={() => setOpen(open === i.key ? null : i.key)}>
                <b>{i.orders.length}</b> {i.label} <span>{FIX[i.key] ?? ""}</span>
              </button>
              {open === i.key && <p className="mc-orders">{i.orders.join(" · ")}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ k, v, n, strong, tone }: { k: string; v: string; n?: string; strong?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className={`mc-row ${strong ? "strong" : ""} ${tone ?? ""}`}>
      <span>{k}</span><span className="mc-n">{n ?? ""}</span><b>{v}</b>
    </div>
  );
}

const MC_CSS = `
  .mc { background: var(--os-card); border: 1px solid var(--os-line); border-radius: 24px; padding: 20px 22px; font-family: var(--os-font); color: var(--os-ink); }
  .mc * { box-sizing: border-box; }
  .mc-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
  .mc-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
  .mc-head p { margin: 3px 0 0; font-size: 12.5px; color: var(--os-muted); }
  .mc-badge { font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 999px; }
  .mc-badge.ok { background: #D1FAE5; color: #047857; } .mc-badge.warn { background: #FEF3C7; color: #B45309; }
  .mc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
  .mc-card { border: 1px solid var(--os-line); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
  .mc-l { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: var(--os-muted); margin-bottom: 4px; }
  .mc-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; font-size: 12.5px; align-items: baseline; }
  .mc-row b { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .mc-row.strong { border-top: 1px dashed var(--os-line); padding-top: 6px; } .mc-row.strong b { font-weight: 800; }
  .mc-row.ok b { color: #047857; } .mc-row.warn b { color: #B45309; }
  .mc-n { color: var(--os-muted); font-size: 11.5px; white-space: nowrap; }
  .mc-warn { margin: 6px 0 0; font-size: 12px; color: #B45309; }
  .mc-note { margin: 6px 0 0; font-size: 11.5px; color: var(--os-muted); }
  .mc-cards-2 { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  .mc-mini { border: 1px solid var(--os-line); border-radius: 12px; padding: 8px 12px; font-size: 12.5px; color: var(--os-ink-2); }
  .mc-items { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
  .mc-item button { width: 100%; text-align: left; border: 1px solid var(--os-line); background: #fff; border-radius: 12px; padding: 9px 12px; font: inherit; font-size: 12.5px; cursor: pointer; color: var(--os-ink); display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
  .mc-item button b { color: #B45309; } .mc-item button span { color: var(--os-muted); font-size: 12px; margin-left: auto; }
  .mc-orders { margin: 6px 4px 0; font-family: ui-monospace, monospace; font-size: 12px; color: var(--os-ink-2); line-height: 1.6; }
  .mc-quiet { display: flex; gap: 8px; align-items: center; color: var(--os-muted); font-size: 13px; margin: 0; }
  .mc-err { color: #BE123C; font-size: 13px; margin: 0; }
  .mc-spin { animation: mcspin 1s linear infinite; } @keyframes mcspin { to { transform: rotate(360deg); } }
  @media (max-width: 1100px) { .mc-grid { grid-template-columns: 1fr; } }
`;
