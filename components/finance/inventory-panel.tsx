// "use client";

// /* Cross-platform inventory comparison — Zoho's authoritative stock_on_hand
//    vs live Shopify (per store) and WooCommerce quantities, plus recent store
//    orders with no matching Zoho sales order (see lib/zoho-sync.ts,
//    lib/inventory-compare.ts). Read-only: this panel never writes to Zoho. */

// import { AlertTriangle, Boxes, CheckCircle2, Loader2, PackageX, RefreshCcw, XCircle } from "lucide-react";
// import { useCallback, useEffect, useState } from "react";
// import { toast } from "sonner";

// type StockMismatch = {
//   sku: string;
//   name: string;
//   zohoStock: number;
//   storeStock: { storeId: string; quantity: number | null }[];
//   maxDiff: number;
// };

// type MissingOrder = { uid: string; orderNumber: string; storeId: string; orderDate: string | null; grossAed: number };

// type Summary = {
//   mismatches: StockMismatch[];
//   missingOrders: MissingOrder[];
//   counts: { zohoItems: number; storeInventoryRows: number; zohoOrders: number };
// };

// type SyncStatus = {
//   zoho: boolean;
//   shopify: string[];
//   woo: boolean;
//   lastRun: {
//     trigger: string;
//     finished_at: string | null;
//     source_results: { source: string; fetched: number; saved: number; error?: string }[];
//   } | null;
// };

// const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);

// const timeAgo = (iso: string) => {
//   const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
//   if (mins < 1) return "just now";
//   if (mins < 60) return `${mins}m ago`;
//   const hrs = Math.round(mins / 60);
//   if (hrs < 24) return `${hrs}h ago`;
//   return `${Math.round(hrs / 24)}d ago`;
// };

// function ZohoSyncBadge({ onSynced }: { onSynced: () => void }) {
//   const [status, setStatus] = useState<SyncStatus | null>(null);
//   const [syncing, setSyncing] = useState(false);

//   const load = useCallback(() => {
//     fetch("/api/integrations/zoho").then((r) => r.json()).then(setStatus).catch(() => {});
//   }, []);

//   useEffect(() => {
//     load();
//     const id = setInterval(load, 60_000);
//     return () => clearInterval(id);
//   }, [load]);

//   const syncNow = async () => {
//     setSyncing(true);
//     try {
//       const res = await fetch("/api/integrations/zoho", { method: "POST" });
//       const json = await res.json();
//       for (const r of json.results ?? []) {
//         if (r.error) toast.error(`${r.source}: ${r.error}`);
//         else toast.success(`${r.source}: ${r.saved} synced`);
//       }
//       load();
//       onSynced();
//     } catch (e) {
//       toast.error((e as Error).message);
//     } finally {
//       setSyncing(false);
//     }
//   };

//   if (!status) return null;
//   const run = status.lastRun;
//   const bySource = new Map((run?.source_results ?? []).map((r) => [r.source, r]));
//   const sources = ["zoho-items", "zoho-orders", ...status.shopify.map((c) => `shopify-${c}`), ...(status.woo ? ["woo"] : [])];

//   const chip = (source: string, label: string) => {
//     const r = bySource.get(source);
//     const ok = r && !r.error;
//     const failed = r?.error;
//     return (
//       <span key={source} className="sync-chip" title={r?.error || (r ? `${r.saved} saved` : undefined)}>
//         {ok ? <CheckCircle2 size={12} className="ok" /> : failed ? <XCircle size={12} className="bad" /> : null}
//         {label}
//       </span>
//     );
//   };
// console.log(status,status.shopify);
//   return (
//     <div className="sync-badge">
//       <RefreshCcw size={12} />
//       <span>Inventory sync {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
//       {chip("zoho-items", "Zoho items")}
//       {chip("zoho-orders", "Zoho orders")}
//       {status.shopify.map((c) => chip(`shopify-${c}`, `Shopify ${c}`))}
//       {status.woo && chip("woo", "WooCommerce")}
//       {sources.length === 0 && <span className="quiet">Nothing configured yet</span>}
//       <button className="btn small" disabled={syncing} onClick={syncNow} style={{ marginLeft: "auto" }}>
//         {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />} Sync now
//       </button>
//     </div>
//   );
// }

