"use client";

/* Money drawer — every hero number opens here with its full breakdown, so no
   headline figure on the dashboard is a dead end. Portaled to <body> (never
   trust ancestor stacking contexts) with self-contained styling. */

import { AnimatePresence, motion } from "framer-motion";
import { X, Landmark, TrendingUp, Clock, Wallet, ArrowRight, BadgeCheck, AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";
import type { Dash, MoneyDrawerKind } from "./types";
import { STORE_COLOR, GATEWAY_COLOR, aed, aed2, shortDate } from "./types";

const TITLES: Record<Exclude<MoneyDrawerKind, null>, { icon: React.ElementType; title: string; sub: string }> = {
  revenue: { icon: TrendingUp, title: "Where revenue came from", sub: "order revenue in the selected window, by store" },
  cash: { icon: Landmark, title: "Cash that reached the bank", sub: "every credit on the bank statement, by provider" },
  awaiting: { icon: Clock, title: "Credits waiting to be explained", sub: "bank credits with no payout file behind them yet" },
  cod: { icon: Wallet, title: "Cash riding with couriers", sub: "delivered-COD money not yet remitted to the bank" },
};

function StoreSplit({ data }: { data: Dash }) {
  const max = Math.max(...data.stores.map((s) => s.revenue), 1);
  return (
    <div className="md-rows">
      {data.stores.map((s) => (
        <div key={s.store} className="md-bar-row">
          <span className="md-bar-name"><i style={{ background: STORE_COLOR[s.store] }} />{s.store}</span>
          <div className="md-track"><div className="md-fill" style={{ width: `${(s.revenue / max) * 100}%`, background: STORE_COLOR[s.store] }} /></div>
          <span className="md-bar-val">{aed(s.revenue)} <em>{s.orders} orders</em></span>
        </div>
      ))}
    </div>
  );
}

function CreditList({ credits }: { credits: Dash["payouts"]["recent"] }) {
  if (credits.length === 0) return <p className="md-quiet">Nothing here right now.</p>;
  return (
    <div className="md-rows">
      {credits.map((p) => (
        <div key={p.id} className="md-credit">
          <span className="md-date">{p.date ? shortDate(p.date) : "—"}</span>
          <span className="md-prov"><i style={{ background: GATEWAY_COLOR[p.provider] ?? "#94a3b8" }} />{p.provider}</span>
          <span className="md-ref">{p.reference || "—"}</span>
          {p.state === "SETTLED"
            ? <span className="md-pill ok"><BadgeCheck size={11} />{p.confirmed ? "Confirmed" : "Settled"}</span>
            : p.state === "AWAITING_PAYOUT"
              ? <span className="md-pill muted"><Clock size={11} />Awaiting</span>
              : <span className="md-pill bad"><AlertTriangle size={11} />Check</span>}
          <b>{aed2(p.amount)}</b>
        </div>
      ))}
    </div>
  );
}

export function MoneyDrawer({ kind, data, onClose }: { kind: MoneyDrawerKind; data: Dash; onClose: () => void }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {kind && (
        <motion.div className="md-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <style>{DRAWER_CSS}</style>
          <motion.div className="md-drawer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const meta = TITLES[kind];
              const k = data.kpis;
              return (
                <>
                  <header>
                    <div>
                      <span className="md-eyebrow"><meta.icon size={13} /> {data.window.days}-day window{data.window.store !== "ALL" ? ` · ${data.window.store}` : ""}</span>
                      <h2>{meta.title}</h2>
                      <p>{meta.sub}</p>
                    </div>
                    <button className="md-x" onClick={onClose}><X size={16} /></button>
                  </header>

                  {kind === "revenue" && (
                    <>
                      <div className="md-stats">
                        <div><span>Revenue</span><b>{aed(k.revenue)}</b></div>
                        <div><span>Orders</span><b>{k.orders.toLocaleString()}</b></div>
                        <div><span>Avg order</span><b>{aed(k.aov)}</b></div>
                        <div><span>Prev. window</span><b>{aed(data.previous.revenue)}</b></div>
                      </div>
                      <section><h3>By store</h3><StoreSplit data={data} /></section>
                      <section>
                        <h3>By payment method</h3>
                        <div className="md-rows">
                          {data.gateways.map((g) => (
                            <div key={g.gateway} className="md-bar-row">
                              <span className="md-bar-name"><i style={{ background: GATEWAY_COLOR[g.gateway] ?? "#94a3b8" }} />{g.gateway}</span>
                              <div className="md-track"><div className="md-fill" style={{ width: `${g.share}%`, background: GATEWAY_COLOR[g.gateway] ?? "#94a3b8" }} /></div>
                              <span className="md-bar-val">{aed(g.revenue)} <em>{g.share}%</em></span>
                            </div>
                          ))}
                        </div>
                      </section>
                    </>
                  )}

                  {kind === "cash" && (
                    <>
                      <div className="md-stats">
                        <div><span>Total credits</span><b>{aed(k.bankCredits)}</b></div>
                        <div><span>Proven settled</span><b className="ok">{aed(k.settled)}</b></div>
                        <div><span>Statement to</span><b>{data.documents.lastStatementDate ? shortDate(data.documents.lastStatementDate) : "—"}</b></div>
                      </div>
                      <section>
                        <h3>By provider</h3>
                        <div className="md-provider-grid">
                          {data.payouts.byProvider.map((p) => (
                            <div key={p.provider}>
                              <span><i style={{ background: GATEWAY_COLOR[p.provider] ?? "#94a3b8" }} />{p.provider}</span>
                              <b>{aed(p.total)}</b>
                              <em>{p.count} credit{p.count === 1 ? "" : "s"}</em>
                            </div>
                          ))}
                        </div>
                      </section>
                      <section><h3>Recent credits</h3><CreditList credits={data.payouts.recent} /></section>
                    </>
                  )}

                  {kind === "awaiting" && (
                    <>
                      <div className="md-stats">
                        <div><span>Waiting</span><b className="warn">{aed(k.awaitingPayout)}</b></div>
                        <div><span>Of all credits</span><b>{k.bankCredits > 0 ? `${((k.awaitingPayout / k.bankCredits) * 100).toFixed(0)}%` : "—"}</b></div>
                      </div>
                      <p className="md-note">This money HAS reached the bank — it just has no payout file proving which gateway and which orders it pays for. Upload the missing files in Reconciliation and these credits flip to settled.</p>
                      <section><h3>Waiting credits</h3><CreditList credits={data.payouts.recent.filter((p) => p.state === "AWAITING_PAYOUT")} /></section>
                      <a className="md-cta" href="/reconciliation">Open reconciliation <ArrowRight size={14} /></a>
                    </>
                  )}

                  {kind === "cod" && (
                    <>
                      <div className="md-stats">
                        <div><span>Outstanding</span><b className="warn">{aed(k.codPendingAed)}</b></div>
                        <div><span>Orders</span><b>{k.codPendingCount.toLocaleString()}</b></div>
                        <div><span>Of window revenue</span><b>{k.revenue > 0 ? `${((k.codPendingAed / k.revenue) * 100).toFixed(0)}%` : "—"}</b></div>
                      </div>
                      <p className="md-note">Cash-on-delivery money the couriers have collected (or will collect) but haven&apos;t remitted to the bank yet. It only becomes real cash when the courier&apos;s remittance lands on the statement — chase the oldest batches first.</p>
                      <a className="md-cta" href="/orders">Review COD orders <ArrowRight size={14} /></a>
                    </>
                  )}
                </>
              );
            })()}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const DRAWER_CSS = `
  .md-overlay { position: fixed; inset: 0; background: rgba(31,27,22,.5); backdrop-filter: blur(2px); z-index: 80; display: flex; justify-content: flex-end; }
  .md-overlay * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
  .md-drawer { background: #FBF8F1; width: 100%; max-width: 560px; height: 100%; overflow-y: auto; box-shadow: -16px 0 50px rgba(0,0,0,.25); padding: 24px 26px 40px; color: #1F1B16; }
  .md-drawer header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 18px; }
  .md-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #7c3aed; }
  .md-drawer h2 { font-family: Georgia, serif; font-weight: 500; font-size: 22px; margin: 8px 0 4px; }
  .md-drawer header p { margin: 0; font-size: 12.5px; color: #8A8175; }
  .md-x { border: 1px solid #EAE3D6; background: #fff; border-radius: 9px; padding: 7px; cursor: pointer; color: #8A8175; display: flex; flex-shrink: 0; }
  .md-x:hover { color: #7c3aed; border-color: #c4b5fd; }

  .md-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 18px; }
  .md-stats > div { background: #fff; border: 1px solid #EAE3D6; border-radius: 12px; padding: 11px 13px; display: flex; flex-direction: column; gap: 3px; }
  .md-stats span { font-size: 10.5px; color: #8A8175; }
  .md-stats b { font-family: Georgia, serif; font-size: 17px; font-weight: 500; }
  .md-stats b.ok { color: #059669; } .md-stats b.warn { color: #b45309; }

  .md-drawer section { margin-bottom: 18px; }
  .md-drawer h3 { font-size: 13px; margin: 0 0 10px; color: #1F1B16; }
  .md-rows { display: flex; flex-direction: column; gap: 8px; }
  .md-bar-row { display: flex; align-items: center; gap: 10px; }
  .md-bar-name { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; min-width: 96px; }
  .md-bar-name i, .md-prov i { width: 8px; height: 8px; border-radius: 2.5px; display: inline-block; flex-shrink: 0; }
  .md-track { flex: 1; height: 12px; background: #F0EADC; border-radius: 6px; overflow: hidden; }
  .md-fill { height: 100%; border-radius: 6px; min-width: 2px; transition: width .4s ease; }
  .md-bar-val { font-size: 12px; min-width: 128px; text-align: right; font-variant-numeric: tabular-nums; }
  .md-bar-val em { font-style: normal; color: #8A8175; margin-left: 4px; font-size: 11px; }

  .md-provider-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 9px; }
  .md-provider-grid > div { background: #fff; border: 1px solid #EAE3D6; border-radius: 11px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
  .md-provider-grid span { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #8A8175; }
  .md-provider-grid b { font-family: Georgia, serif; font-size: 15px; font-weight: 500; }
  .md-provider-grid em { font-style: normal; font-size: 10px; color: #8A8175; }

  .md-credit { display: flex; align-items: center; gap: 9px; background: #fff; border: 1px solid #EAE3D6; border-radius: 10px; padding: 8px 12px; font-size: 12px; }
  .md-date { color: #8A8175; min-width: 44px; font-variant-numeric: tabular-nums; }
  .md-prov { display: inline-flex; align-items: center; gap: 6px; min-width: 74px; font-weight: 600; }
  .md-ref { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8A8175; font-family: ui-monospace, monospace; font-size: 11px; }
  .md-credit b { font-variant-numeric: tabular-nums; }
  .md-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
  .md-pill.ok { background: #d1fae5; color: #047857; } .md-pill.muted { background: #F3EFE7; color: #8A8175; } .md-pill.bad { background: #fee2e2; color: #dc2626; }

  .md-note { font-size: 12.5px; line-height: 1.6; color: #6F5325; background: #FBF3E6; border-radius: 12px; padding: 12px 14px; margin: 0 0 18px; }
  .md-quiet { color: #8A8175; font-size: 12.5px; margin: 0; }
  .md-cta { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: #fff; text-decoration: none;
    background: linear-gradient(120deg, #7c3aed, #a855f7); border-radius: 11px; padding: 11px 18px; }
`;
