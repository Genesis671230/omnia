"use client";

/* Contribution margin — the number a founder runs the business on: what's
   actually left after ad spend and gateway fees, per store and portfolio-wide.

   Fees are two-tier and the split is always shown:
     measured  — real fee_aed from a payout transaction
     estimated — labeled per-gateway rate where no measured fee exists
   Margin is never shown without its fee-confidence, so a measured-looking
   number is never actually estimated. Same discipline as pixel-vs-settled ROAS. */

import {
  Loader2, TrendingUp, TrendingDown, Megaphone, CreditCard, Wallet,
  AlertTriangle, CheckCircle2, HelpCircle, Info,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const STORES = ["ALL", "WOO", "KSA", "UAE", "WA"];

type StoreMargin = {
  store: string; revenue: number; orderCount: number; adSpend: number;
  feesMeasured: number; feesEstimated: number; feesTotal: number;
  measuredOrderShare: number; contributionMargin: number; marginPct: number | null;
  feeConfidence: "measured" | "mostly_measured" | "mostly_estimated";
};
type Totals = {
  revenue: number; adSpend: number; feesMeasured: number; feesEstimated: number;
  feesTotal: number; contributionMargin: number; marginPct: number | null; orderCount: number;
};
type MarginPayload = { window: { days: number; from: string; to: string; store: string }; stores: StoreMargin[]; totals: Totals };

const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v || 0);
const aed2 = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v || 0);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

const CONF_META: Record<StoreMargin["feeConfidence"], { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  measured:         { label: "Fees measured",          tone: "ok",   icon: CheckCircle2 },
  mostly_measured:  { label: "Fees mostly measured",   tone: "mid",  icon: Info },
  mostly_estimated: { label: "Fees mostly estimated",  tone: "warn", icon: AlertTriangle },
};

/* ── waterfall: revenue → −ad spend → −fees → margin ────────────────────── */
function Waterfall({ revenue, adSpend, fees, margin }: { revenue: number; adSpend: number; fees: number; margin: number }) {
  const max = Math.max(revenue, 0.01);
  const seg = (v: number) => `${Math.min(100, (Math.abs(v) / max) * 100)}%`;
  const marginNeg = margin < 0;
  return (
    <div className="wf">
      <div className="wf-row">
        <span className="wf-label"><Wallet size={12} /> Revenue</span>
        <div className="wf-bar-wrap"><div className="wf-bar revenue" style={{ width: "100%" }} /></div>
        <b className="wf-val">{aed(revenue)}</b>
      </div>
      <div className="wf-row">
        <span className="wf-label"><Megaphone size={12} /> − Ad spend</span>
        <div className="wf-bar-wrap"><div className="wf-bar spend" style={{ width: seg(adSpend) }} /></div>
        <b className="wf-val neg">−{aed(adSpend)}</b>
      </div>
      <div className="wf-row">
        <span className="wf-label"><CreditCard size={12} /> − Gateway fees</span>
        <div className="wf-bar-wrap"><div className="wf-bar fees" style={{ width: seg(fees) }} /></div>
        <b className="wf-val neg">−{aed(fees)}</b>
      </div>
      <div className="wf-row total">
        <span className="wf-label">{marginNeg ? <TrendingDown size={13} /> : <TrendingUp size={13} />} Contribution margin</span>
        <div className="wf-bar-wrap"><div className={`wf-bar margin ${marginNeg ? "neg" : ""}`} style={{ width: seg(margin) }} /></div>
        <b className={`wf-val ${marginNeg ? "loss" : "profit"}`}>{aed(margin)}</b>
      </div>
    </div>
  );
}

