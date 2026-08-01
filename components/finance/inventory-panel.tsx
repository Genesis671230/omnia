




// "use client";

// /* Cross-platform inventory — Zoho's authoritative stock_on_hand vs live
//    Shopify (per store: UAE/KSA/WA) and WooCommerce quantities.
//    Alerts-first: leads with what you're about to oversell / run out of, with
//    the full SKU × store matrix behind a toggle as the audit view. Read-only:
//    this panel never writes to Zoho.

//    Consumes the patched /api/inventory/summary:
//      items[]      — every SKU with per-store quantities + a server-computed status
//      storeIds[]   — column order (from sync config; never hard-coded here)
//      mismatches[] / missingOrders[] — unchanged, still power their sections
//      counts       — includes outOfStock / critical / oversellRisk
//    Status rule lives server-side (lib/inventory-compare.ts) so it's defined once. */

// import {
//   AlertTriangle, Boxes, CheckCircle2, Loader2, PackageX, RefreshCcw, XCircle,
//   Search, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, ListFilter, ShieldAlert, TrendingDown, Ban,
// } from "lucide-react";
// import { useCallback, useEffect, useMemo, useState } from "react";
// import { toast } from "sonner";
// import { WarehouseMatrixPanel } from "./warehouse-panel";

// /* ── payload shapes (mirror the patched route) ──────────────────────────── */
// type StoreQty = { storeId: string; quantity: number | null; listed: boolean };
// type InvStatus = "oversell_risk" | "out" | "critical" | "low" | "ok";

// type InventoryItem = {
//   sku: string;
//   name: string;
//   zohoStock: number;
//   stores: StoreQty[];
//   totalStoreQty: number;
//   maxDiff: number;
//   status: InvStatus;
// };

// type StockMismatch = {
//   sku: string; name: string; zohoStock: number;
//   storeStock: { storeId: string; quantity: number | null }[]; maxDiff: number;
// };
// type MissingOrder = { uid: string; orderNumber: string; storeId: string; orderDate: string | null; grossAed: number };

// type Summary = {
//   items: InventoryItem[];
//   storeIds: string[];
//   mismatches: StockMismatch[];
//   missingOrders: MissingOrder[];
//   counts: {
//     zohoItems: number; storeInventoryRows: number; zohoOrders: number;
//     outOfStock: number; critical: number; oversellRisk: number;
//   };
// };

// type SyncStatus = {
//   zoho: boolean; shopify: string[]; woo: boolean;
//   lastRun: {
//     trigger: string; finished_at: string | null;
//     source_results: { source: string; fetched: number; saved: number; error?: string }[];
//   } | null;
// };

// /* ── formatters ─────────────────────────────────────────────────────────── */
// const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v || 0);
// const timeAgo = (iso: string) => {
//   const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
//   if (mins < 1) return "just now";
//   if (mins < 60) return `${mins}m ago`;
//   const hrs = Math.round(mins / 60);
//   if (hrs < 24) return `${hrs}h ago`;
//   return `${Math.round(hrs / 24)}d ago`;
// };

// const STATUS_META: Record<InvStatus, { label: string; tone: string; icon: typeof Ban; rank: number }> = {
//   oversell_risk: { label: "Oversell risk", tone: "danger", icon: ShieldAlert, rank: 0 },
//   out:           { label: "Out of stock", tone: "out",    icon: Ban,         rank: 1 },
//   critical:      { label: "Critical",      tone: "crit",   icon: AlertTriangle, rank: 2 },
//   low:           { label: "Low",           tone: "low",    icon: TrendingDown,  rank: 3 },
//   ok:            { label: "In stock",      tone: "ok",     icon: CheckCircle2,  rank: 4 },
// };

// /* ── sync badge (unchanged behavior, tidied) ────────────────────────────── */
// function ZohoSyncBadge({ onSynced }: { onSynced: () => void }) {
//   const [status, setStatus] = useState<SyncStatus | null>(null);
//   const [syncing, setSyncing] = useState(false);

//   const load = useCallback(() => {
//     fetch("/api/integrations/zoho").then((r) => r.json()).then(setStatus).catch(() => {});
//   }, []);
//   useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

//   const syncNow = async () => {
//     setSyncing(true);
//     try {
//       const res = await fetch("/api/integrations/zoho", { method: "POST" });
//       const json = await res.json();
//       for (const r of json.results ?? []) r.error ? toast.error(`${r.source}: ${r.error}`) : toast.success(`${r.source}: ${r.saved} synced`);
//       load(); onSynced();
//     } catch (e) { toast.error((e as Error).message); } finally { setSyncing(false); }
//   };

//   if (!status) return null;
//   const run = status.lastRun;
//   const bySource = new Map((run?.source_results ?? []).map((r) => [r.source, r]));
//   const chip = (source: string, label: string) => {
//     const r = bySource.get(source);
//     return (
//       <span key={source} className="sync-chip" title={r?.error || (r ? `${r.saved} saved` : undefined)}>
//         {r && !r.error ? <CheckCircle2 size={12} className="ok" /> : r?.error ? <XCircle size={12} className="bad" /> : null}
//         {label}
//       </span>
//     );
//   };

//   return (
//     <div className="sync-badge">
//       <RefreshCcw size={12} />
//       <span>Inventory sync {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
//       {chip("zoho-items", "Zoho items")}
//       {chip("zoho-orders", "Zoho orders")}
//       {status.shopify.map((c) => chip(`shopify-${c}`, `Shopify ${c}`))}
//       {status.woo && chip("woo", "WooCommerce")}
//       <button className="btn small" disabled={syncing} onClick={syncNow} style={{ marginLeft: "auto" }}>
//         {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />} Sync now
//       </button>
//     </div>
//   );
// }

