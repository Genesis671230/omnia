// "use client";

// /* Ad platform performance — campaign spend/conversions pulled from Meta,
//    Google Ads, TikTok, and Snapchat (see lib/ad-sync.ts), shown per store next
//    to actual store revenue for the same window.

//    Two ROAS figures are shown side by side and never averaged into one:
//    pixel ROAS is Meta's self-reported attribution, settled ROAS is money that
//    actually reached the store. The gap between them is the signal — this
//    connector was overcounting conversions 8x and would have reported 28.55x
//    against a real 4.76x (founder-approved reversal of the 2026-07-15 spec's
//    "never compute a true ROAS" rule; see
//    docs/superpowers/specs/2026-07-17-meta-ads-correctness-design.md). */

// import { CheckCircle2, Loader2, Megaphone, MousePointerClick, RefreshCcw, ShoppingCart, XCircle } from "lucide-react";
// import { useCallback, useEffect, useState } from "react";
// import { toast } from "sonner";

// const STORES = ["ALL", "WOO", "KSA", "UAE"];

// const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok", snap: "Snapchat" };
// const PLATFORM_COLOR: Record<string, string> = { meta: "#1877F2", google: "#4285F4", tiktok: "#25F4EE", snap: "#FFFC00" };

// type StoreSummary = {
//   store: string;
//   spend_aed: number;
//   impressions: number;
//   clicks: number;
//   conversions: number;
//   conversion_value_aed: number;
//   store_revenue_aed: number;
//   order_count: number;
//   funnel: {
//     landing_page_views: number;
//     view_content: number;
//     add_to_cart: number;
//     initiate_checkout: number;
//     purchase: number;
//   };
//   cost_per_purchase_aed: number | null;
//   pixel_roas: number | null;
//   settled_roas: number | null;
// };

// type CampaignRow = {
//   campaign_id: string;
//   platform: string;
//   store_id: string;
//   campaign_name: string;
//   campaign_status: string;
//   spend: number;
//   impressions: number;
//   clicks: number;
//   conversions: number;
//   conversion_value: number;
// };

// type Summary = { window: { days: number; from: string; to: string; store: string }; stores: StoreSummary[]; campaigns: CampaignRow[] };

// type MetaToken = { label: string; type: string; valid: boolean; expiresAt: string | null; daysLeft: number | null };

// type SyncStatus = {
//   meta: boolean;
//   google: boolean;
//   tiktok: boolean;
//   snap: boolean;
//   metaTokens?: MetaToken[];
//   lastRun: {
//     trigger: string;
//     finished_at: string | null;
//     platform_results: { platform: string; fetched: number; saved: number; error?: string }[];
//   } | null;
// };

// const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
// const num = (v: number) => new Intl.NumberFormat("en-US").format(v);

// const timeAgo = (iso: string) => {
//   const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
//   if (mins < 1) return "just now";
//   if (mins < 60) return `${mins}m ago`;
//   const hrs = Math.round(mins / 60);
//   if (hrs < 24) return `${hrs}h ago`;
//   return `${Math.round(hrs / 24)}d ago`;
// };

// function AdSyncBadge() {
//   const [status, setStatus] = useState<SyncStatus | null>(null);
//   const [syncing, setSyncing] = useState(false);

//   const load = useCallback(() => {
//     fetch("/api/integrations/ads").then((r) => r.json()).then(setStatus).catch(() => {});
//   }, []);

//   useEffect(() => {
//     load();
//     const id = setInterval(load, 60_000);
//     return () => clearInterval(id);
//   }, [load]);

//   const syncNow = async () => {
//     setSyncing(true);
//     try {
//       const res = await fetch("/api/integrations/ads", { method: "POST", body: JSON.stringify({ days: 2 }) });
//       const json = await res.json();
//       for (const r of json.results ?? []) {
//         if (r.error) toast.error(`${PLATFORM_LABEL[r.platform] ?? r.platform}: ${r.error}`);
//         else toast.success(`${PLATFORM_LABEL[r.platform] ?? r.platform}: ${r.saved} campaign-day(s) synced`);
//       }
//       load();
//     } catch (e) {
//       toast.error((e as Error).message);
//     } finally {
//       setSyncing(false);
//     }
//   };

//   if (!status) return null;
//   const run = status.lastRun;
//   const byPlatform = new Map((run?.platform_results ?? []).map((r) => [r.platform, r]));

//   const chip = (platform: string, configured: boolean) => {
//     const r = byPlatform.get(platform);
//     const ok = configured && r && !r.error;
//     const failed = configured && r?.error;
//     return (
//       <span key={platform} className="sync-chip" title={r?.error || (r ? `${r.saved} campaign-day(s) saved` : undefined)}>
//         {ok ? <CheckCircle2 size={12} className="ok" /> : failed ? <XCircle size={12} className="bad" /> : null}
//         {PLATFORM_LABEL[platform] ?? platform}
//         {!configured && " · not connected"}
//         {failed && " · API error"}
//       </span>
//     );
//   };