// export function InventoryPanel() {
//   const [data, setData] = useState<Summary | null>(null);
//   const [loading, setLoading] = useState(true);

//   const load = useCallback(async () => {
//     setLoading(true);
//     try {
//       const res = await fetch("/api/inventory/summary");
//       const json: Summary = await res.json();
//       setData(json);
//     } catch (e) {
//       toast.error(`Inventory data load failed: ${(e as Error).message}`);
//     } finally {
//       setLoading(false);
//     }
//   }, []);

//   useEffect(() => { load(); }, [load]);

//   return (
//     <div className="inventory">
//       <style>{INVENTORY_CSS}</style>

//       <ZohoSyncBadge onSynced={load} />

//       {loading && !data ? (
//         <div className="empty"><Loader2 size={18} className="spin" /> Loading inventory comparison…</div>
//       ) : !data || (data.counts.zohoItems === 0 && data.counts.storeInventoryRows === 0) ? (
//         <div className="empty">
//           No inventory data synced yet. Connect Zoho and store credentials in .env, then use &quot;Sync now&quot; above.
//         </div>
//       ) : (
//         <>
//           <div className="stat-row">
//             <div className="stat-card">
//               <span className="stat-label"><Boxes size={12} /> Zoho SKUs tracked</span>
//               <b>{data.counts.zohoItems}</b>
//             </div>
//             <div className="stat-card">
//               <span className="stat-label"><Boxes size={12} /> Live store inventory rows</span>
//               <b>{data.counts.storeInventoryRows}</b>
//             </div>
//             <div className={data.mismatches.length ? "stat-card warn" : "stat-card"}>
//               <span className="stat-label"><AlertTriangle size={12} /> Stock mismatches</span>
//               <b>{data.mismatches.length}</b>
//             </div>
//             <div className={data.missingOrders.length ? "stat-card warn" : "stat-card"}>
//               <span className="stat-label"><PackageX size={12} /> Orders missing from Zoho</span>
//               <b>{data.missingOrders.length}</b>
//             </div>
//           </div>

//           <section className="panel">
//             <header><h2>Stock mismatches</h2><span>Zoho stock_on_hand vs live store quantity, by SKU</span></header>
//             {data.mismatches.length === 0 ? (
//               <p className="quiet">No mismatches — every synced SKU agrees with Zoho.</p>
//             ) : (
//               <div className="table-wrap">
//                 <table>
//                   <thead>
//                     <tr>
//                       <th>SKU</th><th>Name</th>
//                       <th style={{ textAlign: "right" }}>Zoho stock</th>
//                       <th>Store quantities</th>
//                       <th style={{ textAlign: "right" }}>Max diff</th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {data.mismatches.map((m) => (
//                       <tr key={m.sku}>
//                         <td className="mono">{m.sku}</td>
//                         <td>{m.name}</td>
//                         <td className="mono" style={{ textAlign: "right" }}>{m.zohoStock}</td>
//                         <td>
//                           {m.storeStock.map((s) => (
//                             <span key={s.storeId} className="store-badge">{s.storeId}: {s.quantity ?? "—"}</span>
//                           ))}
//                         </td>
//                         <td className="mono diff" style={{ textAlign: "right" }}>{m.maxDiff}</td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             )}
//           </section>

//           <section className="panel">
//             <header><h2>Orders missing from Zoho</h2><span>Last 30 days, no matching Zoho sales order</span></header>
//             {data.missingOrders.length === 0 ? (
//               <p className="quiet">No gaps — every recent order has a matching Zoho reference.</p>
//             ) : (
//               <div className="table-wrap">
//                 <table>
//                   <thead>
//                     <tr>
//                       <th>Order</th><th>Store</th><th>Date</th>
//                       <th style={{ textAlign: "right" }}>Gross</th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {data.missingOrders.map((o) => (
//                       <tr key={o.uid}>
//                         <td className="mono">#{o.orderNumber}</td>
//                         <td><span className="store-badge">{o.storeId}</span></td>
//                         <td>{o.orderDate ? new Date(o.orderDate).toLocaleDateString() : "—"}</td>
//                         <td className="mono" style={{ textAlign: "right" }}>{aed(o.grossAed)}</td>
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