// /* ── health bar: proportion of catalog in each status ───────────────────── */
// function HealthBar({ items }: { items: InventoryItem[] }) {
//   const total = items.length || 1;
//   const buckets = (["oversell_risk", "out", "critical", "low", "ok"] as InvStatus[]).map((s) => ({
//     status: s, count: items.filter((i) => i.status === s).length,
//   }));
//   return (
//     <div className="health">
//       <div className="health-track">
//         {buckets.map((b) => b.count > 0 && (
//           <div key={b.status} className={`health-seg ${STATUS_META[b.status].tone}`}
//             style={{ width: `${(b.count / total) * 100}%` }}
//             title={`${STATUS_META[b.status].label}: ${b.count}`} />
//         ))}
//       </div>
//       <div className="health-legend">
//         {buckets.map((b) => (
//           <span key={b.status} className="hl">
//             <i className={`dot ${STATUS_META[b.status].tone}`} />{STATUS_META[b.status].label} <b>{b.count}</b>
//           </span>
//         ))}
//       </div>
//     </div>
//   );
// }

// /* ── the store-quantity cell: color-codes 0 and "not listed" distinctly ─── */
// function QtyCell({ q, zoho }: { q: StoreQty; zoho: number }) {
//   if (!q.listed) return <span className="qty na" title="Not listed on this store">·</span>;
//   const n = q.quantity ?? 0;
//   const oversell = zoho <= 0 && n > 0;         // selling stock Zoho says isn't there
//   const cls = oversell ? "qty oversell" : n <= 0 ? "qty zero" : n <= 3 ? "qty crit" : "qty";
//   return <span className={cls} title={oversell ? "Live stock on store, none in Zoho" : undefined}>{n}</span>;
// }

// /* ── main panel ─────────────────────────────────────────────────────────── */
// export function InventoryPanel() {
//   const [data, setData] = useState<Summary | null>(null);
//   const [loading, setLoading] = useState(true);
//   const [view, setView] = useState<"alerts" | "matrix">("alerts");
//   const [q, setQ] = useState("");
//   const [statusFilter, setStatusFilter] = useState<"all" | InvStatus>("all");
//   const [sortKey, setSortKey] = useState<"status" | "sku" | "name" | "zohoStock" | "totalStoreQty" | "maxDiff">("status");
//   const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

//   const load = useCallback(async () => {
//     setLoading(true);
//     try {
//       const res = await fetch("/api/inventory/summary");
//       setData(await res.json());
//     } catch (e) {
//       toast.error(`Inventory data load failed: ${(e as Error).message}`);
//     } finally { setLoading(false); }
//   }, []);
//   useEffect(() => { load(); }, [load]);

//   const items = data?.items ?? [];
//   const storeIds = data?.storeIds ?? [];

//   const alertItems = useMemo(() => items.filter((i) => i.status !== "ok"), [items]);

//   const tableItems = useMemo(() => {
//     // alerts view shows only non-ok; matrix shows everything
//     let list = view === "alerts" ? alertItems : items;
//     if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
//     if (q) {
//       const s = q.toLowerCase();
//       list = list.filter((i) => `${i.sku} ${i.name}`.toLowerCase().includes(s));
//     }
//     const sorted = [...list].sort((a, b) => {
//       let av: number | string, bv: number | string;
//       if (sortKey === "status") { av = STATUS_META[a.status].rank; bv = STATUS_META[b.status].rank; }
//       else { av = a[sortKey] as number | string; bv = b[sortKey] as number | string; }
//       const cmp = av < bv ? -1 : av > bv ? 1 : 0;
//       return sortDir === "asc" ? cmp : -cmp;
//     });
//     return sorted;
//   }, [view, items, alertItems, statusFilter, q, sortKey, sortDir]);

//   const toggleSort = (k: typeof sortKey) => {
//     if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
//     else { setSortKey(k); setSortDir(k === "sku" || k === "name" || k === "status" ? "asc" : "desc"); }
//   };
//   const SortIcon = ({ k }: { k: typeof sortKey }) =>
//     sortKey === k ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={10} className="faint" />;

//   const noData = !data || (data.counts.zohoItems === 0 && data.counts.storeInventoryRows === 0);

//   return (
//     <div className="inventory">
//       <style>{INVENTORY_CSS}</style>
//       <ZohoSyncBadge onSynced={load} />
//         <WarehouseMatrixPanel/>
//       {loading && !data ? (
//         <div className="empty"><Loader2 size={18} className="spin" /> Loading inventory comparison…</div>
//       ) : noData ? (
//         <div className="empty">No inventory data synced yet. Connect Zoho and store credentials in .env, then use &quot;Sync now&quot; above.</div>
//       ) : (
//         <>
//           {/* alert KPI row — the numbers a founder acts on */}
//           <div className="stat-row">
//             <div className={`stat-card ${data!.counts.oversellRisk ? "danger" : ""}`}>
//               <span className="stat-label"><ShieldAlert size={12} /> Oversell risk</span>
//               <b>{data!.counts.oversellRisk}</b>
//               <em>live on a store, none in Zoho</em>
//             </div>
//             <div className={`stat-card ${data!.counts.outOfStock ? "out" : ""}`}>
//               <span className="stat-label"><Ban size={12} /> Out of stock</span>
//               <b>{data!.counts.outOfStock}</b>
//               <em>Zoho stock at zero</em>
//             </div>
//             <div className={`stat-card ${data!.counts.critical ? "crit" : ""}`}>
//               <span className="stat-label"><AlertTriangle size={12} /> Critical (1–3)</span>
//               <b>{data!.counts.critical}</b>
//               <em>reorder now</em>
//             </div>
//             <div className="stat-card">
//               <span className="stat-label"><Boxes size={12} /> SKUs tracked</span>
//               <b>{data!.counts.zohoItems}</b>
//               <em>{data!.counts.storeInventoryRows} live store rows</em>
//             </div>
//           </div>