//   // A Meta USER token expires on a fixed date and the sync just starts
//   // returning nothing — the KSA token's predecessor lapsed unnoticed and cost
//   // three weeks of data. Warn from 30 days out. SYSTEM_USER tokens never
//   // expire and never surface here.
//   const tokenWarnings = (status.metaTokens ?? []).filter((t) => !t.valid || (t.daysLeft !== null && t.daysLeft <= 30));

//   return (
//     <>
//       <div className="sync-badge">
//         <RefreshCcw size={12} />
//         <span>Ad sync {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
//         {chip("meta", status.meta)}
//         {chip("google", status.google)}
//         {chip("tiktok", status.tiktok)}
//         {chip("snap", status.snap)}
//         <button className="btn small" disabled={syncing} onClick={syncNow} style={{ marginLeft: "auto" }}>
//           {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />} Sync now
//         </button>
//       </div>
//       {tokenWarnings.map((t) => (
//         <div key={t.label} className="token-warn">
//           <XCircle size={12} />
//           <span>
//             Meta <b>{t.label.toUpperCase()}</b> token{" "}
//             {!t.valid
//               ? "is invalid — campaign data for this account has stopped."
//               : `expires in ${t.daysLeft} day${t.daysLeft === 1 ? "" : "s"}. It's a ${t.type} token; a SYSTEM_USER token never expires.`}
//           </span>
//         </div>
//       ))}
//     </>
//   );
// }

// // The purchase funnel, with the drop-off between each stage. A stage that
// // loses 90%+ of the previous one is flagged — on live data view_content ->
// // add_to_cart drops 92%, which is where the AED 280/purchase is really going.
// function FunnelStrip({ s }: { s: StoreSummary }) {
//   const f = s.funnel;
//   const stages = [
//     { label: "Landing", value: f.landing_page_views },
//     { label: "Viewed", value: f.view_content },
//     { label: "Add to cart", value: f.add_to_cart },
//     { label: "Checkout", value: f.initiate_checkout },
//     { label: "Purchase", value: f.purchase },
//   ];
//   if (stages.every((st) => st.value === 0)) return null;

//   return (
//     <div className="funnel">
//       <div className="funnel-stages">
//         {stages.map((stage, idx) => {
//           const prev = idx > 0 ? stages[idx - 1].value : null;
//           const drop = prev && prev > 0 ? 1 - stage.value / prev : null;
//           return (
//             <div key={stage.label} className="funnel-stage">
//               <span className="funnel-label">{stage.label}</span>
//               <b className="mono">{num(stage.value)}</b>
//               {drop !== null && drop > 0 && (
//                 <span className={drop >= 0.9 ? "funnel-drop bad" : "funnel-drop"}>−{(drop * 100).toFixed(0)}%</span>
//               )}
//             </div>
//           );
//         })}
//       </div>
//       <div className="funnel-roas">
//         <span>Cost / purchase <b className="mono">{s.cost_per_purchase_aed !== null ? aed(s.cost_per_purchase_aed) : "—"}</b></span>
//         <span>ROAS (Meta pixel) <b className="mono">{s.pixel_roas !== null ? `${s.pixel_roas.toFixed(2)}x` : "—"}</b></span>
//         <span>ROAS (settled revenue) <b className="mono">{s.settled_roas !== null ? `${s.settled_roas.toFixed(2)}x` : "—"}</b></span>
//       </div>
//     </div>
//   );
// }

// export function MarketingPanel() {
//   const [store, setStore] = useState("ALL");
//   const [days, setDays] = useState(30);
//   const [data, setData] = useState<Summary | null>(null);
//   const [loading, setLoading] = useState(true);

//   const load = useCallback(async () => {
//     setLoading(true);
//     try {
//       const res = await fetch(`/api/ads/summary?days=${days}&store=${store}`);
//       const json: Summary = await res.json();
//       setData(json);
//     } catch (e) {
//       toast.error(`Marketing data load failed: ${(e as Error).message}`);
//     } finally {
//       setLoading(false);
//     }
//   }, [days, store]);

//   useEffect(() => { load(); }, [load]);

//   return (
//     <div className="marketing">
//       <style>{MARKETING_CSS}</style>

//       <AdSyncBadge />

//       <div className="store-tabs">
//         {STORES.map((s) => (
//           <button key={s} className={s === store ? "storetab on" : "storetab"} onClick={() => setStore(s)}>{s}</button>
//         ))}
//         <select className="days-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
//           <option value={7}>Last 7 days</option>
//           <option value={30}>Last 30 days</option>
//           <option value={90}>Last 90 days</option>
//         </select>
//       </div>

