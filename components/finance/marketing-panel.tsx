"use client";

/* Ad platform performance — campaign spend/conversions pulled from Meta,
   Google Ads, TikTok, and Snapchat (see lib/ad-sync.ts), shown per store next
   to actual store revenue for the same window. Spend/conversions and store
   revenue are two distinct, honestly-labeled numbers — never blended into a
   single computed "true ROAS" (see docs/superpowers/specs/
   2026-07-15-ad-platform-connectors-design.md). */

import { CheckCircle2, Loader2, Megaphone, MousePointerClick, RefreshCcw, ShoppingCart, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const STORES = ["ALL", "WOO", "KSA", "UAE"];

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok", snap: "Snapchat" };
const PLATFORM_COLOR: Record<string, string> = { meta: "#1877F2", google: "#4285F4", tiktok: "#25F4EE", snap: "#FFFC00" };

type StoreSummary = {
  store: string;
  spend_aed: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value_aed: number;
  store_revenue_aed: number;
  order_count: number;
};

type CampaignRow = {
  campaign_id: string;
  platform: string;
  store_id: string;
  campaign_name: string;
  campaign_status: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
};

type Summary = { window: { days: number; from: string; to: string; store: string }; stores: StoreSummary[]; campaigns: CampaignRow[] };

type SyncStatus = {
  meta: boolean;
  google: boolean;
  tiktok: boolean;
  snap: boolean;
  lastRun: {
    trigger: string;
    finished_at: string | null;
    platform_results: { platform: string; fetched: number; saved: number; error?: string }[];
  } | null;
};

const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
const num = (v: number) => new Intl.NumberFormat("en-US").format(v);

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

function AdSyncBadge() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/integrations/ads").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/ads", { method: "POST", body: JSON.stringify({ days: 2 }) });
      const json = await res.json();
      for (const r of json.results ?? []) {
        if (r.error) toast.error(`${PLATFORM_LABEL[r.platform] ?? r.platform}: ${r.error}`);
        else toast.success(`${PLATFORM_LABEL[r.platform] ?? r.platform}: ${r.saved} campaign-day(s) synced`);
      }
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (!status) return null;
  const run = status.lastRun;
  const byPlatform = new Map((run?.platform_results ?? []).map((r) => [r.platform, r]));

  const chip = (platform: string, configured: boolean) => {
    const r = byPlatform.get(platform);
    const ok = configured && r && !r.error;
    const failed = configured && r?.error;
    return (
      <span key={platform} className="sync-chip" title={r?.error || (r ? `${r.saved} campaign-day(s) saved` : undefined)}>
        {ok ? <CheckCircle2 size={12} className="ok" /> : failed ? <XCircle size={12} className="bad" /> : null}
        {PLATFORM_LABEL[platform] ?? platform}
        {!configured && " · not connected"}
        {failed && " · API error"}
      </span>
    );
  };

  return (
    <div className="sync-badge">
      <RefreshCcw size={12} />
      <span>Ad sync {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
      {chip("meta", status.meta)}
      {chip("google", status.google)}
      {chip("tiktok", status.tiktok)}
      {chip("snap", status.snap)}
      <button className="btn small" disabled={syncing} onClick={syncNow} style={{ marginLeft: "auto" }}>
        {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />} Sync now
      </button>
    </div>
  );
}