//           <HealthBar items={items} />

//           {/* toolbar: view toggle + search + status filter */}
//           <div className="inv-toolbar">
//             <div className="view-toggle">
//               <button className={view === "alerts" ? "on" : ""} onClick={() => setView("alerts")}>
//                 <ListFilter size={13} /> Alerts <span className="pill-count">{alertItems.length}</span>
//               </button>
//               <button className={view === "matrix" ? "on" : ""} onClick={() => setView("matrix")}>
//                 <LayoutGrid size={13} /> Full matrix <span className="pill-count">{items.length}</span>
//               </button>
//             </div>
//             <div className="search-wrap">
//               <Search size={14} />
//               <input className="search" placeholder="Search SKU or name…" value={q} onChange={(e) => setQ(e.target.value)} />
//               {q && <button className="clear" onClick={() => setQ("")}><XCircle size={13} /></button>}
//             </div>
//             <div className="seg">
//               {(["all", "oversell_risk", "out", "critical", "low"] as const).map((k) => (
//                 <button key={k} className={statusFilter === k ? "on" : ""} onClick={() => setStatusFilter(k)}>
//                   {k === "all" ? "All" : STATUS_META[k as InvStatus].label}
//                 </button>
//               ))}
//             </div>
//           </div>

//           {/* the matrix / alert table — columns driven by storeIds */}
//           <section className="panel">
//             <header>
//               <h2>{view === "alerts" ? "Stock alerts" : "Full stock matrix"}</h2>
//               <span>Zoho stock_on_hand vs live quantity per store · {tableItems.length} shown</span>
//             </header>
//             {tableItems.length === 0 ? (
//               <p className="quiet">{view === "alerts" ? "Nothing needs attention — every SKU is above its low threshold." : "No SKUs match your filter."}</p>
//             ) : (
//               <div className="table-wrap">
//                 <table className="matrix">
//                   <thead>
//                     <tr>
//                       <th className="sortable" onClick={() => toggleSort("status")}><span className="th">Status <SortIcon k="status" /></span></th>
//                       <th className="sortable" onClick={() => toggleSort("sku")}><span className="th">SKU <SortIcon k="sku" /></span></th>
//                       <th className="sortable" onClick={() => toggleSort("name")}><span className="th">Name <SortIcon k="name" /></span></th>
//                       <th className="sortable num" onClick={() => toggleSort("zohoStock")}><span className="th end">Zoho <SortIcon k="zohoStock" /></span></th>
//                       {storeIds.map((s) => <th key={s} className="num store-col">{s}</th>)}
//                       <th className="sortable num" onClick={() => toggleSort("maxDiff")}><span className="th end">Max diff <SortIcon k="maxDiff" /></span></th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {tableItems.map((it) => {
//                       const meta = STATUS_META[it.status];
//                       const Icon = meta.icon;
//                       return (
//                         <tr key={it.sku} className={it.status !== "ok" ? "flagged" : ""}>
//                           <td><span className={`status-pill ${meta.tone}`}><Icon size={11} /> {meta.label}</span></td>
//                           <td className="mono">{it.sku}</td>
//                           <td className="name-cell" title={it.name}>{it.name}</td>
//                           <td className="num"><span className={`zoho-val ${it.zohoStock <= 0 ? "zero" : it.zohoStock <= 3 ? "crit" : ""}`}>{it.zohoStock}</span></td>
//                           {storeIds.map((sid) => {
//                             const sq = it.stores.find((s) => s.storeId === sid) ?? { storeId: sid, quantity: null, listed: false };
//                             return <td key={sid} className="num"><QtyCell q={sq} zoho={it.zohoStock} /></td>;
//                           })}
//                           <td className="num"><span className={it.maxDiff > 0 ? "diff" : "mono"}>{it.maxDiff}</span></td>
//                         </tr>
//                       );
//                     })}
//                   </tbody>
//                 </table>
//                 <div className="matrix-key">
//                   <span><i className="dot oversell" /> oversell (live stock, none in Zoho)</span>
//                   <span><i className="dot zero" /> zero</span>
//                   <span className="mono">·</span> not listed on that store
//                 </div>
//               </div>
//             )}
//           </section>

//           {/* kept: orders missing from Zoho */}
//           <section className="panel">
//             <header><h2>Orders missing from Zoho</h2><span>Last 30 days, no matching Zoho sales order</span></header>
//             {data!.missingOrders.length === 0 ? (
//               <p className="quiet">No gaps — every recent order has a matching Zoho reference.</p>
//             ) : (
//               <div className="table-wrap">
//                 <table>
//                   <thead>
//                     <tr><th>Order</th><th>Store</th><th>Date</th><th className="num">Gross</th></tr>
//                   </thead>
//                   <tbody>
//                     {data!.missingOrders.map((o) => (
//                       <tr key={o.uid}>
//                         <td className="mono">#{o.orderNumber}</td>
//                         <td><span className="store-badge">{o.storeId}</span></td>
//                         <td>{o.orderDate ? new Date(o.orderDate).toLocaleDateString() : "—"}</td>
//                         <td className="num mono">{aed(o.grossAed)}</td>
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
//   .inventory * { box-sizing: border-box; }
//   .mono { font-variant-numeric: tabular-nums; }
//   .num { text-align: right; }
//   .faint { opacity: .35; }
//   .spin { animation: invspin 1s linear infinite; } @keyframes invspin { to { transform: rotate(360deg); } }