//       {loading && !data ? (
//         <div className="empty"><Loader2 size={18} className="spin" /> Loading campaign performance…</div>
//       ) : !data || data.stores.every((s) => s.spend_aed === 0 && s.store_revenue_aed === 0) ? (
//         <div className="empty">
//           No ad or order data for this window yet. Connect a platform (Meta/Google/TikTok/Snap) in .env, then
//           use "Sync now" above, or check back after orders start coming in.
//         </div>
//       ) : (
//         <>
//           <div className="store-grid">
//             {data.stores.map((s) => (
//               <div key={s.store} className="store-card">
//                 <h3>{s.store}</h3>
//                 <div className="metric-row">
//                   <span className="metric-label"><Megaphone size={12} /> Ad spend</span>
//                   <b>{aed(s.spend_aed)}</b>
//                 </div>
//                 <div className="metric-row">
//                   <span className="metric-label"><MousePointerClick size={12} /> Clicks</span>
//                   <b>{num(s.clicks)}</b>
//                 </div>
//                 <div className="metric-row">
//                   <span className="metric-label">Platform-reported conversions</span>
//                   <b>{num(s.conversions)} · {aed(s.conversion_value_aed)}</b>
//                 </div>
//                 <div className="metric-row revenue">
//                   <span className="metric-label"><ShoppingCart size={12} /> Actual store revenue</span>
//                   <b>{aed(s.store_revenue_aed)} · {s.order_count} orders</b>
//                 </div>
//                 <FunnelStrip s={s} />
//               </div>
//             ))}
//           </div>

//           <section className="panel">
//             <header><h2>Campaigns</h2><span>{data.campaigns.length} campaign{data.campaigns.length === 1 ? "" : "s"}</span></header>
//             {data.campaigns.length === 0 ? (
//               <p className="quiet">No campaign data for this window.</p>
//             ) : (
//               <div className="table-wrap">
//                 <table>
//                   <thead>
//                     <tr>
//                       <th>Campaign</th><th>Store</th>
//                       <th style={{ textAlign: "right" }}>Spend</th>
//                       <th style={{ textAlign: "right" }}>Impressions</th>
//                       <th style={{ textAlign: "right" }}>Clicks</th>
//                       <th style={{ textAlign: "right" }}>Conversions</th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {data.campaigns.map((c) => (
//                       <tr key={c.campaign_id}>
//                         <td>
//                           <span className="platform-badge" style={{ borderColor: PLATFORM_COLOR[c.platform] }}>
//                             <i style={{ background: PLATFORM_COLOR[c.platform] }} />{PLATFORM_LABEL[c.platform] ?? c.platform}
//                           </span>
//                           <span className="campaign-name">{c.campaign_name}</span>
//                         </td>
//                         <td><span className="store-badge">{c.store_id}</span></td>
//                         <td className="mono" style={{ textAlign: "right" }}>{aed(c.spend)}</td>
//                         <td className="mono" style={{ textAlign: "right" }}>{num(c.impressions)}</td>
//                         <td className="mono" style={{ textAlign: "right" }}>{num(c.clicks)}</td>
//                         <td className="mono" style={{ textAlign: "right" }}>{num(c.conversions)} · {aed(c.conversion_value)}</td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             )}
//           </section>
//         </>
//       )}
//     </div>
//   );
// }

// const MARKETING_CSS = `
//   .marketing { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
//   .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
//   .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
//   .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
//   .sync-chip .ok { color: #1baf7a; }
//   .sync-chip .bad { color: #d9534f; }
//   .token-warn { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #8a6d00; padding: 8px 12px; border: 1px solid #e8c37a; border-radius: 10px; background: #fdf6e6; }
//   .token-warn > svg { color: #c99700; flex-shrink: 0; }
//   .token-warn b { color: var(--ink); }
//   .store-tabs { display: flex; gap: 8px; align-items: center; }
//   .storetab { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--muted); }
//   .storetab.on { border-color: var(--gold); background: var(--gold-wash); color: var(--gold-deep); }
//   .days-select { margin-left: auto; border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; color: var(--ink); }
//   .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }
//   .store-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
//   .store-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 8px; }
//   .store-card h3 { margin: 0 0 4px; font-size: 14px; letter-spacing: .04em; }
//   .metric-row { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; }
//   .metric-label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
//   .metric-row b { font-size: 13px; }
//   .metric-row.revenue { border-top: 1px dashed var(--line); padding-top: 8px; margin-top: 2px; }
//   .funnel { border-top: 1px dashed var(--line); padding-top: 10px; margin-top: 2px; display: flex; flex-direction: column; gap: 8px; }
//   .funnel-stages { display: flex; flex-wrap: wrap; gap: 10px 14px; }
//   .funnel-stage { display: flex; flex-direction: column; gap: 1px; min-width: 60px; }
//   .funnel-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
//   .funnel-stage b { font-size: 12.5px; }
//   .funnel-drop { font-size: 9.5px; color: var(--muted); }
//   .funnel-drop.bad { color: #c26a00; font-weight: 600; }
//   .funnel-roas { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--muted); }
//   .funnel-roas b { color: var(--ink); font-size: 12px; margin-left: 3px; }
//   .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
//   .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
//   .panel header h2 { font-size: 16px; margin: 0; }
//   .panel header span { font-size: 12.5px; color: var(--muted); }
//   .table-wrap { overflow-x: auto; }
//   table { width: 100%; border-collapse: collapse; font-size: 13px; }
//   th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
//   td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
//   .mono { font-variant-numeric: tabular-nums; }
//   .platform-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 8px; margin-right: 8px; }
//   .platform-badge i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
//   .campaign-name { font-size: 12.5px; }
//   .store-badge { font-size: 11px; font-weight: 600; background: var(--gold-wash); color: var(--gold-deep); border-radius: 6px; padding: 2px 7px; }
//   .quiet { color: var(--muted); font-size: 13px; }
// `;