export function MarginPanel() {
  const [store, setStore] = useState("ALL");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<MarginPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/margin?days=${days}&store=${store}`);
      setData(await res.json());
    } catch (e) { toast.error(`Margin load failed: ${(e as Error).message}`); } finally { setLoading(false); }
  }, [days, store]);
  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const empty = !data || (t && t.revenue === 0 && t.adSpend === 0);

  return (
    <div className="margin">
      <style>{MARGIN_CSS}</style>

      <div className="store-tabs">
        {STORES.map((s) => <button key={s} className={s === store ? "storetab on" : "storetab"} onClick={() => setStore(s)}>{s}</button>)}
        <select className="days-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      </div>

      {loading && !data ? (
        <div className="empty"><Loader2 size={18} className="spin" /> Computing contribution margin…</div>
      ) : empty ? (
        <div className="empty">No revenue or spend in this window yet.</div>
      ) : (
        <>
          {/* portfolio headline */}
          <section className="panel lead">
            <header>
              <h2>Contribution margin{store !== "ALL" ? ` · ${store}` : " · all stores"}</h2>
              <span>What's left after ad spend and gateway fees · {data!.window.days}d</span>
            </header>
            <div className="headline">
              <div className="headline-num">
                <span className="hl-label">Contribution margin</span>
                <b className={t!.contributionMargin < 0 ? "loss" : "profit"}>{aed(t!.contributionMargin)}</b>
                <em>{pct(t!.marginPct)} of {aed(t!.revenue)} revenue · {t!.orderCount} orders</em>
              </div>
              <Waterfall revenue={t!.revenue} adSpend={t!.adSpend} fees={t!.feesTotal} margin={t!.contributionMargin} />
            </div>
            <div className="fee-split">
              <CreditCard size={12} />
              <span>Gateway fees {aed2(t!.feesTotal)} —
                <b className="measured"> {aed2(t!.feesMeasured)} measured</b> ·
                <b className="estimated"> {aed2(t!.feesEstimated)} estimated</b>
              </span>
              <span className="fee-note"><HelpCircle size={11} /> Estimated fees use published Gulf gateway rates, not your negotiated rates — override in lib/contribution-margin.ts</span>
            </div>
          </section>

          {/* per-store breakdown (only in ALL view) */}
          {store === "ALL" && (
            <div className="store-grid">
              {data!.stores.filter((s) => s.revenue > 0 || s.adSpend > 0).map((s) => {
                const conf = CONF_META[s.feeConfidence];
                const ConfIcon = conf.icon;
                return (
                  <div key={s.store} className="store-card">
                    <div className="sc-head">
                      <h3>{s.store}</h3>
                      <span className={`conf-badge ${conf.tone}`}><ConfIcon size={11} /> {conf.label}</span>
                    </div>
                    <div className="sc-margin">
                      <b className={s.contributionMargin < 0 ? "loss" : "profit"}>{aed(s.contributionMargin)}</b>
                      <span className="sc-pct">{pct(s.marginPct)} margin</span>
                    </div>
                    <div className="sc-lines">
                      <div className="sc-line"><span>Revenue</span><b>{aed(s.revenue)}</b></div>
                      <div className="sc-line"><span>− Ad spend</span><b className="neg">−{aed(s.adSpend)}</b></div>
                      <div className="sc-line"><span>− Fees</span><b className="neg">−{aed(s.feesTotal)}</b></div>
                      <div className="sc-line sub"><span>· measured</span><b>{aed2(s.feesMeasured)}</b></div>
                      <div className="sc-line sub"><span>· estimated</span><b>{aed2(s.feesEstimated)}</b></div>
                    </div>
                    <div className="sc-conf-bar" title={`${(s.measuredOrderShare * 100).toFixed(0)}% of orders have measured fees`}>
                      <div className="sc-conf-fill" style={{ width: `${s.measuredOrderShare * 100}%` }} />
                    </div>
                    <span className="sc-conf-text">{(s.measuredOrderShare * 100).toFixed(0)}% of {s.orderCount} orders have measured fees</span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="fine">
            <Info size={12} /> Contribution margin here = revenue − ad spend − gateway fees. It does <b>not</b> include COGS,
            shipping, salaries, or overhead — it's the margin paid media and payment processing leave on the table, not net profit.
          </p>
        </>
      )}
    </div>
  );
}

const MARGIN_CSS = `
  .margin { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
  .margin * { box-sizing: border-box; }
  .spin { animation: mgspin 1s linear infinite; } @keyframes mgspin { to { transform: rotate(360deg); } }

  .store-tabs { display: flex; gap: 8px; align-items: center; }
  .storetab { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--muted); }
  .storetab.on { border-color: var(--gold); background: var(--gold-wash); color: var(--gold-deep); }
  .days-select { margin-left: auto; border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; color: var(--ink); }
  .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }

  .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
  .panel.lead { background: linear-gradient(180deg, var(--gold-wash, #f7f0e0) 0%, var(--card) 55%); }
  .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; flex-wrap: wrap; gap: 4px; }
  .panel header h2 { font-size: 16px; margin: 0; }
  .panel header span { font-size: 12.5px; color: var(--muted); }

  .headline { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 24px; align-items: center; }
  .headline-num { display: flex; flex-direction: column; gap: 4px; }
  .hl-label { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .headline-num b { font-size: 34px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .headline-num b.profit { color: #2f8f5b; } .headline-num b.loss { color: #c0392b; }
  .headline-num em { font-size: 11.5px; color: var(--muted); font-style: normal; }

  .wf { display: flex; flex-direction: column; gap: 7px; }
  .wf-row { display: grid; grid-template-columns: 130px 1fr auto; align-items: center; gap: 10px; }
  .wf-label { font-size: 11.5px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .wf-bar-wrap { background: rgba(0,0,0,.04); border-radius: 5px; height: 18px; overflow: hidden; }
  .wf-bar { height: 100%; border-radius: 5px; transition: width .4s ease; }
  .wf-bar.revenue { background: #6b8caf; }
  .wf-bar.spend { background: #d98324; }
  .wf-bar.fees { background: #c99a6b; }
  .wf-bar.margin { background: #2f8f5b; }
  .wf-bar.margin.neg { background: #c0392b; }
  .wf-val { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .wf-val.neg { color: #b56a15; } .wf-val.profit { color: #2f8f5b; } .wf-val.loss { color: #c0392b; }
  .wf-row.total { border-top: 1px dashed var(--line); padding-top: 8px; margin-top: 3px; }
  .wf-row.total .wf-label { color: var(--ink); font-weight: 600; }

  .fee-split { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
  .fee-split > svg { color: var(--gold-deep); }
  .fee-split b { font-weight: 600; }
  .fee-split b.measured { color: #2f8f5b; } .fee-split b.estimated { color: #b56a15; }
  .fee-note { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; margin-left: auto; opacity: .8; }

  .store-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
  .store-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 10px; }
  .sc-head { display: flex; justify-content: space-between; align-items: center; }
  .sc-head h3 { margin: 0; font-size: 14px; letter-spacing: .04em; }
  .conf-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; font-weight: 600; padding: 3px 7px; border-radius: 6px; }
  .conf-badge.ok { color: #2f8f5b; background: rgba(47,143,91,.1); }
  .conf-badge.mid { color: #6b7a99; background: rgba(107,122,153,.1); }
  .conf-badge.warn { color: #b56a15; background: rgba(217,131,36,.12); }
  .sc-margin { display: flex; align-items: baseline; gap: 8px; }
  .sc-margin b { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .sc-margin b.profit { color: #2f8f5b; } .sc-margin b.loss { color: #c0392b; }
  .sc-pct { font-size: 11.5px; color: var(--muted); }
  .sc-lines { display: flex; flex-direction: column; gap: 3px; }
  .sc-line { display: flex; justify-content: space-between; font-size: 12px; }
  .sc-line b { font-variant-numeric: tabular-nums; } .sc-line b.neg { color: #b56a15; }
  .sc-line.sub { font-size: 10.5px; color: var(--muted); padding-left: 8px; }
  .sc-conf-bar { height: 5px; border-radius: 3px; background: rgba(0,0,0,.06); overflow: hidden; }
  .sc-conf-fill { height: 100%; background: #2f8f5b; border-radius: 3px; }
  .sc-conf-text { font-size: 10px; color: var(--muted); }

  .fine { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; color: var(--muted); line-height: 1.5; margin: 4px 0 0; }
  .fine > svg { flex-shrink: 0; margin-top: 1px; } .fine b { color: var(--ink); }
`;