//   .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
//   .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
//   .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
//   .sync-chip .ok { color: #1baf7a; } .sync-chip .bad { color: #d9534f; }

//   .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }

//   /* KPI cards, now with status tinting + subtext */
//   .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
//   .stat-card { position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
//   .stat-card b { font-size: 24px; font-weight: 600; line-height: 1.1; }
//   .stat-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
//   .stat-card em { font-size: 10.5px; color: var(--muted); font-style: normal; }
//   .stat-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; }
//   .stat-card.danger::before { background: #c0392b; } .stat-card.danger b { color: #c0392b; }
//   .stat-card.out::before { background: #7a5230; } .stat-card.out b { color: #7a5230; }
//   .stat-card.crit::before { background: #d98324; } .stat-card.crit b { color: #b56a15; }

//   /* health bar */
//   .health { display: flex; flex-direction: column; gap: 8px; }
//   .health-track { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: var(--line); }
//   .health-seg { height: 100%; }
//   .health-seg.danger { background: #c0392b; } .health-seg.out { background: #8a6240; }
//   .health-seg.crit { background: #d98324; } .health-seg.low { background: #e0b84c; } .health-seg.ok { background: #4b9e7a; }
//   .health-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: var(--muted); }
//   .hl { display: inline-flex; align-items: center; gap: 5px; } .hl b { color: var(--ink); }
//   .dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
//   .dot.danger, .dot.oversell { background: #c0392b; } .dot.out, .dot.zero { background: #8a6240; }
//   .dot.crit { background: #d98324; } .dot.low { background: #e0b84c; } .dot.ok { background: #4b9e7a; }

//   /* toolbar */
//   .inv-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
//   .view-toggle { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; }
//   .view-toggle button { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; font-family: inherit; font-size: 12.5px; font-weight: 500; color: var(--muted); padding: 7px 12px; border-radius: 7px; cursor: pointer; }
//   .view-toggle button.on { background: var(--ink); color: var(--card); }
//   .pill-count { font-size: 10.5px; background: rgba(0,0,0,.12); padding: 1px 6px; border-radius: 999px; }
//   .view-toggle button.on .pill-count { background: rgba(255,255,255,.2); }
//   .search-wrap { position: relative; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 11px; color: var(--muted); }
//   .search-wrap:focus-within { border-color: var(--gold); }
//   .search { border: none; background: transparent; outline: none; font-family: inherit; font-size: 13px; color: var(--ink); width: 100%; }
//   .clear { border: none; background: none; color: var(--muted); cursor: pointer; display: flex; }
//   .seg { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; flex-wrap: wrap; }
//   .seg button { border: none; background: none; font-family: inherit; font-size: 11.5px; font-weight: 500; color: var(--muted); padding: 6px 10px; border-radius: 7px; cursor: pointer; }
//   .seg button.on { background: var(--gold-wash); color: var(--gold-deep); }

//   .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
//   .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; flex-wrap: wrap; gap: 4px; }
//   .panel header h2 { font-size: 16px; margin: 0; }
//   .panel header span { font-size: 12.5px; color: var(--muted); }
//   .table-wrap { overflow-x: auto; }
//   table { width: 100%; border-collapse: collapse; font-size: 13px; }
//   th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
//   th.sortable { cursor: pointer; user-select: none; } th.sortable:hover { color: var(--ink); }
//   th .th { display: inline-flex; align-items: center; gap: 4px; } th .th.end { justify-content: flex-end; }
//   th.store-col { text-align: right; color: var(--gold-deep); font-weight: 700; }
//   td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
//   .matrix tbody tr.flagged { background: linear-gradient(90deg, rgba(192,57,43,.04), transparent 40%); }
//   .matrix tbody tr:hover { background: var(--gold-wash); }
//   .name-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

//   .status-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
//   .status-pill.danger { color: #c0392b; background: rgba(192,57,43,.1); }
//   .status-pill.out { color: #7a5230; background: rgba(122,82,48,.1); }
//   .status-pill.crit { color: #b56a15; background: rgba(217,131,36,.12); }
//   .status-pill.low { color: #9a7d1e; background: rgba(224,184,76,.16); }
//   .status-pill.ok { color: #3d8262; background: rgba(75,158,122,.12); }

//   .zoho-val { font-variant-numeric: tabular-nums; font-weight: 600; }
//   .zoho-val.zero { color: #8a6240; } .zoho-val.crit { color: #b56a15; }
//   .qty { font-variant-numeric: tabular-nums; }
//   .qty.zero { color: #8a6240; font-weight: 600; }
//   .qty.crit { color: #b56a15; }
//   .qty.oversell { color: #c0392b; font-weight: 700; background: rgba(192,57,43,.1); padding: 1px 6px; border-radius: 5px; }
//   .qty.na { color: var(--line); }
//   .diff { color: #c0392b; font-weight: 700; font-variant-numeric: tabular-nums; }
//   .matrix-key { display: flex; align-items: center; gap: 16px; margin-top: 10px; font-size: 11px; color: var(--muted); flex-wrap: wrap; }
//   .matrix-key span { display: inline-flex; align-items: center; gap: 5px; }

//   .store-badge { display: inline-block; font-size: 11px; font-weight: 600; background: var(--gold-wash); color: var(--gold-deep); border-radius: 6px; padding: 2px 7px; margin-right: 6px; }
//   .quiet { color: var(--muted); font-size: 13px; }
// `;



"use client";

