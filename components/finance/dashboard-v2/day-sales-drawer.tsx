"use client";

/* Day sales drawer — opens from a day on the Gross Sales chart or day list.
   Lists every paid order that makes up that day's amount, and traces each one
   down the money chain: payout file line (fee + net) → bank credit (date +
   reference). Where the money isn't in yet it says why, in words.

   Portaled to <body> with self-contained hex, same as MoneyDrawer — an inline
   position:fixed inside the dashboard's stacking context is what broke the
   invoice/ship modals before. */

import { AnimatePresence, motion } from "framer-motion";
import { X, Landmark, FileText, BadgeCheck, Clock, AlertTriangle, FileX, Wallet, ArrowRight } from "lucide-react";
import { createPortal } from "react-dom";
import { STORE_COLOR, GATEWAY_COLOR, aed2 } from "./types";

export type LedgerStatus = "received" | "in_review" | "awaiting_bank" | "no_payout_file" | "cod";

export type LedgerOrder = {
  uid: string;
  store: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  gateway: string;
  grossAed: number;
  feeAed: number;
  receivedAed: number;
  feeBasis: "measured" | "allocated" | "estimated";
  status: LedgerStatus;
  reason: string;
  partial: { gateway: string; grossAed: number; payoutId: string } | null;
  payout: { id: string; gateway: string; source: string | null; uploadedAt: string | null; netAed: number; feeAed: number | null } | null;
  bank: { id: string; date: string | null; amountAed: number; reference: string; state: string; confirmed: boolean } | null;
};

export type LedgerDay = {
  day: string;
  grossAed: number;
  orders: number;
  byStore: Record<string, number>;
  feeAed: number;
  receivedAed: number;
  receivedGrossAed: number;
  statusCounts: Record<LedgerStatus, { orders: number; grossAed: number }>;
  headline: LedgerStatus | "empty";
  reason: string;
  orderList: LedgerOrder[];
};

export const STATUS_META: Record<LedgerStatus, { label: string; tone: string; icon: React.ElementType; color: string }> = {
  received: { label: "Received in bank", tone: "ok", icon: BadgeCheck, color: "#34d399" },
  in_review: { label: "Needs confirming", tone: "warn", icon: AlertTriangle, color: "#fbbf24" },
  awaiting_bank: { label: "Awaiting bank credit", tone: "info", icon: Clock, color: "#60a5fa" },
  no_payout_file: { label: "Payout file not uploaded", tone: "bad", icon: FileX, color: "#fb7185" },
  cod: { label: "Cash on delivery", tone: "muted", icon: Wallet, color: "#c084fc" },
};

const BASIS_LABEL = { measured: "from payout file", allocated: "share of file fee", estimated: "estimated" } as const;

const longDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