// const INVENTORY_CSS = `
//   .inventory { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
//   .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
//   .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
//   .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
//   .sync-chip .ok { color: #1baf7a; }
//   .sync-chip .bad { color: #d9534f; }
//   .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }
//   .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
//   .stat-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 6px; }
//   .stat-card.warn { border-color: #d9534f66; }
//   .stat-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
//   .stat-card b { font-size: 20px; }
//   .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
//   .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; flex-wrap: wrap; gap: 4px; }
//   .panel header h2 { font-size: 16px; margin: 0; }
//   .panel header span { font-size: 12.5px; color: var(--muted); }
//   .table-wrap { overflow-x: auto; }
//   table { width: 100%; border-collapse: collapse; font-size: 13px; }
//   th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
//   td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
//   .mono { font-variant-numeric: tabular-nums; }
//   .diff { color: #d9534f; font-weight: 700; }
//   .store-badge { display: inline-block; font-size: 11px; font-weight: 600; background: var(--gold-wash); color: var(--gold-deep); border-radius: 6px; padding: 2px 7px; margin-right: 6px; }
//   .quiet { color: var(--muted); font-size: 13px; }
// `;




"use client";

/* Cross-platform inventory — Zoho's authoritative stock_on_hand vs live
   Shopify (per store: UAE/KSA/WA) and WooCommerce quantities.
   Alerts-first: leads with what you're about to oversell / run out of, with
   the full SKU × store matrix behind a toggle as the audit view. Read-only:
   this panel never writes to Zoho.

   Consumes the patched /api/inventory/summary:
     items[]      — every SKU with per-store quantities + a server-computed status
     storeIds[]   — column order (from sync config; never hard-coded here)
     mismatches[] / missingOrders[] — unchanged, still power their sections
     counts       — includes outOfStock / critical / oversellRisk
   Status rule lives server-side (lib/inventory-compare.ts) so it's defined once. */

import {
  AlertTriangle, Boxes, CheckCircle2, Loader2, PackageX, RefreshCcw, XCircle,
  Search, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, ListFilter, ShieldAlert, TrendingDown, Ban,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/* ── payload shapes (mirror the patched route) ──────────────────────────── */
type StoreQty = { storeId: string; quantity: number | null; listed: boolean };
type InvStatus = "oversell_risk" | "out" | "critical" | "low" | "ok";

type InventoryItem = {
  sku: string;
  name: string;
  zohoStock: number;
  stores: StoreQty[];
  totalStoreQty: number;
  maxDiff: number;
  status: InvStatus;
};

type StockMismatch = {
  sku: string; name: string; zohoStock: number;
  storeStock: { storeId: string; quantity: number | null }[]; maxDiff: number;
};
type MissingOrder = { uid: string; orderNumber: string; storeId: string; orderDate: string | null; grossAed: number };

type Summary = {
  items: InventoryItem[];
  storeIds: string[];
  mismatches: StockMismatch[];
  missingOrders: MissingOrder[];
  counts: {
    zohoItems: number; storeInventoryRows: number; zohoOrders: number;
    outOfStock: number; critical: number; oversellRisk: number;
  };
};

type SyncStatus = {
  zoho: boolean; shopify: string[]; woo: boolean;
  lastRun: {
    trigger: string; finished_at: string | null;
    source_results: { source: string; fetched: number; saved: number; error?: string }[];
  } | null;
};

/* ── formatters ─────────────────────────────────────────────────────────── */
const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v || 0);
const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const STATUS_META: Record<InvStatus, { label: string; tone: string; icon: typeof Ban; rank: number }> = {
  oversell_risk: { label: "Oversell risk", tone: "danger", icon: ShieldAlert, rank: 0 },
  out:           { label: "Out of stock", tone: "out",    icon: Ban,         rank: 1 },
  critical:      { label: "Critical",      tone: "crit",   icon: AlertTriangle, rank: 2 },
  low:           { label: "Low",           tone: "low",    icon: TrendingDown,  rank: 3 },
  ok:            { label: "In stock",      tone: "ok",     icon: CheckCircle2,  rank: 4 },
};