/* Cross-platform inventory — Zoho's authoritative stock_on_hand vs live
   Shopify (per store: UAE/KSA/WA) and WooCommerce quantities.
   Alerts-first + coverage-first: leads with what you're about to oversell,
   what's sitting as dead cash, and what's missing from which store. Full
   SKU × store matrix behind a toggle as the audit view. Read-only Phase 1:
   this panel never writes to Zoho or the stores yet.

   Consumes /api/inventory/summary:
     items[]      — every SKU with per-store quantities + status + coverage
     storeIds[]   — column order (from sync config; never hard-coded here)
     mismatches[] / missingOrders[] — unchanged, still power their sections
     counts       — status counts + byCoverage + missingFrom + onlyOn + deadCashAed
   All classification lives server-side (lib/inventory-compare.ts) — defined once. */

import {
  AlertTriangle, Boxes, CheckCircle2, Loader2, PackageX, RefreshCcw, XCircle,
  Search, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, ListFilter, ShieldAlert,
  TrendingDown, Ban, Wallet, Section,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LiveEventsTicker } from "../inventory/live-events-ticker";
import { StorePulseRow } from "../inventory/store-pulse-row";
import { ActivityChart } from "../inventory/activity-chart";
import { SkuDrawer } from "../inventory/sku-drawer";
import { DriftPanel } from "../inventory/drift-panel";

/* ── payload shapes (mirror the patched route) ──────────────────────────── */
type StoreQty = { storeId: string; quantity: number | null; listed: boolean;tracking: boolean;};
type InvStatus =
  | "oversell_risk" | "unlisted" | "stock_mismatch"
  | "out" | "critical" | "low" | "ok"|"unlistedinany";
type CoverageBucket =
  | "everywhere" | "zoho_only" | "stores_only"
  | "missing_channels" | "single_store" | "nowhere";

type InventoryItem = {
  sku: string;
  name: string;
  zohoStock: number;
  available?: number;
  zohoExists: boolean;
  stores: StoreQty[];
  totalStoreQty: number;
  maxDiff: number;
  status: InvStatus;
  presentOn: string[];
  absentFrom: string[];
  coverageBucket: CoverageBucket;
  deadCashAed: number;
};

// export default async function PendingZohoPage() {
//   const { data } = await supabase.from("pending_zoho_sync")
//     .select("sku, origin_channel, expected_delta, order_ref, created_at")
//     .is("cleared_at", null)
//     .order("created_at", { ascending: true });

//   const now = Date.now();
//   const rows = (data ?? []).map((r) => ({
//     ...r,
//     waitedMin: Math.round((now - new Date(r.created_at).getTime()) / 60000),
//   }));

//   const red = rows.filter((r) => r.waitedMin > 30);
//   const amber = rows.filter((r) => r.waitedMin > 10 && r.waitedMin <= 30);
//   const green = rows.filter((r) => r.waitedMin <= 10);

//   return (
//     <div className="space-y-6 p-6">
//       <header>
//         <h1 className="text-xl font-semibold">Waiting on Zoho</h1>
//         <p className="text-sm text-neutral-400">
//           Orders that landed on a store but Zoho hasn't caught up yet.
//           {red.length > 0 && <span className="ml-2 text-red-400">{red.length} broken</span>}
//         </p>
//       </header>

//       <Section title="Broken (Zoho SO not created)" tone="red" rows={red} />
//       <Section title="Slow (10–30m)" tone="amber" rows={amber} />
//       <Section title="Normal (< 10m)" tone="green" rows={green} />
//     </div>
//   );
// }
type StockMismatch = {
  sku: string; name: string; zohoStock: number;
  storeStock: { storeId: string; quantity: number | null }[]; maxDiff: number;
};
type MissingOrder = {
  uid: string; orderNumber: string; storeId: string;
  orderDate: string | null; grossAed: number;
};