export function DaySalesDrawer({ day, onClose }: { day: LedgerDay | null; onClose: () => void }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {day && (
        <motion.div className="dsd-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <style>{DRAWER_CSS}</style>
          <motion.div
            className="dsd-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Sales on ${longDate(day.day)}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="dsd-eyebrow">Gross sales · Dubai day</span>
                <h2>{longDate(day.day)}</h2>
                <p>{day.orders} {day.orders === 1 ? "order" : "orders"} · {day.reason}</p>
              </div>
              <button className="dsd-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </header>

            <div className="dsd-sum">
              <div><span>Gross sales</span><b>{aed2(day.grossAed)}</b></div>
              <div><span>Gateway fees</span><b>{aed2(day.feeAed)}</b></div>
              <div><span>Received in bank</span><b>{aed2(day.receivedAed)}</b></div>
              <div><span>Not in bank yet</span><b>{aed2(Math.max(day.grossAed - day.receivedGrossAed, 0))}</b><em>gross</em></div>
            </div>

            <div className="dsd-status-row">
              {(Object.keys(STATUS_META) as LedgerStatus[]).filter((s) => day.statusCounts[s].orders > 0).map((s) => {
                const m = STATUS_META[s];
                return (
                  <span key={s} className={`dsd-pill ${m.tone}`}>
                    <m.icon size={11} />{m.label} · {day.statusCounts[s].orders} · {aed2(day.statusCounts[s].grossAed)}
                  </span>
                );
              })}
            </div>

            {day.orderList.length === 0 && <p className="dsd-quiet">No sales on this day.</p>}

            <div className="dsd-list">
              {day.orderList.map((o) => {
                const m = STATUS_META[o.status];
                return (
                  <article key={o.uid} className="dsd-order">
                    <div className="dsd-order-top">
                      <span className="dsd-store" style={{ background: `${STORE_COLOR[o.store] ?? "#94a3b8"}26`, color: STORE_COLOR[o.store] ?? "#64748b" }}>{o.store}</span>
                      <span className="dsd-num">#{o.orderNumber}</span>
                      <span className="dsd-name" dir="auto">{o.customerName || "—"}</span>
                      <span className="dsd-time">{time(o.orderDate)}</span>
                      <b className="dsd-gross">{aed2(o.grossAed)}</b>
                    </div>

                    <div className="dsd-chain">
                      <div className="dsd-step">
                        <span className="dsd-label"><i style={{ background: GATEWAY_COLOR[o.gateway] ?? "#94a3b8" }} />{o.gateway}</span>
                        {o.status === "cod" ? (
                          <span className="dsd-v">No gateway fee</span>
                        ) : (
                          <span className="dsd-v">Fee {aed2(o.feeAed)} <em>{BASIS_LABEL[o.feeBasis]}</em></span>
                        )}
                      </div>
                      <ArrowRight size={12} className="dsd-arrow" />
                      <div className="dsd-step">
                        <span className="dsd-label"><FileText size={11} />Payout file</span>
                        {o.payout ? (
                          <span className="dsd-v" title={o.payout.id}>{o.payout.source || o.payout.id}</span>
                        ) : (
                          <span className="dsd-v dsd-miss">
                            {o.status === "cod" ? "n/a" : "Not uploaded yet"}
                            {o.partial && <em title={o.partial.payoutId}> · only {aed2(o.partial.grossAed)} in a {o.partial.gateway} payout</em>}
                          </span>
                        )}
                      </div>
                      <ArrowRight size={12} className="dsd-arrow" />
                      <div className="dsd-step">
                        <span className="dsd-label"><Landmark size={11} />Bank credit</span>
                        {o.bank ? (
                          <span className="dsd-v">
                            {o.bank.date ?? "—"} · {aed2(o.bank.amountAed)}
                            {o.bank.reference && <em> ref {o.bank.reference}</em>}
                          </span>
                        ) : (
                          <span className="dsd-v dsd-miss">{o.status === "cod" ? "via courier remittance" : "Not matched yet"}</span>
                        )}
                      </div>
                    </div>

                    <div className="dsd-order-foot">
                      <span className={`dsd-pill ${m.tone}`}><m.icon size={11} />{m.label}</span>
                      <span className="dsd-reason">{o.reason}</span>
                      {o.status === "received" && <b className="dsd-recv">+{aed2(o.receivedAed)}</b>}
                    </div>
                  </article>
                );
              })}
            </div>

            <a className="dsd-more" href="/reconciliation">Upload payout files or confirm credits in Reconciliation <ArrowRight size={12} /></a>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const DRAWER_CSS = `
  .dsd-overlay { position: fixed; inset: 0; background: rgba(31,27,22,.5); backdrop-filter: blur(2px); z-index: 80; display: flex; justify-content: flex-end; }
  .dsd-overlay * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
  .dsd-drawer { background: #FBF8F1; width: 100%; max-width: 680px; height: 100%; overflow-y: auto; box-shadow: -16px 0 50px rgba(0,0,0,.25); padding: 24px 24px 40px; color: #1F1B16; }
  .dsd-drawer header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
  .dsd-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8A8175; font-weight: 600; }
  .dsd-drawer h2 { font-family: Georgia, serif; font-weight: 500; font-size: 22px; margin: 6px 0 4px; }
  .dsd-drawer header p { margin: 0; font-size: 12.5px; color: #6F6457; line-height: 1.5; }
  .dsd-x { border: 1px solid #EAE3D6; background: #fff; border-radius: 10px; width: 36px; height: 36px; display: grid; place-items: center; cursor: pointer; color: #1F1B16; flex: none; }
  .dsd-sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .dsd-sum div { background: #fff; border: 1px solid #EAE3D6; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
  .dsd-sum span { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #8A8175; font-weight: 600; }
  .dsd-sum b { font-size: 15px; font-variant-numeric: tabular-nums; }
  .dsd-sum em { font-style: normal; font-size: 10.5px; color: #8A8175; }
  .dsd-status-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .dsd-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 3px 9px; border-radius: 999px; font-weight: 500; white-space: nowrap; }
  .dsd-pill.ok { background: #d1fae5; color: #047857; } .dsd-pill.bad { background: #ffe4e6; color: #be123c; }
  .dsd-pill.warn { background: #fef3c7; color: #b45309; } .dsd-pill.info { background: #dbeafe; color: #1d4ed8; }
  .dsd-pill.muted { background: #F3EFE7; color: #6F6457; }
  .dsd-quiet { color: #8A8175; font-size: 13px; }
  .dsd-list { display: flex; flex-direction: column; gap: 8px; }
  .dsd-order { background: #fff; border: 1px solid #EAE3D6; border-radius: 14px; padding: 11px 13px; display: flex; flex-direction: column; gap: 9px; }
  .dsd-order-top { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
  .dsd-store { font-size: 10.5px; font-weight: 800; border-radius: 7px; padding: 3px 8px; }
  .dsd-num { font-family: ui-monospace, monospace; font-size: 12px; }
  .dsd-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dsd-time { color: #8A8175; font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .dsd-gross { font-variant-numeric: tabular-nums; min-width: 92px; text-align: right; }
  .dsd-chain { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: start; gap: 6px; background: #FBF8F1; border-radius: 10px; padding: 8px 10px; }
  .dsd-step { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .dsd-label { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #8A8175; font-weight: 600; }
  .dsd-label i { width: 7px; height: 7px; border-radius: 2px; }
  .dsd-v { font-size: 12px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dsd-v em { font-style: normal; color: #8A8175; font-size: 11px; }
  .dsd-miss { color: #be123c; }
  .dsd-arrow { color: #C9BFAE; margin-top: 14px; }
  .dsd-order-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .dsd-reason { font-size: 11.5px; color: #6F6457; flex: 1; min-width: 160px; }
  .dsd-recv { font-size: 12px; color: #047857; font-variant-numeric: tabular-nums; }
  .dsd-more { display: inline-flex; align-items: center; gap: 6px; margin-top: 18px; font-size: 12.5px; font-weight: 600; color: #6d28d9; text-decoration: none; }
  .dsd-more:hover { text-decoration: underline; }
  @media (max-width: 620px) {
    .dsd-drawer { padding: 18px 16px 32px; }
    .dsd-sum { grid-template-columns: repeat(2, 1fr); }
    .dsd-chain { grid-template-columns: 1fr; }
    .dsd-arrow { display: none; }
    .dsd-time { display: none; }
  }
`;