"use client";

/* Ad platform performance — campaign spend/conversions from Meta, Google,
   TikTok, Snapchat next to actual store revenue for the same window.

   Leads with per-PLATFORM spend efficiency (where the money goes and how hard
   it works), then per-store cards where the pixel-vs-settled ROAS gap is made
   deliberately loud, then a sortable/filterable campaign table.

   Two ROAS figures are shown side by side and NEVER averaged:
     pixel_roas   — platform self-reported attribution (was overcounting 8x)
     settled_roas — money that actually reached the store
   Per platform, only pixel ROAS exists: store revenue can't be attributed to a
   platform (no click-to-order link), so settled ROAS stays store-level. That
   omission is intentional, not a gap to fill. */

import {
  CheckCircle2, Loader2, Megaphone, MousePointerClick, RefreshCcw, ShoppingCart, XCircle,
  Search, ArrowUpDown, ArrowUp, ArrowDown, TrendingDown, AlertTriangle, Layers,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CampaignDrawer, CampaignScatter } from "./CampaignDrawer";

const STORES = ["ALL", "WOO", "KSA", "UAE"];
const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok", snap: "Snapchat" };
const PLATFORM_COLOR: Record<string, string> = { meta: "#1877F2", google: "#4285F4", tiktok: "#00C4C4", snap: "#E4C000" };

/* ── payload shapes ─────────────────────────────────────────────────────── */
type PlatformSummary = {
  platform: string; spend_aed: number; spend_share: number; impressions: number; clicks: number;
  conversions: number; conversion_value_aed: number; campaign_count: number;
  ctr: number | null; cost_per_click_aed: number | null; cost_per_conversion_aed: number | null; pixel_roas: number | null;
};
type StoreSummary = {
  store: string; spend_aed: number; impressions: number; clicks: number; conversions: number;
  conversion_value_aed: number; store_revenue_aed: number; order_count: number;
  funnel: { landing_page_views: number; view_content: number; add_to_cart: number; initiate_checkout: number; purchase: number };
  cost_per_purchase_aed: number | null; pixel_roas: number | null; settled_roas: number | null;
};
type CampaignRow = {
  campaign_id: string; platform: string; store_id: string; campaign_name: string; campaign_status: string;
  spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number;
  pixel_roas: number | null; cost_per_conversion: number | null;
};
type Summary = { window: { days: number; from: string; to: string; store: string }; platforms: PlatformSummary[]; stores: StoreSummary[]; campaigns: CampaignRow[] };

type MetaToken = { label: string; type: string; valid: boolean; expiresAt: string | null; daysLeft: number | null };
type SyncStatus = {
  meta: boolean; google: boolean; tiktok: boolean; snap: boolean; metaTokens?: MetaToken[];
  lastRun: { trigger: string; finished_at: string | null; platform_results: { platform: string; fetched: number; saved: number; error?: string }[] } | null;
};