export function MarketingPanel() {
  const [store, setStore] = useState("ALL");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ads/summary?days=${days}&store=${store}`);
      const json: Summary = await res.json();
      setData(json);
    } catch (e) {
      toast.error(`Marketing data load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [days, store]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="marketing">
      <style>{MARKETING_CSS}</style>

      <AdSyncBadge />

      <div className="store-tabs">
        {STORES.map((s) => (
          <button key={s} className={s === store ? "storetab on" : "storetab"} onClick={() => setStore(s)}>{s}</button>
        ))}
        <select className="days-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {loading && !data ? (
        <div className="empty"><Loader2 size={18} className="spin" /> Loading campaign performance…</div>
      ) : !data || data.stores.every((s) => s.spend_aed === 0 && s.store_revenue_aed === 0) ? (
        <div className="empty">
          No ad or order data for this window yet. Connect a platform (Meta/Google/TikTok/Snap) in .env, then
          use "Sync now" above, or check back after orders start coming in.
        </div>
      ) : (
        <>
          <div className="store-grid">
            {data.stores.map((s) => (
              <div key={s.store} className="store-card">
                <h3>{s.store}</h3>
                <div className="metric-row">
                  <span className="metric-label"><Megaphone size={12} /> Ad spend</span>
                  <b>{aed(s.spend_aed)}</b>
                </div>
                <div className="metric-row">
                  <span className="metric-label"><MousePointerClick size={12} /> Clicks</span>
                  <b>{num(s.clicks)}</b>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Platform-reported conversions</span>
                  <b>{num(s.conversions)} · {aed(s.conversion_value_aed)}</b>
                </div>
                <div className="metric-row revenue">
                  <span className="metric-label"><ShoppingCart size={12} /> Actual store revenue</span>
                  <b>{aed(s.store_revenue_aed)} · {s.order_count} orders</b>
                </div>
              </div>
            ))}
          </div>

          <section className="panel">
            <header><h2>Campaigns</h2><span>{data.campaigns.length} campaign{data.campaigns.length === 1 ? "" : "s"}</span></header>
            {data.campaigns.length === 0 ? (
              <p className="quiet">No campaign data for this window.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Campaign</th><th>Store</th>
                      <th style={{ textAlign: "right" }}>Spend</th>
                      <th style={{ textAlign: "right" }}>Impressions</th>
                      <th style={{ textAlign: "right" }}>Clicks</th>
                      <th style={{ textAlign: "right" }}>Conversions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.campaign_id}>
                        <td>
                          <span className="platform-badge" style={{ borderColor: PLATFORM_COLOR[c.platform] }}>
                            <i style={{ background: PLATFORM_COLOR[c.platform] }} />{PLATFORM_LABEL[c.platform] ?? c.platform}
                          </span>
                          <span className="campaign-name">{c.campaign_name}</span>
                        </td>
                        <td><span className="store-badge">{c.store_id}</span></td>
                        <td className="mono" style={{ textAlign: "right" }}>{aed(c.spend)}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{num(c.impressions)}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{num(c.clicks)}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{num(c.conversions)} · {aed(c.conversion_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const MARKETING_CSS = `
  .marketing { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
  .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
  .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
  .sync-chip .ok { color: #1baf7a; }
  .sync-chip .bad { color: #d9534f; }
  .store-tabs { display: flex; gap: 8px; align-items: center; }
  .storetab { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--muted); }
  .storetab.on { border-color: var(--gold); background: var(--gold-wash); color: var(--gold-deep); }
  .days-select { margin-left: auto; border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; color: var(--ink); }
  .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .store-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .store-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 8px; }
  .store-card h3 { margin: 0 0 4px; font-size: 14px; letter-spacing: .04em; }
  .metric-row { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; }
  .metric-label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
  .metric-row b { font-size: 13px; }
  .metric-row.revenue { border-top: 1px dashed var(--line); padding-top: 8px; margin-top: 2px; }
  .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
  .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
  .panel header h2 { font-size: 16px; margin: 0; }
  .panel header span { font-size: 12.5px; color: var(--muted); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
  td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .mono { font-variant-numeric: tabular-nums; }
  .platform-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 8px; margin-right: 8px; }
  .platform-badge i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .campaign-name { font-size: 12.5px; }
  .store-badge { font-size: 11px; font-weight: 600; background: var(--gold-wash); color: var(--gold-deep); border-radius: 6px; padding: 2px 7px; }
  .quiet { color: var(--muted); font-size: 13px; }
`;