/* ── sync badge (unchanged behavior, tidied) ────────────────────────────── */
function ZohoSyncBadge({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/integrations/zoho").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/zoho", { method: "POST" });
      const json = await res.json();
      for (const r of json.results ?? []) r.error ? toast.error(`${r.source}: ${r.error}`) : toast.success(`${r.source}: ${r.saved} synced`);
      load(); onSynced();
    } catch (e) { toast.error((e as Error).message); } finally { setSyncing(false); }
  };

  if (!status) return null;
  const run = status.lastRun;
  const bySource = new Map((run?.source_results ?? []).map((r) => [r.source, r]));
  const chip = (source: string, label: string) => {
    const r = bySource.get(source);
    return (
      <span key={source} className="sync-chip" title={r?.error || (r ? `${r.saved} saved` : undefined)}>
        {r && !r.error ? <CheckCircle2 size={12} className="ok" /> : r?.error ? <XCircle size={12} className="bad" /> : null}
        {label}
      </span>
    );
  };

  return (
    <div className="sync-badge">
      <RefreshCcw size={12} />
      <span>Inventory sync {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
      {chip("zoho-items", "Zoho items")}
      {chip("zoho-orders", "Zoho orders")}
      {status.shopify.map((c) => chip(`shopify-${c}`, `Shopify ${c}`))}
      {status.woo && chip("woo", "WooCommerce")}
      <button className="btn small" disabled={syncing} onClick={syncNow} style={{ marginLeft: "auto" }}>
        {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />} Sync now
      </button>
    </div>
  );
}