/* ── formatters ─────────────────────────────────────────────────────────── */
const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v || 0);
const aed2 = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat("en-US").format(v || 0);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const roas = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}x`);

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

/* ── sync badge (unchanged behavior) ────────────────────────────────────── */
function AdSyncBadge() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(() => { fetch("/api/integrations/ads").then((r) => r.json()).then(setStatus).catch(() => {}); }, []);
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/ads", { method: "POST", body: JSON.stringify({ days: 2 }) });
      const json = await res.json();
      for (const r of json.results ?? []) r.error
        ? toast.error(`${PLATFORM_LABEL[r.platform] ?? r.platform}: ${r.error}`)
        : toast.success(`${PLATFORM_LABEL[r.platform] ?? r.platform}: ${r.saved} campaign-day(s) synced`);
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setSyncing(false); }
  };

  if (!status) return null;
  const run = status.lastRun;
  const byPlatform = new Map((run?.platform_results ?? []).map((r) => [r.platform, r]));
  const chip = (platform: string, configured: boolean) => {
    const r = byPlatform.get(platform);
    const ok = configured && r && !r.error, failed = configured && r?.error;
    return (
      <span key={platform} className="sync-chip" title={r?.error || (r ? `${r.saved} campaign-day(s) saved` : undefined)}>
        {ok ? <CheckCircle2 size={12} className="ok" /> : failed ? <XCircle size={12} className="bad" /> : null}
        {PLATFORM_LABEL[platform] ?? platform}{!configured && " · not connected"}{failed && " · API error"}
      </span>
    );
  };
  const tokenWarnings = (status.metaTokens ?? []).filter((t) => !t.valid || (t.daysLeft !== null && t.daysLeft <= 30));

  return (
    <>
      <div className="sync-badge">
        <RefreshCcw size={12} />
        <span>Ad sync {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
        {chip("meta", status.meta)}{chip("google", status.google)}{chip("tiktok", status.tiktok)}{chip("snap", status.snap)}
        <button className="btn small" disabled={syncing} onClick={syncNow} style={{ marginLeft: "auto" }}>
          {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />} Sync now
        </button>
      </div>
      {tokenWarnings.map((t) => (
        <div key={t.label} className="token-warn">
          <XCircle size={12} />
          <span>Meta <b>{t.label.toUpperCase()}</b> token{" "}
            {!t.valid ? "is invalid — campaign data for this account has stopped."
              : `expires in ${t.daysLeft} day${t.daysLeft === 1 ? "" : "s"}. It's a ${t.type} token; a SYSTEM_USER token never expires.`}
          </span>
        </div>
      ))}
    </>
  );
}