type Summary = {
  items: InventoryItem[];
  storeIds: string[];
  mismatches: StockMismatch[];
  missingOrders: MissingOrder[];
  counts: {
    zohoItems: number; storeInventoryRows: number; zohoOrders: number;
    outOfStock: number; critical: number; oversellRisk: number;
    unlisted: number; stockMismatch: number;
    byCoverage: Record<CoverageBucket, number>;
    missingFrom: Record<string, number>;
    onlyOn: Record<string, number>;
    deadCashAed: number;
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
const aed = (v: number) => new Intl.NumberFormat("en-AE", {
  style: "currency", currency: "AED", maximumFractionDigits: 0,
}).format(v || 0);
const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const STATUS_META: Record<InvStatus, {
  label: string; tone: string; icon: typeof Ban; rank: number;
}> = {
  oversell_risk:  { label: "Oversell risk",  tone: "danger",   icon: ShieldAlert,   rank: 0 },
  unlisted:       { label: "Unlisted",       tone: "unlisted", icon: PackageX,      rank: 1 },
  stock_mismatch: { label: "Stock mismatch", tone: "mismatch", icon: AlertTriangle, rank: 2 },
  out:            { label: "Out of stock",   tone: "out",      icon: Ban,           rank: 3 },
  critical:       { label: "Critical",       tone: "crit",     icon: AlertTriangle, rank: 4 },
  low:            { label: "Low",            tone: "low",      icon: TrendingDown,  rank: 5 },
  ok:             { label: "In stock",       tone: "ok",       icon: CheckCircle2,  rank: 6 },
  unlistedinany:       { label: "UnlistedInAny",       tone: "unlistedinany", icon: PackageX,      rank: 7 },
};

const COVERAGE_META: Record<CoverageBucket | "all", { label: string; hint: string }> = {
  all:              { label: "All",              hint: "" },
  zoho_only:        { label: "Zoho only",        hint: "in warehouse, on zero stores" },
  missing_channels: { label: "Missing channels", hint: "absent from ≥1 store" },
  single_store:     { label: "Single store",     hint: "on exactly one store" },
  stores_only:      { label: "Stores only",      hint: "on stores, not in Zoho catalog" },
  everywhere:       { label: "Everywhere",       hint: "on Zoho and every store" },
  nowhere:          { label: "Nowhere",          hint: "data anomaly" },
};

/* ── sync badge (unchanged behavior) ────────────────────────────────────── */
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
  const order: InvStatus[] = [
    "oversell_risk", "unlisted", "stock_mismatch",
    "out", "critical", "low", "ok",
  ];
  const buckets = order.map((s) => ({
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
  const oversell = zoho <= 0 && n > 0;
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
  const [coverageFilter, setCoverageFilter] = useState<"all" | CoverageBucket>("all");
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"status" | "sku" | "name" | "zohoStock" | "totalStoreQty" | "maxDiff">("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

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
    // alerts view shows only non-ok statuses; matrix shows everything
    let list = view === "alerts" ? alertItems : items;

    if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);

    if (coverageFilter !== "all") {
      list = list.filter((i) => i.coverageBucket === coverageFilter);
    }

    // Channel sub-filter only applies to coverage buckets where "which
    // channel?" is the natural next question.
    if (channelFilter) {
      if (coverageFilter === "missing_channels") {
        list = list.filter((i) => i.absentFrom.includes(channelFilter));
      } else if (coverageFilter === "single_store") {
        list = list.filter((i) => i.presentOn.includes(channelFilter));
      }
    }

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
  }, [view, items, alertItems, statusFilter, coverageFilter, channelFilter, q, sortKey, sortDir]);

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
      <StorePulseRow />
      <div className="live-grid">
        <ActivityChart />
        <LiveEventsTicker onSelectSku={setSelectedSku} />
      </div>

      <DriftPanel onSelectSku={setSelectedSku} />
      {loading && !data ? (
        <div className="empty"><Loader2 size={18} className="spin" /> Loading inventory comparison…</div>
      ) : noData ? (
        <div className="empty">No inventory data synced yet. Connect Zoho and store credentials in .env, then use &quot;Sync now&quot; above.</div>
      ) : (
        <>
          {/* KPI row — the numbers a founder acts on */}
          <div className="stat-row">
            <div className={`stat-card ${data!.counts.oversellRisk ? "danger" : ""}`}>
              <span className="stat-label"><ShieldAlert size={12} /> Oversell risk</span>
              <b>{data!.counts.oversellRisk}</b>
              <em>live on a store, none in Zoho</em>
            </div>
            <div className={`stat-card ${data!.counts.byCoverage.zoho_only ? "unlisted" : ""}`}>
              <span className="stat-label"><Wallet size={12} /> Dead cash</span>
              <b>{data!.counts.deadCashAed > 0 ? aed(data!.counts.deadCashAed) : data!.counts.byCoverage.zoho_only}</b>
              <em>{data!.counts.byCoverage.zoho_only} SKUs in Zoho, on zero stores</em>
            </div>
            <div className={`stat-card ${data!.counts.stockMismatch ? "mismatch" : ""}`}>
              <span className="stat-label"><AlertTriangle size={12} /> Stock mismatch</span>
              <b>{data!.counts.stockMismatch}</b>
              <em>store qty diverges from Zoho</em>
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

          {/* Coverage filter row — which channels carry each SKU */}
          <div className="coverage-row">
            <div className="coverage-title">Coverage</div>
            <div className="seg">
              {(["all", "zoho_only", "missing_channels", "single_store", "stores_only", "everywhere"] as const).map((k) => (
                <button
                  key={k}
                  className={coverageFilter === k ? "on" : ""}
                  onClick={() => { setCoverageFilter(k); setChannelFilter(null); }}
                  title={COVERAGE_META[k].hint}
                >
                  {COVERAGE_META[k].label}
                  {k !== "all" && (
                    <span className="pill-count">
                      {data!.counts.byCoverage[k as CoverageBucket] ?? 0}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Channel sub-filter — only for coverage buckets where it makes sense */}
            {(coverageFilter === "missing_channels" || coverageFilter === "single_store") && (
              <div className="seg sub-seg">
                {["zoho", ...storeIds].map((c) => {
                  // Zoho is not a "single store" — hide it in that sub-view
                  if (coverageFilter === "single_store" && c === "zoho") return null;
                  const count = coverageFilter === "missing_channels"
                    ? data!.counts.missingFrom[c] ?? 0
                    : data!.counts.onlyOn[c] ?? 0;
                  return (
                    <button
                      key={c}
                      className={channelFilter === c ? "on" : ""}
                      onClick={() => setChannelFilter(channelFilter === c ? null : c)}
                    >
                      {coverageFilter === "missing_channels" ? `Not on ${c}` : `Only on ${c}`}
                      <span className="pill-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Toolbar: view toggle + search + status filter */}
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
              {(["all", "oversell_risk", "unlisted", "stock_mismatch", "out", "critical", "low","unlistedinany"] as const).map((k) => (
                <button key={k} className={statusFilter === k ? "on" : ""} onClick={() => setStatusFilter(k)}>
                  {k === "all" ? "All" : STATUS_META[k as InvStatus].label}
                </button>
              ))}
            </div>
          </div>

          {/* The matrix / alert table — columns driven by storeIds */}
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
                        <tr key={it.sku}  onClick={() => setSelectedSku(it.sku)} className={it.status !== "ok" ? "flagged clickable" : "clickable"}>
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

          {/* Orders missing from Zoho */}
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
      <SkuDrawer sku={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  );
}

  const INVENTORY_CSS = `
    .inventory { display: flex; flex-direction: column; gap: 16px;  }
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

    /* KPI cards, with status tinting + subtext */
    .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .stat-card { position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
    .stat-card b { font-size: 24px; font-weight: 600; line-height: 1.1; }
    .stat-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
    .stat-card em { font-size: 10.5px; color: var(--muted); font-style: normal; }
    .stat-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; }
    .stat-card.danger::before   { background: #c0392b; } .stat-card.danger b   { color: #c0392b; }
    .stat-card.unlisted::before { background: #7a3b8f; } .stat-card.unlisted b { color: #7a3b8f; }
    .stat-card.mismatch::before { background: #c98a1a; } .stat-card.mismatch b { color: #c98a1a; }
    .stat-card.out::before      { background: #7a5230; } .stat-card.out b      { color: #7a5230; }
    .stat-card.crit::before     { background: #d98324; } .stat-card.crit b     { color: #b56a15; }

    /* health bar */
    .health { display: flex; flex-direction: column; gap: 8px; }
    .health-track { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: var(--line); }
    .health-seg { height: 100%; }
    .health-seg.danger   { background: #c0392b; }
    .health-seg.unlisted { background: #7a3b8f; }
    .health-seg.mismatch { background: #c98a1a; }
    .health-seg.out      { background: #8a6240; }
    .health-seg.crit     { background: #d98324; }
    .health-seg.low      { background: #e0b84c; }
    .health-seg.ok       { background: #4b9e7a; }
    .health-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: var(--muted); }
    .hl { display: inline-flex; align-items: center; gap: 5px; } .hl b { color: var(--ink); }
    .dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
    .dot.danger, .dot.oversell { background: #c0392b; }
    .dot.unlisted              { background: #7a3b8f; }
    .dot.mismatch              { background: #c98a1a; }
    .dot.out, .dot.zero        { background: #8a6240; }
    .dot.crit                  { background: #d98324; }
    .dot.low                   { background: #e0b84c; }
    .dot.ok                    { background: #4b9e7a; }

    /* coverage row */
    .coverage-row { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
    .coverage-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 700; }
    .sub-seg { background: var(--gold-wash); }
    .sub-seg button { font-size: 11px; }

    /* toolbar */
    .inv-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .view-toggle { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; }
    .view-toggle button { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; font-family: inherit; font-size: 12.5px; font-weight: 500; color: var(--muted); padding: 7px 12px; border-radius: 7px; cursor: pointer; }
    .view-toggle button.on { background: var(--ink); color: var(--card); }
    .pill-count { font-size: 10.5px; background: rgba(0,0,0,.12); padding: 1px 6px; border-radius: 999px; margin-left: 4px; }
    .view-toggle button.on .pill-count { background: rgba(255,255,255,.2); }
    .search-wrap { position: relative; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 11px; color: var(--muted); }
    .search-wrap:focus-within { border-color: var(--gold); }
    .search { border: none; background: transparent; outline: none; font-family: inherit; font-size: 13px; color: var(--ink); width: 100%; }
    .clear { border: none; background: none; color: var(--muted); cursor: pointer; display: flex; }
    .seg { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; flex-wrap: wrap; }
    .seg button { border: none; background: none; font-family: inherit; font-size: 11.5px; font-weight: 500; color: var(--muted); padding: 6px 10px; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
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
    .status-pill.danger   { color: #c0392b; background: rgba(192,57,43,.10); }
    .status-pill.unlisted { color: #7a3b8f; background: rgba(122,59,143,.10); }
    .status-pill.mismatch { color: #a86f10; background: rgba(201,138,26,.14); }
    .status-pill.out      { color: #7a5230; background: rgba(122,82,48,.10); }
    .status-pill.crit     { color: #b56a15; background: rgba(217,131,36,.12); }
    .status-pill.low      { color: #9a7d1e; background: rgba(224,184,76,.16); }
    .status-pill.ok       { color: #3d8262; background: rgba(75,158,122,.12); }

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

  /* store pulse row */
.pulse-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.pulse-card { position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); overflow: hidden; }
.pulse-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.pulse-dot-wrap { position: relative; width: 10px; height: 10px; display: inline-block; }
.pulse-dot { position: absolute; inset: 0; border-radius: 50%; transition: background 200ms; }
.pulse-dot.on { animation: dotBeat 1.4s ease-in-out infinite; }
.pulse-ring { position: absolute; inset: -4px; border: 2px solid; border-radius: 50%; animation: dotRing 1.4s ease-out infinite; }
@keyframes dotBeat { 0%,100% { transform: scale(1); } 50% { transform: scale(1.35); } }
@keyframes dotRing { 0% { transform: scale(0.6); opacity: 0.9; } 100% { transform: scale(2.4); opacity: 0; } }
.pulse-label { font-size: 12px; font-weight: 600; color: var(--ink); flex: 1; }
.pulse-ago { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pulse-big { font-size: 26px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.pulse-meta { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--muted); }
.pulse-events { display: inline-flex; align-items: center; gap: 3px; color: var(--gold-deep); font-weight: 600; }

/* activity + ticker grid */
.live-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
@media (max-width: 900px) { .live-grid { grid-template-columns: 1fr; } }

/* activity chart */
.activity { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 8px; min-height: 220px; }
.activity-head { display: flex; justify-content: space-between; align-items: baseline; }
.activity-title { font-size: 12.5px; font-weight: 600; }
.activity-total { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.activity-bars { display: grid; grid-template-columns: repeat(16, 1fr); gap: 3px; align-items: end; height: 22rem; }
.activity-col { height: 100%; display: flex; align-items: end; }
.activity-stack { width: 100%; min-height: 2px; display: flex; flex-direction: column-reverse; border-radius: 3px; overflow: hidden; transition: height 400ms ease; }
.activity-legend { display: flex; gap: 12px; font-size: 10.5px; color: var(--muted); flex-wrap: wrap; }
.al { display: inline-flex; align-items: center; gap: 4px; }
.al i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

/* ticker */
.ticker { border: 1px solid var(--line); border-radius: 12px; background: #0f0d0a; color: #e8e2d5; overflow: hidden; display: flex; flex-direction: column; min-height: 220px; }
.ticker-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid #26221c; }
.ticker-title { font-size: 12px; font-weight: 600; }
.ticker-live { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: #6a6255; }
.ticker-live.on { color: #7ad19d; }
.ticker-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #6a6255; }
.ticker-live.on .ticker-live-dot { background: #7ad19d; animation: dotBeat 1.4s ease-in-out infinite; }
.ticker-list { list-style: none; margin: 0; padding: 0; max-height: 400px; overflow-y: auto; flex: 1; }
.ticker-row { display: grid; grid-template-columns: 70px 50px 1fr auto; align-items: center; gap: 10px; padding: 7px 14px; font-size: 11.5px; cursor: pointer; border-bottom: 1px solid #1a1712; transition: background 200ms; }
.ticker-row:hover { background: #1a1712; }
.ticker-row.flash { animation: rowFlash 900ms ease-out; }
@keyframes rowFlash {
  0%   { background: rgba(122, 209, 157, 0.28); box-shadow: inset 3px 0 0 #7ad19d; }
  100% { background: transparent; box-shadow: inset 3px 0 0 transparent; }
}
.ticker-time { font-family: monospace; color: #6a6255; font-size: 10.5px; }
.ticker-source { display: inline-flex; justify-content: center; padding: 2px 6px; border-radius: 4px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; }
.ticker-sku { font-family: monospace; font-size: 11px; color: #e8e2d5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ticker-what { font-size: 10.5px; color: #a8a091; text-align: right; }
.ticker-empty { padding: 40px 20px; text-align: center; color: #6a6255; display: flex; flex-direction: column; gap: 6px; }
.ticker-empty-sub { font-size: 10.5px; }

/* drift */
.drift { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); }
.drift-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.drift-title { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.drift-count { background: #c0392b; color: white; padding: 1px 8px; border-radius: 999px; font-size: 11px; }
.drift-sub { font-size: 11.5px; color: var(--muted); }
.drift-empty { padding: 20px; text-align: center; color: #4b9e7a; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.drift-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.drift-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; transition: background 150ms; }
.drift-row:hover { background: var(--gold-wash); }
.drift-sku-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.drift-name { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drift-cells { display: flex; gap: 6px; }
.drift-pill { font-size: 10.5px; padding: 3px 8px; border-radius: 6px; background: var(--gold-wash); color: var(--gold-deep); font-variant-numeric: tabular-nums; }
.drift-pill.zoho { background: rgba(138,98,64,0.14); color: #8a6240; }
.drift-pill.off { background: rgba(192,57,43,0.10); color: #c0392b; font-weight: 600; }
.drift-pill em { font-style: normal; margin-left: 4px; font-size: 9.5px; }
.drift-btn { border: none; background: var(--ink); color: var(--card); font-size: 11px; font-weight: 600; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
.drift-btn:disabled { opacity: 0.5; cursor: default; }

/* clickable matrix rows */
.matrix tbody tr.clickable { cursor: pointer; }

/* drawer */
.drawer-scrim { position: fixed; inset: 0; background: rgba(15,13,10,0.4); z-index: 40; animation: fadeIn 200ms; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 480px; max-width: 92vw; background: var(--card); border-left: 1px solid var(--line); z-index: 41; padding: 20px 24px; overflow-y: auto; animation: slideIn 260ms cubic-bezier(0.2, 0.8, 0.2, 1); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.drawer-sku { font-size: 18px; font-weight: 600; }
.drawer-name { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.drawer-close { border: none; background: none; cursor: pointer; padding: 6px; color: var(--muted); }
.drawer-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 40px; color: var(--muted); }
.drawer-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px; }
.drawer-cell { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.drawer-cell.zoho { background: rgba(138,98,64,0.06); border-color: rgba(138,98,64,0.2); }
.drawer-cell.off { background: rgba(192,57,43,0.05); border-color: rgba(192,57,43,0.2); }
.drawer-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
.drawer-cell b { font-size: 22px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.drawer-cell em { font-style: normal; font-size: 10.5px; color: var(--muted); }
.drawer-push { width: 100%; padding: 10px; border: none; background: var(--ink); color: var(--card); font-size: 12.5px; font-weight: 600; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 20px; }
.drawer-push:disabled { opacity: 0.5; cursor: default; }
.drawer-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700; margin-bottom: 8px; }
.drawer-events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.drawer-events li { display: grid; grid-template-columns: 60px 50px 1fr; gap: 8px; padding: 6px 0; font-size: 11.5px; border-bottom: 1px solid var(--line); }
.drawer-evt-time { font-family: monospace; color: var(--muted); font-size: 10.5px; }
.drawer-evt-src { font-size: 10px; font-weight: 700; color: var(--gold-deep); }
.drawer-evt-what { color: var(--ink); }
.drawer-evt-empty { color: var(--muted); text-align: center; padding: 20px; grid-column: 1 / -1; }


`;
