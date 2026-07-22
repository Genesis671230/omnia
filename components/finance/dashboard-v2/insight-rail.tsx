"use client";

/* AI insight rail — 3–6 cards under the hero. Facts (and every number) come
   from the deterministic rules in /api/insights; the AI only phrased the
   text. Each card drills into a drawer and can create a tracked task. */

import {
  Sparkles, AlertTriangle, TrendingDown, PauseCircle, Rocket, PackageX,
  Wallet, Clock, TrendingUp, RefreshCcw, Loader2, ClipboardPlus, ArrowRight, X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { InsightFact, InsightsPayload, MoneyDrawerKind } from "./types";
import { aed } from "./types";

const KIND_ICON: Record<string, React.ElementType> = {
  campaign_paused: PauseCircle,
  campaign_roas_drop: TrendingDown,
  campaign_scale_opportunity: Rocket,
  cod_aging: Wallet,
  awaiting_payout_spike: Clock,
  bestseller_low_stock: PackageX,
  exceptions_open: AlertTriangle,
  revenue_momentum: TrendingUp,
};

const METRIC_LABEL: Record<string, (v: number) => string> = {
  spend_aed: (v) => `Spend ${aed(v)}`,
  outstanding_aed: (v) => `${aed(v)} outstanding`,
  awaiting_aed: (v) => `${aed(v)} waiting`,
  revenue_aed: (v) => `${aed(v)} revenue`,
  previous_aed: (v) => `was ${aed(v)}`,
  pixel_roas: (v) => `ROAS ${v.toFixed(2)}x`,
  avg_roas: (v) => `avg ${v.toFixed(2)}x`,
  roas_before: (v) => `was ${v.toFixed(2)}x`,
  roas_now: (v) => `now ${v.toFixed(2)}x`,
  drop_pct: (v) => `−${v}%`,
  delta_pct: (v) => `${v > 0 ? "+" : ""}${v}%`,
  share_pct: (v) => `${v}% of credits`,
  spend_share_pct: (v) => `${v}% of budget`,
  pct_of_revenue: (v) => `${v}% of revenue`,
  order_count: (v) => `${v.toLocaleString()} orders`,
  awaiting_count: (v) => `${v} credits`,
  stock_left: (v) => `${v} left in stock`,
  sold_qty: (v) => `${v} sold`,
  conversions: (v) => `${Math.round(v)} conversions`,
  count: (v) => `${v} open`,
};

function metricChips(f: InsightFact): string[] {
  return Object.entries(f.metrics)
    .filter(([k]) => METRIC_LABEL[k])
    .slice(0, 3)
    .map(([k, v]) => METRIC_LABEL[k](v));
}

/* ── assign-task dialog (portaled — never trust ancestor stacking contexts) ── */

function AssignTaskDialog({ fact, headline, recommendation, onClose }: {
  fact: InsightFact; headline: string; recommendation: string; onClose: () => void;
}) {
  const [title, setTitle] = useState(headline);
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          detail: recommendation,
          source: "insight",
          source_ref: fact.id,
          assignee: assignee.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(assignee.trim() ? `Task assigned to ${assignee.trim()}` : "Task created");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="atd-overlay" onClick={onClose}>
      <style>{DIALOG_CSS}</style>
      <div className="atd-box" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3><ClipboardPlus size={15} /> Turn this insight into a task</h3>
          <button className="atd-x" onClick={onClose}><X size={15} /></button>
        </header>
        <label>Task
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        </label>
        <label>Assign to
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="teammate's name (optional)" maxLength={100} />
        </label>
        <p className="atd-rec">{recommendation}</p>
        <footer>
          <button className="atd-ghost" onClick={onClose}>Cancel</button>
          <button className="atd-primary" disabled={busy || !title.trim()} onClick={save}>
            {busy ? <Loader2 size={14} className="atd-spin" /> : <ClipboardPlus size={14} />} Create task
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/* ── the rail ───────────────────────────────────────────────────────────── */

export function InsightRail({ days, store, onViewCampaign, onViewMoney }: {
  days: number;
  store: string;
  onViewCampaign: (campaignId: string) => void;
  onViewMoney: (kind: MoneyDrawerKind) => void;
}) {
  const [data, setData] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskFor, setTaskFor] = useState<InsightFact | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/insights?days=${days}&store=${store}${refresh ? "&refresh=1" : ""}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch {
      setData(null); // insights are additive — a failure never blanks the page
    } finally {
      setLoading(false);
    }
  }, [days, store]);

  useEffect(() => { load(); }, [load]);

  const cardFor = (f: InsightFact) =>
    data?.cards.find((c) => c.fact_id === f.id) ?? { fact_id: f.id, ...f.template };

  const view = (f: InsightFact) => {
    if (f.entity?.type === "campaign") return onViewCampaign(f.entity.id);
    if (f.entity?.type === "product") { window.location.href = "/inventory"; return; }
    switch (f.entity?.id) {
      case "exceptions": window.location.href = "/reconciliation"; return;
      case "awaiting": return onViewMoney("awaiting");
      case "cod": return onViewMoney("cod");
      default: return onViewMoney("revenue");
    }
  };

  return (
    <section className="rail">
      <style>{RAIL_CSS}</style>
      <header className="rail-head">
        <h2><Sparkles size={15} /> What needs your attention</h2>
        <div className="rail-meta">
          {data && <span>{data.aiUsed ? "AI-written from live data" : "from live data"}</span>}
          <button className="rail-refresh" title="Re-run the insight engine" disabled={loading} onClick={() => load(true)}>
            {loading ? <Loader2 size={13} className="rail-spin" /> : <RefreshCcw size={13} />}
          </button>
        </div>
      </header>

      {loading && !data ? (
        <div className="rail-cards">
          {[0, 1, 2].map((i) => <div key={i} className="rail-card skeleton" />)}
        </div>
      ) : !data || data.facts.length === 0 ? (
        <div className="rail-empty">
          <Sparkles size={16} /> All clear — nothing needs a decision right now. Enjoy it.
        </div>
      ) : (
        <div className="rail-cards">
          {data.facts.map((f, i) => {
            const c = cardFor(f);
            const Icon = KIND_ICON[f.kind] ?? Sparkles;
            return (
              <article key={f.id} className={`rail-card sev-${f.severity}`} style={{ animationDelay: `${i * 70}ms` }}>
                <div className="rail-card-top">
                  <span className={`rail-icon sev-${f.severity}`}><Icon size={15} /></span>
                  {f.entity && <span className="rail-entity">{"platform" in f.entity ? `${f.entity.platform} · ${f.entity.store}` : f.entity.label}</span>}
                </div>
                <h3>{c.headline}</h3>
                <p>{c.why}</p>
                <div className="rail-chips">
                  {metricChips(f).map((chip) => <span key={chip}>{chip}</span>)}
                </div>
                <div className="rail-actions">
                  <button className="rail-view" onClick={() => view(f)}>View <ArrowRight size={12} /></button>
                  <button className="rail-assign" onClick={() => setTaskFor(f)}><ClipboardPlus size={12} /> Assign task</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {taskFor && (
        <AssignTaskDialog
          fact={taskFor}
          headline={cardFor(taskFor).headline}
          recommendation={cardFor(taskFor).recommendation}
          onClose={() => setTaskFor(null)}
        />
      )}
    </section>
  );
}

const RAIL_CSS = `
  .rail { display: flex; flex-direction: column; gap: 12px; }
  .rail * { box-sizing: border-box; }
  .rail-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .rail-head h2 { display: inline-flex; align-items: center; gap: 7px; font-family: Georgia, serif; font-weight: 500; font-size: 17px; margin: 0; color: #1F1B16; }
  .rail-head h2 svg { color: #7c3aed; }
  .rail-meta { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: #8A8175; }
  .rail-refresh { border: 1px solid #EAE3D6; background: #fff; border-radius: 8px; padding: 6px; cursor: pointer; color: #8A8175; display: flex; }
  .rail-refresh:hover { color: #7c3aed; border-color: #c4b5fd; }
  .rail-spin, .atd-spin { animation: railspin 1s linear infinite; }
  @keyframes railspin { to { transform: rotate(360deg); } }

  .rail-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .rail-card { position: relative; display: flex; flex-direction: column; gap: 8px; background: #fff; border: 1px solid #EAE3D6;
    border-radius: 16px; padding: 15px 16px 13px; overflow: hidden; opacity: 0; transform: translateY(8px);
    animation: railin .4s ease forwards; }
  @keyframes railin { to { opacity: 1; transform: translateY(0); } }
  .rail-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
  .rail-card.sev-critical::before { background: linear-gradient(180deg, #ef4444, #f97316); }
  .rail-card.sev-warning::before { background: linear-gradient(180deg, #f59e0b, #fbbf24); }
  .rail-card.sev-opportunity::before { background: linear-gradient(180deg, #10b981, #34d399); }
  .rail-card.sev-info::before { background: linear-gradient(180deg, #3b82f6, #60a5fa); }
  .rail-card.skeleton { min-height: 150px; animation: railpulse 1.4s ease infinite; opacity: 1; transform: none; }
  @keyframes railpulse { 0%, 100% { background: #fff; } 50% { background: #F6F1E7; } }

  .rail-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .rail-icon { display: inline-flex; padding: 7px; border-radius: 10px; }
  .rail-icon.sev-critical { background: #fee2e2; color: #dc2626; }
  .rail-icon.sev-warning { background: #fef3c7; color: #d97706; }
  .rail-icon.sev-opportunity { background: #d1fae5; color: #059669; }
  .rail-icon.sev-info { background: #dbeafe; color: #2563eb; }
  .rail-entity { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #8A8175;
    background: #F6F1E7; padding: 3px 8px; border-radius: 999px; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rail-card h3 { margin: 0; font-size: 14px; line-height: 1.35; color: #1F1B16; }
  .rail-card p { margin: 0; font-size: 12px; line-height: 1.5; color: #8A8175; flex: 1; }
  .rail-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .rail-chips span { font-size: 11px; font-weight: 600; color: #4c1d95; background: #f3e8ff; border-radius: 999px; padding: 3px 9px; font-variant-numeric: tabular-nums; }
  .rail-actions { display: flex; gap: 8px; margin-top: 4px; }
  .rail-view { display: inline-flex; align-items: center; gap: 5px; border: 0; cursor: pointer; font-size: 12px; font-weight: 600;
    color: #fff; background: linear-gradient(120deg, #7c3aed, #a855f7); border-radius: 9px; padding: 7px 13px; transition: transform .15s; }
  .rail-view:hover { transform: translateY(-1px); }
  .rail-assign { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #EAE3D6; background: #fff; cursor: pointer;
    font-size: 12px; font-weight: 600; color: #6F5325; border-radius: 9px; padding: 7px 12px; }
  .rail-assign:hover { border-color: #c4b5fd; color: #7c3aed; }

  .rail-empty { display: flex; align-items: center; gap: 9px; background: linear-gradient(120deg, #ecfdf5, #f0fdfa);
    border: 1px solid #a7f3d0; color: #047857; border-radius: 14px; padding: 16px 18px; font-size: 13.5px; font-weight: 500; }

  @media (max-width: 980px) { .rail-cards { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 620px) { .rail-cards { grid-template-columns: 1fr; } }
`;

const DIALOG_CSS = `
  .atd-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(31,27,22,.5); backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center; padding: 20px; }
  .atd-overlay * { box-sizing: border-box; }
  .atd-box { width: 100%; max-width: 460px; background: #fff; border-radius: 18px; padding: 20px 22px;
    box-shadow: 0 30px 80px rgba(0,0,0,.35); display: flex; flex-direction: column; gap: 14px;
    font-family: ui-sans-serif, system-ui, sans-serif; color: #1F1B16; }
  .atd-box header { display: flex; justify-content: space-between; align-items: center; }
  .atd-box h3 { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; }
  .atd-box h3 svg { color: #7c3aed; }
  .atd-x { border: 0; background: transparent; cursor: pointer; color: #8A8175; display: flex; padding: 4px; }
  .atd-box label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; font-weight: 600; color: #8A8175; }
  .atd-box input { border: 1px solid #EAE3D6; border-radius: 10px; padding: 10px 12px; font-size: 13.5px; color: #1F1B16; outline: none; font-family: inherit; }
  .atd-box input:focus { border-color: #a855f7; box-shadow: 0 0 0 3px rgba(168,85,247,.15); }
  .atd-rec { margin: 0; font-size: 12px; line-height: 1.55; color: #6F5325; background: #FBF3E6; border-radius: 10px; padding: 10px 12px; }
  .atd-box footer { display: flex; justify-content: flex-end; gap: 8px; }
  .atd-ghost { border: 1px solid #EAE3D6; background: #fff; border-radius: 10px; padding: 9px 15px; font-size: 13px; font-weight: 600; cursor: pointer; color: #8A8175; }
  .atd-primary { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 10px; padding: 9px 16px;
    font-size: 13px; font-weight: 600; cursor: pointer; color: #fff; background: linear-gradient(120deg, #7c3aed, #a855f7); }
  .atd-primary:disabled { opacity: .55; cursor: not-allowed; }
`;