/* ── LEAD: per-platform spend efficiency ────────────────────────────────── */
function PlatformEfficiency({ platforms }: { platforms: PlatformSummary[] }) {
  if (platforms.length === 0) return null;
  const totalSpend = platforms.reduce((s, p) => s + p.spend_aed, 0);

  return (
    <section className="panel lead">
      <header>
        <h2><Layers size={15} /> Spend efficiency by platform</h2>
        <span>Where the budget goes and how hard each dirham works · {aed(totalSpend)} total</span>
      </header>

      {/* spend-share bar — instant "where the money is" */}
      <div className="share-bar">
        {platforms.map((p) => p.spend_share > 0 && (
          <div key={p.platform} className="share-seg" style={{ width: `${p.spend_share * 100}%`, background: PLATFORM_COLOR[p.platform] ?? "#999" }}
            title={`${PLATFORM_LABEL[p.platform] ?? p.platform}: ${aed(p.spend_aed)} (${(p.spend_share * 100).toFixed(0)}%)`} />
        ))}
      </div>
      <div className="share-legend">
        {platforms.map((p) => (
          <span key={p.platform} className="sl"><i style={{ background: PLATFORM_COLOR[p.platform] ?? "#999" }} />
            {PLATFORM_LABEL[p.platform] ?? p.platform} <b>{(p.spend_share * 100).toFixed(0)}%</b></span>
        ))}
      </div>

      <div className="plat-grid">
        {platforms.map((p) => {
          // efficiency read: high cost-per-conversion relative to peers = waste.
          const cpc = p.cost_per_conversion_aed;
          const worst = Math.max(...platforms.map((x) => x.cost_per_conversion_aed ?? 0));
          const isWorst = cpc !== null && cpc === worst && platforms.length > 1 && worst > 0;
          return (
            <div key={p.platform} className={`plat-card ${isWorst ? "flag" : ""}`}>
              <div className="plat-head">
                <span className="plat-name"><i style={{ background: PLATFORM_COLOR[p.platform] ?? "#999" }} />{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                <span className="plat-spend">{aed(p.spend_aed)}</span>
              </div>
              <div className="plat-metrics">
                <div><span>Cost / conversion</span><b className={isWorst ? "warn" : ""}>{p.cost_per_conversion_aed !== null ? aed2(p.cost_per_conversion_aed) : "—"}{isWorst && <AlertTriangle size={11} />}</b></div>
                <div><span>Cost / click</span><b>{p.cost_per_click_aed !== null ? aed2(p.cost_per_click_aed) : "—"}</b></div>
                <div><span>CTR</span><b>{pct(p.ctr)}</b></div>
                <div><span>ROAS <em className="tiny">(pixel)</em></span><b>{roas(p.pixel_roas)}</b></div>
              </div>
              <div className="plat-foot">{num(p.clicks)} clicks · {num(Math.round(p.conversions))} conv · {p.campaign_count} campaigns</div>
            </div>
          );
        })}
      </div>
      <p className="fine">Per-platform ROAS is <b>pixel only</b> — platform self-reported. Settled ROAS (real revenue) can't be split by platform because orders carry no click attribution; see the store cards below for settled figures.</p>
    </section>
  );
}

/* ── ROAS gap bar — makes pixel-vs-settled overcounting loud ─────────────── */
function RoasGap({ s }: { s: StoreSummary }) {
  const pixel = s.pixel_roas, settled = s.settled_roas;
  if (pixel === null || settled === null) {
    return (
      <div className="roas-gap">
        <div className="rg-row"><span>ROAS (pixel)</span><b>{roas(pixel)}</b></div>
        <div className="rg-row"><span>ROAS (settled)</span><b>{roas(settled)}</b></div>
      </div>
    );
  }
  const max = Math.max(pixel, settled, 0.01);
  const overstate = settled > 0 ? pixel / settled : null;
  const inflated = overstate !== null && overstate >= 1.5;
  return (
    <div className="roas-gap">
      <div className="rg-track">
        <div className="rg-bar pixel" style={{ width: `${(pixel / max) * 100}%` }}>
          <span className="rg-label">pixel {roas(pixel)}</span>
        </div>
        <div className="rg-bar settled" style={{ width: `${(settled / max) * 100}%` }}>
          <span className="rg-label">settled {roas(settled)}</span>
        </div>
      </div>
      {inflated && (
        <div className="rg-flag"><AlertTriangle size={11} /> Pixel overstates by {overstate!.toFixed(1)}× — trust the settled figure</div>
      )}
    </div>
  );
}

function FunnelStrip({ s }: { s: StoreSummary }) {
  const f = s.funnel;
  const stages = [
    { label: "Landing", value: f.landing_page_views }, { label: "Viewed", value: f.view_content },
    { label: "Add to cart", value: f.add_to_cart }, { label: "Checkout", value: f.initiate_checkout },
    { label: "Purchase", value: f.purchase },
  ];
  if (stages.every((st) => st.value === 0)) return null;
  return (
    <div className="funnel">
      <div className="funnel-stages">
        {stages.map((stage, idx) => {
          const prev = idx > 0 ? stages[idx - 1].value : null;
          const drop = prev && prev > 0 ? 1 - stage.value / prev : null;
          return (
            <div key={stage.label} className="funnel-stage">
              <span className="funnel-label">{stage.label}</span>
              <b className="mono">{num(stage.value)}</b>
              {drop !== null && drop > 0 && <span className={drop >= 0.9 ? "funnel-drop bad" : "funnel-drop"}>−{(drop * 100).toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── feature-rich campaign table ────────────────────────────────────────── */
type CSortKey = "campaign_name" | "spend" | "impressions" | "clicks" | "conversions" | "pixel_roas" | "cost_per_conversion";
function CampaignTable({ campaigns,onOpen }: { campaigns: CampaignRow[],onOpen:any }) {
  const [q, setQ] = useState("");
  const [plat, setPlat] = useState<"all" | string>("all");
  const [sortKey, setSortKey] = useState<CSortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const platformsPresent = useMemo(() => [...new Set(campaigns.map((c) => c.platform))], [campaigns]);

  const rows = useMemo(() => {
    let list = campaigns;
    if (plat !== "all") list = list.filter((c) => c.platform === plat);
    if (q) { const s = q.toLowerCase(); list = list.filter((c) => c.campaign_name.toLowerCase().includes(s)); }
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [campaigns, q, plat, sortKey, sortDir]);

  const toggle = (k: CSortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "campaign_name" ? "asc" : "desc"); }
  };
  const SI = ({ k }: { k: CSortKey }) => sortKey === k ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={10} className="faint" />;

  return (
    <section className="panel">
      <header>
        <h2>Campaigns</h2>
        <span>{rows.length} of {campaigns.length}</span>
      </header>
      <div className="camp-toolbar">
        <div className="search-wrap">
          <Search size={14} />
          <input className="search" placeholder="Search campaign…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="clear" onClick={() => setQ("")}><XCircle size={13} /></button>}
        </div>
        <div className="seg">
          <button className={plat === "all" ? "on" : ""} onClick={() => setPlat("all")}>All</button>
          {platformsPresent.map((p) => (
            <button key={p} className={plat === p ? "on" : ""} onClick={() => setPlat(p)}>{PLATFORM_LABEL[p] ?? p}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="quiet">No campaigns match.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggle("campaign_name")}><span className="th">Campaign <SI k="campaign_name" /></span></th>
                <th>Store</th>
                <th className="sortable num" onClick={() => toggle("spend")}><span className="th end">Spend <SI k="spend" /></span></th>
                <th className="sortable num" onClick={() => toggle("impressions")}><span className="th end">Impr. <SI k="impressions" /></span></th>
                <th className="sortable num" onClick={() => toggle("clicks")}><span className="th end">Clicks <SI k="clicks" /></span></th>
                <th className="sortable num" onClick={() => toggle("conversions")}><span className="th end">Conv. <SI k="conversions" /></span></th>
                <th className="sortable num" onClick={() => toggle("cost_per_conversion")}><span className="th end">Cost/conv <SI k="cost_per_conversion" /></span></th>
                <th className="sortable num" onClick={() => toggle("pixel_roas")}><span className="th end">ROAS <em className="tiny">px</em> <SI k="pixel_roas" /></span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
               <tr key={c.campaign_id} className="camp-row"
               onClick={() => onOpen(c.campaign_id)}>
                  <td>
                    <span className="platform-badge" style={{ borderColor: PLATFORM_COLOR[c.platform] }}>
                      <i style={{ background: PLATFORM_COLOR[c.platform] }} />{PLATFORM_LABEL[c.platform] ?? c.platform}
                    </span>
                    <span className="campaign-name">{c.campaign_name}</span>
                  </td>
                  <td><span className="store-badge">{c.store_id}</span></td>
                  <td className="num mono">{aed(c.spend)}</td>
                  <td className="num mono">{num(c.impressions)}</td>
                  <td className="num mono">{num(c.clicks)}</td>
                  <td className="num mono">{num(Math.round(c.conversions))} · {aed(c.conversion_value)}</td>
                  <td className="num mono">{c.cost_per_conversion !== null ? aed2(c.cost_per_conversion) : "—"}</td>
                  <td className="num mono">{roas(c.pixel_roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ── panel ──────────────────────────────────────────────────────────────── */
export function MarketingPanel() {
  const [store, setStore] = useState("ALL");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);

console.log(openCampaign,"we got all ")
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ads/summary?days=${days}&store=${store}`);
      setData(await res.json());
    } catch (e) { toast.error(`Marketing data load failed: ${(e as Error).message}`); } finally { setLoading(false); }
  }, [days, store]);
  useEffect(() => { load(); }, [load]);

  const empty = !data || (data.stores.every((s) => s.spend_aed === 0 && s.store_revenue_aed === 0));

  return (
    <div className="marketing">
      <style>{MARKETING_CSS}</style>
      <AdSyncBadge />

      <div className="store-tabs">
        {STORES.map((s) => <button key={s} className={s === store ? "storetab on" : "storetab"} onClick={() => setStore(s)}>{s}</button>)}
        <select className="days-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      </div>

      {loading && !data ? (
        <div className="empty"><Loader2 size={18} className="spin" /> Loading campaign performance…</div>
      ) : empty ? (
        <div className="empty">No ad or order data for this window yet. Connect a platform (Meta/Google/TikTok/Snap) in .env, then use "Sync now" above, or check back after orders start coming in.</div>
      ) : (
        <>
          <PlatformEfficiency platforms={data!.platforms ?? []} />
          <CampaignScatter campaigns={data!.campaigns} />
          <div className="store-grid">
            {data!.stores.map((s) => (
              <div key={s.store} className="store-card">
                <h3>{s.store}</h3>
                <div className="metric-row"><span className="metric-label"><Megaphone size={12} /> Ad spend</span><b>{aed(s.spend_aed)}</b></div>
                <div className="metric-row"><span className="metric-label"><MousePointerClick size={12} /> Clicks</span><b>{num(s.clicks)}</b></div>
                <div className="metric-row"><span className="metric-label">Platform-reported conv.</span><b>{num(Math.round(s.conversions))} · {aed(s.conversion_value_aed)}</b></div>
                <div className="metric-row revenue"><span className="metric-label"><ShoppingCart size={12} /> Actual store revenue</span><b>{aed(s.store_revenue_aed)} · {s.order_count} orders</b></div>
                <RoasGap s={s} />
                <div className="cpp">Cost / purchase <b className="mono">{s.cost_per_purchase_aed !== null ? aed(s.cost_per_purchase_aed) : "—"}</b></div>
                <FunnelStrip s={s} />
              </div>
            ))}
          </div>

          <CampaignTable campaigns={data!.campaigns} onOpen={setOpenCampaign} />
        </>
      )}
      {openCampaign && (
  <CampaignDrawer
    campaignId={openCampaign}
    days={days}
    onClose={() => setOpenCampaign(null)}
  />
)}
    </div>
  );
}

const MARKETING_CSS = `
  .marketing { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
  .marketing * { box-sizing: border-box; }
  .mono { font-variant-numeric: tabular-nums; } .num { text-align: right; } .faint { opacity: .35; }
  .tiny { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; font-style: normal; }
  .spin { animation: mkspin 1s linear infinite; } @keyframes mkspin { to { transform: rotate(360deg); } }

  .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
  .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
  .sync-chip .ok { color: #1baf7a; } .sync-chip .bad { color: #d9534f; }
  .token-warn { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #8a6d00; padding: 8px 12px; border: 1px solid #e8c37a; border-radius: 10px; background: #fdf6e6; }
  .token-warn > svg { color: #c99700; flex-shrink: 0; } .token-warn b { color: var(--ink); }

  .store-tabs { display: flex; gap: 8px; align-items: center; }
  .storetab { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--muted); }
  .storetab.on { border-color: var(--gold); background: var(--gold-wash); color: var(--gold-deep); }
  .days-select { margin-left: auto; border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; color: var(--ink); }
  .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }

  .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
  .panel.lead { background: linear-gradient(180deg, var(--gold-wash, #f7f0e0) 0%, var(--card) 60%); }
  .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; flex-wrap: wrap; gap: 4px; }
  .panel header h2 { font-size: 16px; margin: 0; display: inline-flex; align-items: center; gap: 7px; }
  .panel header span { font-size: 12.5px; color: var(--muted); }

  .share-bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--line); margin-bottom: 8px; }
  .share-seg { height: 100%; }
  .share-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: var(--muted); margin-bottom: 16px; }
  .sl { display: inline-flex; align-items: center; gap: 5px; } .sl i { width: 9px; height: 9px; border-radius: 3px; } .sl b { color: var(--ink); }

  .plat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
  .plat-card { border: 1px solid var(--line); border-radius: 11px; padding: 13px 14px; background: var(--card); display: flex; flex-direction: column; gap: 10px; }
  .plat-card.flag { border-color: #e0a24d88; }
  .plat-head { display: flex; justify-content: space-between; align-items: center; }
  .plat-name { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; }
  .plat-name i { width: 9px; height: 9px; border-radius: 50%; }
  .plat-spend { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .plat-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 12px; }
  .plat-metrics > div { display: flex; flex-direction: column; gap: 1px; }
  .plat-metrics span { font-size: 10px; color: var(--muted); }
  .plat-metrics b { font-size: 13.5px; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; gap: 4px; }
  .plat-metrics b.warn { color: #c26a00; }
  .plat-foot { font-size: 10.5px; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 8px; }
  .fine { font-size: 10.5px; color: var(--muted); margin: 14px 0 0; line-height: 1.5; } .fine b { color: var(--ink); }

  .store-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .store-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 8px; }
  .store-card h3 { margin: 0 0 4px; font-size: 14px; letter-spacing: .04em; }
  .metric-row { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; }
  .metric-label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
  .metric-row b { font-size: 13px; }
  .metric-row.revenue { border-top: 1px dashed var(--line); padding-top: 8px; margin-top: 2px; }

  .roas-gap { border-top: 1px dashed var(--line); padding-top: 10px; margin-top: 2px; display: flex; flex-direction: column; gap: 6px; }
  .rg-track { display: flex; flex-direction: column; gap: 5px; }
  .rg-bar { height: 22px; border-radius: 5px; display: flex; align-items: center; min-width: fit-content; transition: width .4s ease; }
  .rg-bar.pixel { background: repeating-linear-gradient(45deg, #c9a6a6, #c9a6a6 6px, #d4b4b4 6px, #d4b4b4 12px); }
  .rg-bar.settled { background: #4b9e7a; }
  .rg-label { font-size: 10.5px; font-weight: 700; color: #fff; padding: 0 8px; white-space: nowrap; text-shadow: 0 1px 1px rgba(0,0,0,.25); }
  .rg-bar.pixel .rg-label { color: #6b3838; text-shadow: none; }
  .rg-flag { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; color: #c26a00; }
  .rg-row { display: flex; justify-content: space-between; font-size: 12px; } .rg-row b { font-variant-numeric: tabular-nums; }
  .cpp { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--muted); } .cpp b { color: var(--ink); }

  .funnel { border-top: 1px dashed var(--line); padding-top: 10px; margin-top: 2px; }
  .funnel-stages { display: flex; flex-wrap: wrap; gap: 10px 14px; }
  .funnel-stage { display: flex; flex-direction: column; gap: 1px; min-width: 56px; }
  .funnel-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .funnel-stage b { font-size: 12.5px; }
  .funnel-drop { font-size: 9.5px; color: var(--muted); }
  .funnel-drop.bad { color: #c26a00; font-weight: 600; }

  .camp-toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .search-wrap { position: relative; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 11px; color: var(--muted); }
  .search-wrap:focus-within { border-color: var(--gold); }
  .search { border: none; background: transparent; outline: none; font-family: inherit; font-size: 13px; color: var(--ink); width: 100%; }
  .clear { border: none; background: none; color: var(--muted); cursor: pointer; display: flex; }
  .seg { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; flex-wrap: wrap; }
  .seg button { border: none; background: none; font-family: inherit; font-size: 11.5px; font-weight: 500; color: var(--muted); padding: 6px 11px; border-radius: 7px; cursor: pointer; }
  .seg button.on { background: var(--gold-wash); color: var(--gold-deep); }
  .camp-row { cursor: pointer; }
                    .camp-row:hover { background: var(--gold-wash); }
 
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th.sortable { cursor: pointer; user-select: none; } th.sortable:hover { color: var(--ink); }
  th .th { display: inline-flex; align-items: center; gap: 4px; } th .th.end { justify-content: flex-end; }
  td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tbody tr:hover { background: var(--gold-wash); }
  .platform-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; border: 1px solid var(--line-strong, var(--line)); border-radius: 999px; padding: 2px 8px; margin-right: 8px; }
  .platform-badge i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .campaign-name { font-size: 12.5px; }
  .store-badge { font-size: 11px; font-weight: 600; background: var(--gold-wash); color: var(--gold-deep); border-radius: 6px; padding: 2px 7px; }
  .quiet { color: var(--muted); font-size: 13px; }
`;