/* ── health bar: proportion of catalog in each status ───────────────────── */
function HealthBar({ items }: { items: InventoryItem[] }) {
  const total = items.length || 1;
  const buckets = (["oversell_risk", "out", "critical", "low", "ok"] as InvStatus[]).map((s) => ({
    status: s, count: items.filter((i) => i.status === s).length,
  }));
  return (
    <div className="health">
      <div className="health-track">
        {buckets.map((b) => b.count > 0 && (
          <div key={b.status} className={`health-seg ${STATUS_META[b.status].tone}`}
            style={{ width: `${(b.count / total) * 100}%` }}
            title={`${STATUS_META[b.status].label}: ${b.count}`} />
        ))}
      </div>
      <div className="health-legend">
        {buckets.map((b) => (
          <span key={b.status} className="hl">
            <i className={`dot ${STATUS_META[b.status].tone}`} />{STATUS_META[b.status].label} <b>{b.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── the store-quantity cell: color-codes 0 and "not listed" distinctly ─── */
function QtyCell({ q, zoho }: { q: StoreQty; zoho: number }) {
  if (!q.listed) return <span className="qty na" title="Not listed on this store">·</span>;
  const n = q.quantity ?? 0;
  const oversell = zoho <= 0 && n > 0;         // selling stock Zoho says isn't there
  const cls = oversell ? "qty oversell" : n <= 0 ? "qty zero" : n <= 3 ? "qty crit" : "qty";
  return <span className={cls} title={oversell ? "Live stock on store, none in Zoho" : undefined}>{n}</span>;
}

/* ── main panel ─────────────────────────────────────────────────────────── */
export function InventoryPanel() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"alerts" | "matrix">("alerts");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvStatus>("all");
  const [sortKey, setSortKey] = useState<"status" | "sku" | "name" | "zohoStock" | "totalStoreQty" | "maxDiff">("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory/summary");
      setData(await res.json());
    } catch (e) {
      toast.error(`Inventory data load failed: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];
  const storeIds = data?.storeIds ?? [];

  const alertItems = useMemo(() => items.filter((i) => i.status !== "ok"), [items]);

  const tableItems = useMemo(() => {
    // alerts view shows only non-ok; matrix shows everything
    let list = view === "alerts" ? alertItems : items;
    if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((i) => `${i.sku} ${i.name}`.toLowerCase().includes(s));
    }
    const sorted = [...list].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortKey === "status") { av = STATUS_META[a.status].rank; bv = STATUS_META[b.status].rank; }
      else { av = a[sortKey] as number | string; bv = b[sortKey] as number | string; }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [view, items, alertItems, statusFilter, q, sortKey, sortDir]);

  const toggleSort = (k: typeof sortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "sku" || k === "name" || k === "status" ? "asc" : "desc"); }
  };
  const SortIcon = ({ k }: { k: typeof sortKey }) =>
    sortKey === k ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={10} className="faint" />;

  const noData = !data || (data.counts.zohoItems === 0 && data.counts.storeInventoryRows === 0);

  return (
    <div className="inventory">
      <style>{INVENTORY_CSS}</style>
      <ZohoSyncBadge onSynced={load} />

      {loading && !data ? (
        <div className="empty"><Loader2 size={18} className="spin" /> Loading inventory comparison…</div>
      ) : noData ? (
        <div className="empty">No inventory data synced yet. Connect Zoho and store credentials in .env, then use &quot;Sync now&quot; above.</div>
      ) : (
        <>
          {/* alert KPI row — the numbers a founder acts on */}
          <div className="stat-row">
            <div className={`stat-card ${data!.counts.oversellRisk ? "danger" : ""}`}>
              <span className="stat-label"><ShieldAlert size={12} /> Oversell risk</span>
              <b>{data!.counts.oversellRisk}</b>
              <em>live on a store, none in Zoho</em>
            </div>
            <div className={`stat-card ${data!.counts.outOfStock ? "out" : ""}`}>
              <span className="stat-label"><Ban size={12} /> Out of stock</span>
              <b>{data!.counts.outOfStock}</b>
              <em>Zoho stock at zero</em>
            </div>
            <div className={`stat-card ${data!.counts.critical ? "crit" : ""}`}>
              <span className="stat-label"><AlertTriangle size={12} /> Critical (1–3)</span>
              <b>{data!.counts.critical}</b>
              <em>reorder now</em>
            </div>
            <div className="stat-card">
              <span className="stat-label"><Boxes size={12} /> SKUs tracked</span>
              <b>{data!.counts.zohoItems}</b>
              <em>{data!.counts.storeInventoryRows} live store rows</em>
            </div>
          </div>

          <HealthBar items={items} />

          {/* toolbar: view toggle + search + status filter */}
          <div className="inv-toolbar">
            <div className="view-toggle">
              <button className={view === "alerts" ? "on" : ""} onClick={() => setView("alerts")}>
                <ListFilter size={13} /> Alerts <span className="pill-count">{alertItems.length}</span>
              </button>
              <button className={view === "matrix" ? "on" : ""} onClick={() => setView("matrix")}>
                <LayoutGrid size={13} /> Full matrix <span className="pill-count">{items.length}</span>
              </button>
            </div>
            <div className="search-wrap">
              <Search size={14} />
              <input className="search" placeholder="Search SKU or name…" value={q} onChange={(e) => setQ(e.target.value)} />
              {q && <button className="clear" onClick={() => setQ("")}><XCircle size={13} /></button>}
            </div>
            <div className="seg">
              {(["all", "oversell_risk", "out", "critical", "low"] as const).map((k) => (
                <button key={k} className={statusFilter === k ? "on" : ""} onClick={() => setStatusFilter(k)}>
                  {k === "all" ? "All" : STATUS_META[k as InvStatus].label}
                </button>
              ))}
            </div>
          </div>

          {/* the matrix / alert table — columns driven by storeIds */}
          <section className="panel">
            <header>
              <h2>{view === "alerts" ? "Stock alerts" : "Full stock matrix"}</h2>
              <span>Zoho stock_on_hand vs live quantity per store · {tableItems.length} shown</span>
            </header>
            {tableItems.length === 0 ? (
              <p className="quiet">{view === "alerts" ? "Nothing needs attention — every SKU is above its low threshold." : "No SKUs match your filter."}</p>
            ) : (
              <div className="table-wrap">
                <table className="matrix">
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => toggleSort("status")}><span className="th">Status <SortIcon k="status" /></span></th>
                      <th className="sortable" onClick={() => toggleSort("sku")}><span className="th">SKU <SortIcon k="sku" /></span></th>
                      <th className="sortable" onClick={() => toggleSort("name")}><span className="th">Name <SortIcon k="name" /></span></th>
                      <th className="sortable num" onClick={() => toggleSort("zohoStock")}><span className="th end">Zoho <SortIcon k="zohoStock" /></span></th>
                      {storeIds.map((s) => <th key={s} className="num store-col">{s}</th>)}
                      <th className="sortable num" onClick={() => toggleSort("maxDiff")}><span className="th end">Max diff <SortIcon k="maxDiff" /></span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableItems.map((it) => {
                      const meta = STATUS_META[it.status];
                      const Icon = meta.icon;
                      return (
                        <tr key={it.sku} className={it.status !== "ok" ? "flagged" : ""}>
                          <td><span className={`status-pill ${meta.tone}`}><Icon size={11} /> {meta.label}</span></td>
                          <td className="mono">{it.sku}</td>
                          <td className="name-cell" title={it.name}>{it.name}</td>
                          <td className="num"><span className={`zoho-val ${it.zohoStock <= 0 ? "zero" : it.zohoStock <= 3 ? "crit" : ""}`}>{it.zohoStock}</span></td>
                          {storeIds.map((sid) => {
                            const sq = it.stores.find((s) => s.storeId === sid) ?? { storeId: sid, quantity: null, listed: false };
                            return <td key={sid} className="num"><QtyCell q={sq} zoho={it.zohoStock} /></td>;
                          })}
                          <td className="num"><span className={it.maxDiff > 0 ? "diff" : "mono"}>{it.maxDiff}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="matrix-key">
                  <span><i className="dot oversell" /> oversell (live stock, none in Zoho)</span>
                  <span><i className="dot zero" /> zero</span>
                  <span className="mono">·</span> not listed on that store
                </div>
              </div>
            )}
          </section>

          {/* kept: orders missing from Zoho */}
          <section className="panel">
            <header><h2>Orders missing from Zoho</h2><span>Last 30 days, no matching Zoho sales order</span></header>
            {data!.missingOrders.length === 0 ? (
              <p className="quiet">No gaps — every recent order has a matching Zoho reference.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Order</th><th>Store</th><th>Date</th><th className="num">Gross</th></tr>
                  </thead>
                  <tbody>
                    {data!.missingOrders.map((o) => (
                      <tr key={o.uid}>
                        <td className="mono">#{o.orderNumber}</td>
                        <td><span className="store-badge">{o.storeId}</span></td>
                        <td>{o.orderDate ? new Date(o.orderDate).toLocaleDateString() : "—"}</td>
                        <td className="num mono">{aed(o.grossAed)}</td>
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

const INVENTORY_CSS = `
  .inventory { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
  .inventory * { box-sizing: border-box; }
  .mono { font-variant-numeric: tabular-nums; }
  .num { text-align: right; }
  .faint { opacity: .35; }
  .spin { animation: invspin 1s linear infinite; } @keyframes invspin { to { transform: rotate(360deg); } }

  .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
  .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
  .sync-chip .ok { color: #1baf7a; } .sync-chip .bad { color: #d9534f; }

  .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }

  /* KPI cards, now with status tinting + subtext */
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .stat-card { position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
  .stat-card b { font-size: 24px; font-weight: 600; line-height: 1.1; }
  .stat-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
  .stat-card em { font-size: 10.5px; color: var(--muted); font-style: normal; }
  .stat-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; }
  .stat-card.danger::before { background: #c0392b; } .stat-card.danger b { color: #c0392b; }
  .stat-card.out::before { background: #7a5230; } .stat-card.out b { color: #7a5230; }
  .stat-card.crit::before { background: #d98324; } .stat-card.crit b { color: #b56a15; }

  /* health bar */
  .health { display: flex; flex-direction: column; gap: 8px; }
  .health-track { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: var(--line); }
  .health-seg { height: 100%; }
  .health-seg.danger { background: #c0392b; } .health-seg.out { background: #8a6240; }
  .health-seg.crit { background: #d98324; } .health-seg.low { background: #e0b84c; } .health-seg.ok { background: #4b9e7a; }
  .health-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: var(--muted); }
  .hl { display: inline-flex; align-items: center; gap: 5px; } .hl b { color: var(--ink); }
  .dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
  .dot.danger, .dot.oversell { background: #c0392b; } .dot.out, .dot.zero { background: #8a6240; }
  .dot.crit { background: #d98324; } .dot.low { background: #e0b84c; } .dot.ok { background: #4b9e7a; }

  /* toolbar */
  .inv-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .view-toggle { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; }
  .view-toggle button { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; font-family: inherit; font-size: 12.5px; font-weight: 500; color: var(--muted); padding: 7px 12px; border-radius: 7px; cursor: pointer; }
  .view-toggle button.on { background: var(--ink); color: var(--card); }
  .pill-count { font-size: 10.5px; background: rgba(0,0,0,.12); padding: 1px 6px; border-radius: 999px; }
  .view-toggle button.on .pill-count { background: rgba(255,255,255,.2); }
  .search-wrap { position: relative; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 11px; color: var(--muted); }
  .search-wrap:focus-within { border-color: var(--gold); }
  .search { border: none; background: transparent; outline: none; font-family: inherit; font-size: 13px; color: var(--ink); width: 100%; }
  .clear { border: none; background: none; color: var(--muted); cursor: pointer; display: flex; }
  .seg { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; flex-wrap: wrap; }
  .seg button { border: none; background: none; font-family: inherit; font-size: 11.5px; font-weight: 500; color: var(--muted); padding: 6px 10px; border-radius: 7px; cursor: pointer; }
  .seg button.on { background: var(--gold-wash); color: var(--gold-deep); }

  .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
  .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; flex-wrap: wrap; gap: 4px; }
  .panel header h2 { font-size: 16px; margin: 0; }
  .panel header span { font-size: 12.5px; color: var(--muted); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th.sortable { cursor: pointer; user-select: none; } th.sortable:hover { color: var(--ink); }
  th .th { display: inline-flex; align-items: center; gap: 4px; } th .th.end { justify-content: flex-end; }
  th.store-col { text-align: right; color: var(--gold-deep); font-weight: 700; }
  td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .matrix tbody tr.flagged { background: linear-gradient(90deg, rgba(192,57,43,.04), transparent 40%); }
  .matrix tbody tr:hover { background: var(--gold-wash); }
  .name-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .status-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
  .status-pill.danger { color: #c0392b; background: rgba(192,57,43,.1); }
  .status-pill.out { color: #7a5230; background: rgba(122,82,48,.1); }
  .status-pill.crit { color: #b56a15; background: rgba(217,131,36,.12); }
  .status-pill.low { color: #9a7d1e; background: rgba(224,184,76,.16); }
  .status-pill.ok { color: #3d8262; background: rgba(75,158,122,.12); }

  .zoho-val { font-variant-numeric: tabular-nums; font-weight: 600; }
  .zoho-val.zero { color: #8a6240; } .zoho-val.crit { color: #b56a15; }
  .qty { font-variant-numeric: tabular-nums; }
  .qty.zero { color: #8a6240; font-weight: 600; }
  .qty.crit { color: #b56a15; }
  .qty.oversell { color: #c0392b; font-weight: 700; background: rgba(192,57,43,.1); padding: 1px 6px; border-radius: 5px; }
  .qty.na { color: var(--line); }
  .diff { color: #c0392b; font-weight: 700; font-variant-numeric: tabular-nums; }
  .matrix-key { display: flex; align-items: center; gap: 16px; margin-top: 10px; font-size: 11px; color: var(--muted); flex-wrap: wrap; }
  .matrix-key span { display: inline-flex; align-items: center; gap: 5px; }

  .store-badge { display: inline-block; font-size: 11px; font-weight: 600; background: var(--gold-wash); color: var(--gold-deep); border-radius: 6px; padding: 2px 7px; margin-right: 6px; }
  .quiet { color: var(--muted); font-size: 13px; }
`;