// "use client";

// /* ───────────────────────────────────────────────────────────────────────────
//    Omnia Finance OS — bank-first finance workspace.

//    Bank is the only source of truth. Every reconciliation row proves a chain:
//        BANK CREDIT ──► PAYOUT FILE ──► ORDERS
//    A link is either resolved (gold) or broken (muted/red). An order is only
//    "Settled" when the whole chain resolves. Confirm is gated to the Founder.

//    All data comes from Supabase-backed API routes:
//      GET  /api/reconcile        — recompute + return chain lines
//      GET  /api/orders           — normalized orders with finance status
//      POST /api/sync             — pull Shopify (WA/UAE/KSA) + Woo into Supabase
//      POST /api/upload/bank      — parse bank statement, any bank (PDF/CSV/TXT)
//      POST /api/upload/payout    — parse payout file (Telr xls, Stripe csv, …)
//      POST /api/reconcile/confirm
//    ─────────────────────────────────────────────────────────────────────────── */

// import {
//   Landmark, FileSpreadsheet, Package, ArrowRight, Check, AlertTriangle,
//   Clock, HelpCircle, Upload, ShieldCheck, ChevronDown, Lock, BadgeCheck,
//   RefreshCcw, Loader2, LayoutDashboard, ChartNoAxesCombined, PackageSearch,
//   WalletCards, FolderOpen, RotateCcw, FileChartColumn, Settings, Megaphone, Boxes, Users,
// } from "lucide-react";
// import Link from "next/link";
// import { usePathname } from "next/navigation";
// import { useCallback, useEffect, useRef, useState } from "react";
// import { toast } from "sonner";
// import { FounderDashboard } from "@/components/finance/dashboard-v2/founder-dashboard";
// import { StoreChat } from "@/components/finance/store-chat";
// import { DocumentsPanel } from "@/components/finance/documents-panel";
// import { ReportsPanel } from "@/components/finance/reports-panel";
// import { MarketingPanel } from "@/components/finance/marketing-panel";
// import { InventoryPanel } from "@/components/finance/inventory-panel";
// import { OrdersLedger } from "@/components/finance/orders-ledger";
// import { CustomersPanel } from "@/components/finance/customers-panel";
// import { ReconView } from "@/components/finance/reconciliation/recon-view";
// import { ZohoSettingsPanel } from "@/components/finance/reconciliation/zoho-settings-panel";
// import type { ReconPayload } from "@/components/finance/reconciliation/types";

// export type FinanceView =
//   | "dashboard" | "sales" | "orders" | "reconciliation"
//   | "payouts" | "documents" | "returns" | "reports" | "marketing" | "inventory" | "customers" | "settings";

// const NAV: { href: string; view: FinanceView; label: string; icon: React.ElementType }[] = [
//   { href: "/", view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
//   // { href: "/sales", view: "sales", label: "Sales", icon: ChartNoAxesCombined },
//   { href: "/orders", view: "orders", label: "Orders", icon: PackageSearch },
//   { href: "/reconciliation", view: "reconciliation", label: "Reconciliation", icon: RefreshCcw },
//   { href: "/payouts", view: "payouts", label: "Payouts", icon: WalletCards },
//   { href: "/documents", view: "documents", label: "Bank actuals", icon: FolderOpen },
//   { href: "/returns", view: "returns", label: "Returns", icon: RotateCcw },
//   // { href: "/reports", view: "reports", label: "Reports", icon: FileChartColumn },
//   { href: "/marketing", view: "marketing", label: "Marketing", icon: Megaphone },
//   { href: "/inventory", view: "inventory", label: "Inventory", icon: Boxes },
//   { href: "/customers", view: "customers", label: "Customers", icon: Users },
//   { href: "/settings", view: "settings", label: "Settings", icon: Settings },
// ];

// const aed = (v: number) =>
//   new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
// const aed2 = (v: number) =>
//   new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

// /* ── Upload button (bank statement or payout file) ──────────────────────── */

// function UploadButton({ endpoint, extraFields, accept, label, onDone, ghost }: {
//   endpoint: string;
//   extraFields?: Record<string, string>;
//   accept: string;
//   label: string;
//   onDone: () => void;
//   ghost?: boolean;
// }) {
//   const input = useRef<HTMLInputElement>(null);
//   const [busy, setBusy] = useState(false);

//   const upload = async (file?: File) => {
//     if (!file) return;
//     setBusy(true);
//     try {
//       const form = new FormData();
//       form.append("file", file);
//       for (const [k, v] of Object.entries(extraFields ?? {})) form.append(k, v);
//       const res = await fetch(endpoint, { method: "POST", body: form });
//       const json = await res.json();
//       if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
//       toast.success(
//         json.batchId
//           ? `${json.credits} credits + ${json.debits} debits parsed (${json.inserted} new` +
//             (json.updated ? `, ${json.updated} corrected` : "") +
//             ")"
//           : `Payout saved: ${json.payouts?.map((p: { id: string }) => p.id).join(", ")}`,
//       );
//       onDone();
//     } catch (e) {
//       toast.error((e as Error).message);
//     } finally {
//       setBusy(false);
//       if (input.current) input.current.value = "";
//     }
//   };

//   return (
//     <>
//       <button className={`btn ${ghost ? "ghost" : ""}`} disabled={busy} onClick={() => input.current?.click()}>
//         {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {label}
//       </button>
//       <input ref={input} type="file" className="hidden-input" accept={accept}
//         onChange={(e) => upload(e.target.files?.[0])} />
//     </>
//   );
// }

// /* ── Workspace ──────────────────────────────────────────────────────────── */

// const VIEW_META: Record<FinanceView, { title: string; sub: string }> = {
//   dashboard: { title: "Financial command centre", sub: "One bank-grounded view of settlements and cash exposure across all four Omnia stores." },
//   sales: { title: "Sales intelligence", sub: "Unified sales across WhatsApp, Shopify UAE, Shopify KSA, and WooCommerce." },
//   orders: { title: "Order ledger", sub: "Every order traced from checkout through payout file and bank settlement." },
//   reconciliation: { title: "Bank reconciliation", sub: "Bank is the only source of truth. Every credit must be explained by a payout file, and every payout must resolve to real orders before it counts as settled." },
//   payouts: { title: "Gateway payouts", sub: "Settlement batches from every payment provider, linked to bank-confirmed credits." },
//   documents: { title: "Bank actuals", sub: "Every bank statement and gateway payout file ever uploaded — upload here, or download exactly what was ingested." },
//   returns: { title: "Returns monitor", sub: "Returns and refund exposure." },
//   reports: { title: "Finance reports", sub: "Founder-ready settlement packs." },
//   marketing: { title: "Marketing performance", sub: "Ad spend and conversions from Meta, Google, TikTok, and Snapchat, next to actual store revenue for each store." },
//   inventory: { title: "Inventory sync", sub: "Zoho's authoritative stock next to live Shopify and WooCommerce quantities, plus recent orders missing from Zoho." },
//   customers: { title: "Customers", sub: "Every customer ranked by lifetime spend across all stores, with full cross-store order history, expected LTV, and blended acquisition cost." },
//   settings: { title: "Workspace settings", sub: "Stores, gateways, and reporting preferences." },
// };

// export function FinanceWorkspace({ view = "reconciliation" }: { view?: FinanceView }) {
//   const pathname = usePathname();
//   const [isFounder, setIsFounder] = useState(true);
//   const [recon, setRecon] = useState<ReconPayload | null>(null);
//   const [loading, setLoading] = useState(true);
//   const [syncing, setSyncing] = useState(false);
//   const [tab, setTab] = useState("all");
//   const [dashVersion, setDashVersion] = useState(0);
//   // Date-range filter for the reconciliation view + export — bank credit
//   // matching still runs over ALL data (a payout can straddle the boundary),
//   // only the displayed/exported lines are scoped to the window.
//   const [fromDate, setFromDate] = useState("");
//   const [toDate, setToDate] = useState("");

//   const refresh = useCallback(async () => {
//     setDashVersion((v) => v + 1);
//     try {
//       const params = new URLSearchParams();
//       if (fromDate) params.set("from", fromDate);
//       if (toDate) params.set("to", toDate);
//       const qs = params.toString();
//       const r = await fetch(`/api/reconcile${qs ? `?${qs}` : ""}`).then((x) => x.json());
//       if (r.error) throw new Error(r.error);
//       setRecon(r);
//     } catch (e) {
//       toast.error(`Load failed: ${(e as Error).message}`);
//     } finally {
//       setLoading(false);
//     }
//   }, [fromDate, toDate]);

//   // Bank credits and order status change as the persistent payout-sync
//   // scheduler runs — poll so a founder watching this view sees settlements
//   // land without needing to hit "Sync stores" themselves.
//   useEffect(() => {
//     refresh();
//     const id = setInterval(refresh, 60_000);
//     return () => clearInterval(id);
//   }, [refresh]);

//   const sync = async () => {
//     setSyncing(true);
//     try {
//       const res = await fetch("/api/sync", { method: "POST", body: JSON.stringify({}) });
//       const json = await res.json();
//       for (const r of json.results ?? []) {
//         if (r.error) toast.error(`${r.store}: ${r.error}`);
//         else toast.success(`${r.store}: ${r.fetched} orders synced`);
//       }
//       await refresh();
//     } catch (e) {
//       toast.error((e as Error).message);
//     } finally {
//       setSyncing(false);
//     }
//   };

//   const onConfirm = async (bankLineId: string) => {
//     const res = await fetch("/api/reconcile/confirm", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ bankLineId, actor: "founder" }),
//     });
//     if (res.ok) { toast.success("Settlement confirmed"); refresh(); }
//     else toast.error("Confirm failed");
//   };

//   const lines = recon?.lines ?? [];
//   const settled = lines.filter((r) => r.state === "SETTLED");
//   const buckets = {
//     awaiting: lines.filter((r) => r.state === "AWAITING_PAYOUT"),
//     variance: lines.filter((r) => r.state === "PAYOUT_VARIANCE"),
//     unresolved: lines.filter((r) => r.state === "ORDERS_UNRESOLVED"),
//   };
//   const sum = (arr: { bankAmount: number }[]) => arr.reduce((s, r) => s + r.bankAmount, 0);

//   const showOrders = view === "orders" || view === "sales";
//   const showDashboard = view === "dashboard";
//   const showDocuments = view === "documents";
//   const showReports = view === "reports";
//   const showMarketing = view === "marketing";
//   const showInventory = view === "inventory";
//   const showCustomers = view === "customers";
//   // The bank-settlement KPI bar and document checklist below belong to the
//   // reconciliation chain (bank → payout → orders) — showing them on pages
//   // with their own contextual metrics (marketing spend, inventory mismatch
//   // counts, report totals) is noise, not "each page's own view of metrics".
//   const showReconContext = view === "reconciliation" || view === "orders" || view === "sales" || view === "payouts" || view === "returns";
//   const meta = VIEW_META[view] ?? VIEW_META.reconciliation;

//   return (
//     <div className="wrap">
//       <style>{CSS}</style>

//       <nav className="topnav" aria-label="Finance navigation">
//         {NAV.map((n) => (
//           <Link key={n.href} href={n.href} className={pathname === n.href ? "topnav-item on" : "topnav-item"}>
//             <n.icon size={13} />{n.label}
//           </Link>
//         ))}
//       </nav>


//       {/* {view !=="orders"&&(
//          */}
//         <header className="top">
//         <div>
//           {/* <p className="eyebrow">{meta.title}</p> */}
//           {/* <h1>{meta.title}</h1> */}
//           {/* <p className="sub">{meta.sub}</p> */}
//         </div>
//         <div className="top-right">
//           {/* <div className="role">
//             <span className="role-label">Viewing as</span>
//             <div className="role-switch">
//               <button className={isFounder ? "on" : ""} onClick={() => setIsFounder(true)}>Founder</button>
//               <button className={!isFounder ? "on" : ""} onClick={() => setIsFounder(false)}>Operator</button>
//             </div>
//           </div> */}
//           <div className="top-actions fixed top-6">
//             <button className="btn" disabled={syncing} onClick={sync}>
//               {syncing ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />} Sync stores
//             </button>
//             {view === "reconciliation" && (
//               <>
//                 {/* Export follows the same range the view is scoped to — the
//                     filter bar below owns those dates now. */}
//                 <a className="btn ghost" href={`/api/reconcile/export${(() => {
//                   const p = new URLSearchParams();
//                   if (fromDate) p.set("from", fromDate);
//                   if (toDate) p.set("to", toDate);
//                   const qs = p.toString();
//                   return qs ? `?${qs}` : "";
//                 })()}`}>
//                   <FileChartColumn size={14} /> Export
//                 </a>
//                 <UploadButton endpoint="/api/upload/bank" accept=".pdf,.csv,.txt,.xls,.xlsx"
//                   label="Upload bank statement" onDone={refresh} />
//               </>
//             )}
//           </div>
//         </div>
//       </header>
//           {/* )} */}

//       {showReconContext && view !== "reconciliation" && (
//         <div className="range-bar">
//           <label>From <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} /></label>
//           <label>To <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} /></label>
//           {(fromDate || toDate) && (
//             <button className="btn ghost" onClick={() => { setFromDate(""); setToDate(""); }}>Clear range</button>
//           )}
//           <a className="btn ghost" href={`/api/reconcile/export${(() => {
//             const p = new URLSearchParams();
//             if (fromDate) p.set("from", fromDate);
//             if (toDate) p.set("to", toDate);
//             const qs = p.toString();
//             return qs ? `?${qs}` : "";
//           })()}`}>
//             <FileChartColumn size={14} /> Export reconciliation
//           </a>
//         </div>
//       )}

//       {/* Document checklist — what's missing before things can settle */}
//       {showReconContext && recon &&   (
//         !recon.documents.bankStatement ||
//         recon.documents.missingPayouts.length > 0 ||
//         recon.documents.range?.noStatementForRange 
//       ) && (
//         <div className="docs">
//           <span className="docs-title"><FileSpreadsheet size={13} /> Documents required</span>
//           {!recon.documents.bankStatement && (
//             <span className="doc-chip bad">✕ Bank statement — upload the daily statement (PDF or CSV, any bank) to start</span>
//           )}
//           {recon.documents.range?.noStatementForRange && (
//             <span className="doc-chip bad">
//               ✕ No bank statement covers {recon.documents.range.from ?? "the start"} → {recon.documents.range.to ?? "the end"} —
//               upload that period's statement, or widen the range
//             </span>
//           )}
//           {recon.documents.missingPayouts.map((d) => (
//             <span key={d.provider} className="doc-chip warn">
//               ✕ {d.provider} payout file · {aed(d.awaitingAmount)} waiting to be explained
//             </span>
//           ))}
//           {recon.documents.bankStatement && recon.documents.missingPayouts.length === 0 && !recon.documents.range?.noStatementForRange && (
//             <span className="doc-chip ok">✓ All documents present</span>
//           )}
//         </div>
//       )}

//       {showReconContext && view !=="orders"&& (
//         <div className="kpis">
//           <Kpi label="Bank-confirmed settled" value={aed(sum(settled))} note={`${settled.length} of ${lines.length} credit lines`} tone="ok" />
//           <Kpi label="Awaiting payout file" value={aed(sum(buckets.awaiting))} note={`${buckets.awaiting.length} lines · money in transit`} tone="info" />
//           <Kpi label="Orders settled" value={`${recon?.settledOrders ?? 0} / ${recon?.totalOrders ?? 0}`} note="stamped by bank-confirmed payouts" tone="ok" />
//           <Kpi label="Exceptions" value={String(buckets.variance.length + buckets.unresolved.length)} note="variance or unresolved orders" tone={buckets.variance.length + buckets.unresolved.length ? "bad" : "muted"} />
//         </div>
//       )}

//       {showDashboard ? (
//         <FounderDashboard version={dashVersion} />
//       ) : showDocuments ? (
//         <DocumentsPanel version={dashVersion} onDone={refresh} />
//       ) : showReports ? (
//         <ReportsPanel version={dashVersion} />
//       ) : showMarketing ? (
//         <MarketingPanel />
//       ) : showInventory ? (
//         <InventoryPanel />
//       ) : showCustomers ? (
//         <CustomersPanel />
//       ) : showOrders ? (
//         <OrdersLedger />
//       ) : view === "settings" ? (
//         <ZohoSettingsPanel />
//       ) : (
//         <ReconView
//           recon={recon}
//           loading={loading}
//           isFounder={isFounder}
//           fromDate={fromDate}
//           toDate={toDate}
//           onRange={(f, t) => { setFromDate(f); setToDate(t); }}
//           onConfirm={onConfirm}
//           refresh={refresh}
//           uploadSlotFor={(provider) => (
//             <UploadButton
//               ghost
//               endpoint="/api/upload/payout"
//               extraFields={{ provider }}
//               accept=".csv,.xls,.xlsx"
//               label={`Upload ${provider} payout file`}
//               onDone={refresh}
//             />
//           )}
//         />
//       )}

//       <footer className="foot">
//         <ShieldCheck size={14} />
//         Parsing and matching run server-side. This surface is for review and confirmation — the bank line is truth,
//         everything else must earn its place against it.
//       </footer>

//       <StoreChat />
//     </div>
//   );
// }

// function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
//   return (
//     <div className={`kpi ${tone}`}>
//       <span className="kpi-label">{label}</span>
//       <span className="kpi-value">{value}</span>
//       <span className="kpi-note">{note}</span>
//     </div>
//   );
// }

// const CSS = `
//   .wrap {
//     --cream: #FBF8F1; --card: #FFFFFF; --ink: #1F1B16; --muted: #8A8175;
//     --line: #EAE3D6; --line-strong: #D6CCBA;
//     --gold: #B08343; --gold-deep: #6F5325; --gold-wash: #FBF3E6;
//     --ok: #4B7A54; --ok-wash: #F0F5EF;
//     --warn: #B0742E; --warn-wash: #FBF2E6;
//     --info: #2E6B7A; --info-wash: #E8F1F3;
//     --bad: #A6472F; --bad-wash: #F9ECE7;
//     font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
//     color: var(--ink); background: var(--cream);
//     padding: 32px; padding-bottom: 110px; max-width: 1320px; margin: 0 auto; min-height: 100vh;
//   }
//   .wrap * { box-sizing: border-box; }
//   .topnav { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
//   .topnav-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); text-decoration: none; padding: 6px 11px; border-radius: 999px; font-weight: 500; }
//   .topnav-item:hover { background: var(--gold-wash); color: var(--gold-deep); }
//   .topnav-item.on { background: var(--ink); color: var(--cream); }
//   .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap; }
//   .eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--gold); margin: 0 0 8px; font-weight: 600; }
//   h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; font-size: 34px; margin: 0; letter-spacing: -.01em; }
//   .sub { color: var(--muted); font-size: 14px; max-width: 620px; margin: 10px 0 0; line-height: 1.5; }
//   .top-right { display: flex; flex-direction: column; gap: 12px; align-items: flex-end; }
//   .top-actions { display: flex; gap: 8px; }
//   .role { text-align: right; }
//   .role-label { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); display: block; margin-bottom: 6px; }
//   .role-switch { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 10px; overflow: hidden; background: var(--card); }
//   .role-switch button { border: 0; background: transparent; padding: 8px 16px; font-size: 13px; cursor: pointer; color: var(--muted); font-weight: 500; }
//   .role-switch button.on { background: var(--ink); color: var(--cream); }

//   .docs { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 22px; padding: 12px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
//   .docs-title { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 600; }
//   .doc-chip { font-size: 12px; padding: 5px 11px; border-radius: 999px; font-weight: 500; }
//   .doc-chip.bad { background: var(--bad-wash); color: var(--bad); }
//   .doc-chip.warn { background: var(--warn-wash); color: var(--warn); }
//   .doc-chip.ok { background: var(--ok-wash); color: var(--ok); }
//   .doc-chip.info { background: var(--info-wash); color: var(--info); }

//   .range-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 22px; }
//   .range-bar label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); font-weight: 500; }
//   .range-bar input[type="date"] { border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px 9px; font-size: 12.5px; background: var(--card); color: var(--ink); }
//   .range-bar .btn { padding: 7px 12px; font-size: 12.5px; text-decoration: none; }

//   .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 22px 0; }
//   .kpi { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 6px; }
//   .kpi-label { font-size: 12px; color: var(--muted); }
//   .kpi-value { font-family: Georgia, serif; font-size: 26px; }
//   .kpi-note { font-size: 11px; color: var(--muted); }
//   .kpi.ok .kpi-value { color: var(--ok); } .kpi.bad .kpi-value { color: var(--bad); } .kpi.warn .kpi-value { color: var(--warn); }
//   .kpi.info .kpi-value { color: var(--info); }

//   .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
//   .tab { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 7px 15px; font-size: 13px; cursor: pointer; color: var(--muted); display: inline-flex; align-items: center; gap: 7px; }
//   .tab.on { background: var(--ink); color: var(--cream); border-color: var(--ink); }
//   .tab .count { font-size: 11px; background: rgba(0,0,0,.08); border-radius: 999px; padding: 1px 7px; }
//   .tab.on .count { background: rgba(255,255,255,.18); }

//   .legend { display: flex; gap: 18px; align-items: center; font-size: 11.5px; color: var(--muted); margin-bottom: 14px; flex-wrap: wrap; }
//   .legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; margin-right: 5px; vertical-align: -1px; }
//   .legend-chain { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; }

//   .rows { display: flex; flex-direction: column; gap: 10px; }
//   .row { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; transition: border-color .15s; }
//   .row.ok { border-left: 3px solid var(--ok); } .row.bad { border-left: 3px solid var(--bad); }
//   .row.warn { border-left: 3px solid var(--warn); } .row.muted { border-left: 3px solid var(--line-strong); }
//   .row.info { border-left: 3px solid var(--info); }
//   .row-head { width: 100%; border: 0; background: transparent; cursor: pointer; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; gap: 20px; text-align: left; }

//   .chain { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; }
//   .link { display: flex; align-items: center; gap: 8px; border: 1px solid; border-radius: 10px; padding: 7px 11px; min-width: 0; }
//   .link-txt { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
//   .link-txt span:first-child { font-size: 13px; font-weight: 600; white-space: nowrap; }
//   .link-txt span:last-child { font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; }

//   .row-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
//   .provider { font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
//   .conf { font-style: normal; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--warn); background: var(--warn-wash); padding: 2px 6px; border-radius: 5px; }
//   .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 10px; border-radius: 999px; font-weight: 500; }
//   .pill.ok { background: var(--ok-wash); color: var(--ok); } .pill.bad { background: var(--bad-wash); color: var(--bad); }
//   .pill.warn { background: var(--warn-wash); color: var(--warn); } .pill.muted { background: #F3EFE7; color: var(--muted); }
//   .pill.info { background: var(--info-wash); color: var(--info); }
//   .chev { color: var(--muted); transition: transform .15s; }

//   .row-body { padding: 4px 18px 18px; border-top: 1px solid var(--line); }
//   .narr { font-size: 12.5px; color: var(--muted); margin: 12px 0 14px; font-family: ui-monospace, monospace; }
//   .detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
//   .detail-grid > div { display: flex; flex-direction: column; gap: 3px; }
//   .detail-grid span { font-size: 11px; color: var(--muted); } .detail-grid b { font-size: 14px; font-weight: 600; }
//   .note { font-size: 13px; line-height: 1.5; padding: 11px 14px; border-radius: 10px; margin-bottom: 14px; }
//   .note.bad { background: var(--bad-wash); color: var(--bad); } .note.muted { background: #F3EFE7; color: var(--gold-deep); }
//   .note.info { background: var(--info-wash); color: var(--gold-deep); }
//   .note.ok { background: var(--ok-wash); color: var(--ok); }

//   .stripe-proof { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; background: var(--cream); }
//   .proof-head { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--gold-deep); font-weight: 600; margin-bottom: 10px; }
//   .proof-head svg { color: var(--gold); }
//   .proof-sub { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--muted); font-size: 11px; margin-left: 4px; }
//   .proof-verdict { font-size: 13px; line-height: 1.55; color: var(--ink); margin: 0 0 8px; }
//   .proof-verdict b { font-variant-numeric: tabular-nums; }
//   .proof-toggle { background: none; border: 0; padding: 0; font: inherit; font-size: 12px; color: var(--gold-deep); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
//   .proof-loading { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; }
//   .proof-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
//   .proof-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--line); }
//   .proof-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); }
//   .proof-table tr:last-child td { border-bottom: 0; }
//   .proof-table .r { text-align: right; }
//   .proof-table tr.refund td { color: var(--muted); }
//   .proof-table tfoot td { border-top: 1px solid var(--line-strong); border-bottom: 0; padding-top: 8px; color: var(--gold-deep); }

//   .row-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
//   .btn { display: inline-flex; align-items: center; gap: 7px; border-radius: 9px; padding: 9px 15px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); }
//   .btn:disabled { opacity: .6; cursor: wait; }
//   .btn.primary { background: var(--gold); border-color: var(--gold); color: #fff; }
//   .btn.ghost { background: transparent; }
//   .btn.locked { background: #F3EFE7; color: var(--muted); border-style: dashed; cursor: not-allowed; }
//   .btn.small { padding: 6px 12px; font-size: 12px; }
//   .confirmed-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ok); font-weight: 500; }
//   .hidden-input { display: none; }
//   .spin { animation: spin 1s linear infinite; }
//   @keyframes spin { to { transform: rotate(360deg); } }

//   .empty { background: var(--card); border: 1px dashed var(--line-strong); border-radius: 14px; padding: 40px; text-align: center; color: var(--muted); font-size: 14px; line-height: 1.6; display: flex; gap: 10px; align-items: center; justify-content: center; }

//   .filters { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
//   .search { flex: 1; min-width: 220px; border: 1px solid var(--line); border-radius: 10px; padding: 9px 14px; font-size: 13px; background: var(--card); color: var(--ink); outline: none; }
//   .search:focus { border-color: var(--gold); }
//   .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow-x: auto; }
//   table { width: 100%; border-collapse: collapse; font-size: 13px; }
//   th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; padding: 12px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
//   td { padding: 11px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
//   tr:last-child td { border-bottom: 0; }
//   .mono { font-family: ui-monospace, monospace; font-size: 12.5px; }
//   .store-badge { font-size: 11px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 2px 7px; color: var(--muted); font-weight: 600; }
//   .tick { color: var(--ok); } .cross { color: var(--line-strong); font-size: 12px; }
//   .table-note { font-size: 12px; color: var(--muted); margin-top: 10px; }

//   .foot { display: flex; gap: 9px; align-items: flex-start; font-size: 12px; color: var(--muted); margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--line); line-height: 1.5; }
//   .foot svg { flex-shrink: 0; margin-top: 1px; color: var(--gold); }

//   @media (max-width: 900px) {
//     .kpis { grid-template-columns: repeat(2, 1fr); }
//     .chain { flex-wrap: wrap; }
//     .row-head { flex-direction: column; align-items: flex-start; }
//     .detail-grid { grid-template-columns: repeat(2, 1fr); }
//     .legend-chain { margin-left: 0; }
//     .top-right { align-items: flex-start; }
//   }
// `;


"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Omnia Finance OS — bank-first finance workspace.

   Bank is the only source of truth. Every reconciliation row proves a chain:
       BANK CREDIT ──► PAYOUT FILE ──► ORDERS
   Verified state earns the gold. Everything else stays quiet.

   Layout: dark warm sidebar (infrastructure) + cream content (data).
   ─────────────────────────────────────────────────────────────────────────── */

import {
  FileSpreadsheet, Upload, ShieldCheck, ChevronRight, CheckCircle2,
  RefreshCcw, Loader2, LayoutDashboard, PackageSearch,
  WalletCards, FolderOpen, RotateCcw, FileChartColumn, Settings, Megaphone, Boxes, Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FounderDashboard } from "@/components/finance/dashboard-v2/founder-dashboard";
import { StoreChat } from "@/components/finance/store-chat";
import { DocumentsPanel } from "@/components/finance/documents-panel";
import { ReportsPanel } from "@/components/finance/reports-panel";
import { MarketingPanel } from "@/components/finance/marketing-panel";
import { InventoryPanel } from "@/components/finance/inventory-panel";
import { OrdersLedger } from "@/components/finance/orders-ledger";
import { CustomersPanel } from "@/components/finance/customers-panel";
import { ReconView } from "@/components/finance/reconciliation/recon-view";
import { ZohoSettingsPanel } from "@/components/finance/reconciliation/zoho-settings-panel";
import type { ReconPayload } from "@/components/finance/reconciliation/types";

export type FinanceView =
  | "dashboard" | "sales" | "orders" | "reconciliation"
  | "payouts" | "documents" | "returns" | "reports" | "marketing" | "inventory" | "customers" | "settings";

/* ── Nav config ─────────────────────────────────────────────────────────── */

type NavChild = { href: string; label: string };
type NavItem = {
  href: string;
  view: FinanceView;
  label: string;
  icon: React.ElementType;
  children?: NavChild[];
};

// Payouts demonstrates the nested-route pattern — one child per gateway.
// Child hrefs use a query param so no new route files are required.
// To flatten any item: delete its `children`. To nest another: add `children`.
const NAV: NavItem[] = [
  { href: "/", view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", view: "orders", label: "Orders", icon: PackageSearch },
  { href: "/reconciliation", view: "reconciliation", label: "Reconciliation", icon: RefreshCcw },
  {
    href: "/payouts", view: "payouts", label: "Payouts", icon: WalletCards,
    children: [
      { href: "/payouts?gateway=stripe",   label: "Stripe" },
      { href: "/payouts?gateway=telr",     label: "Telr" },
      { href: "/payouts?gateway=tabby",    label: "Tabby" },
      { href: "/payouts?gateway=tamara",   label: "Tamara" },
      { href: "/payouts?gateway=checkout", label: "Checkout" },
      { href: "/payouts?gateway=cod",      label: "COD" },
    ],
  },
  { href: "/documents", view: "documents", label: "Bank actuals", icon: FolderOpen },
  { href: "/returns", view: "returns", label: "Returns", icon: RotateCcw },
  { href: "/marketing", view: "marketing", label: "Marketing", icon: Megaphone },
  { href: "/inventory", view: "inventory", label: "Inventory", icon: Boxes },
  { href: "/customers", view: "customers", label: "Customers", icon: Users },
  { href: "/settings", view: "settings", label: "Settings", icon: Settings },
];

const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);

/* ── Shared button styles ───────────────────────────────────────────────── */

const btnBase =
  "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium " +
  "border transition-all duration-150 cursor-pointer whitespace-nowrap " +
  "disabled:opacity-50 disabled:cursor-wait";
const btnSolid =
  "bg-white border-[#D6CCBA] text-[#1F1B16] hover:bg-[#FBF3E6] hover:border-[#C4B896] " +
  "shadow-[0_1px_2px_rgba(31,27,22,0.04)]";
const btnGhost =
  "bg-transparent border-[#D6CCBA] text-[#4B453D] hover:bg-[#FBF3E6] hover:text-[#1F1B16] hover:border-[#C4B896]";

/* ── Upload button (bank statement or payout file) ──────────────────────── */

function UploadButton({ endpoint, extraFields, accept, label, onDone, ghost }: {
  endpoint: string;
  extraFields?: Record<string, string>;
  accept: string;
  label: string;
  onDone: () => void;
  ghost?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      for (const [k, v] of Object.entries(extraFields ?? {})) form.append(k, v);
      const res = await fetch(endpoint, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(
        json.batchId
          ? `${json.credits} credits + ${json.debits} debits parsed (${json.inserted} new` +
            (json.updated ? `, ${json.updated} corrected` : "") +
            ")"
          : `Payout saved: ${json.payouts?.map((p: { id: string }) => p.id).join(", ")}`,
      );
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <button
        className={`${btnBase} ${ghost ? btnGhost : btnSolid}`}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {label}
      </button>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => upload(e.target.files?.[0])}
      />
    </>
  );
}

/* ── Sidebar (dark warm ink, editorial serif brand, gold accents) ──────── */

function Sidebar({ pathname }: { pathname: string }) {
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({});

  const isChildActive = (item: NavItem) =>
    item.children?.some((c) => {
      const [base] = c.href.split("?");
      return pathname === c.href || pathname === base;
    });

  const isOpen = (item: NavItem) => {
    if (!item.children?.length) return false;
    if (item.href in expandedOverride) return expandedOverride[item.href];
    return pathname === item.href || pathname.startsWith(item.href + "/") || Boolean(isChildActive(item));
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 w-60 flex flex-col z-20 text-[#8B8478]"
      style={{
        backgroundImage: "linear-gradient(180deg, #1B1712 0%, #181510 40%, #14110D 100%)",
      }}
    >
      {/* Brand — editorial serif mark */}
      <div className="px-5 pt-7 pb-6 border-b border-[#2A251E]">
        <div className="flex flex-col leading-none">
          <span
            className="text-[22px] tracking-[0.24em] text-[#F5EFDF] font-normal italic"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            OMNIA
          </span>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-px w-4 bg-[#B08343]" aria-hidden />
            <span className="text-[9.5px] uppercase tracking-[0.24em] text-[#8B8478] font-semibold">
              Finance OS
            </span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav
        className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-0.5"
        aria-label="Finance navigation"
      >
        {NAV.map((item) => {
          const active = pathname === item.href;
          const hasChildren = Boolean(item.children?.length);
          const open = isOpen(item);
          const childHot = isChildActive(item);

          return (
            <div key={item.href} className="flex flex-col">
              <div className="relative flex items-center gap-0.5 group">
                {/* Gold left indicator on active */}
                {active && (
                  <span
                    aria-hidden
                    className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r bg-[#C99655]"
                  />
                )}
                <Link
                  href={item.href}
                  className={[
                    "flex-1 flex items-center gap-2.5 rounded-md px-3 py-[9px] text-[13px] transition-colors",
                    active
                      ? "bg-[#26221C] text-[#FBF8F1] font-medium"
                      : childHot
                      ? "text-[#C6BDA8] hover:bg-[#221E18]"
                      : "text-[#8B8478] hover:bg-[#221E18] hover:text-[#D6CCBA]",
                  ].join(" ")}
                >
                  <item.icon
                    size={14}
                    className={
                      active
                        ? "text-[#C99655]"
                        : childHot
                        ? "text-[#8B8478]"
                        : "text-[#5F594F] group-hover:text-[#8B8478]"
                    }
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>

                {hasChildren && (
                  <button
                    onClick={() =>
                      setExpandedOverride((prev) => ({ ...prev, [item.href]: !open }))
                    }
                    className="p-1.5 rounded text-[#5F594F] hover:bg-[#221E18] hover:text-[#8B8478] transition-colors"
                    aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
                  >
                    <ChevronRight
                      size={11}
                      className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                    />
                  </button>
                )}
              </div>

              {hasChildren && open && (
                <div className="ml-[26px] mt-1 mb-1.5 flex flex-col gap-0.5 border-l border-[#2A251E] pl-3">
                  {item.children!.map((child) => {
                    const childActive = pathname + (typeof window !== "undefined" ? window.location.search : "") === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={[
                          "px-2.5 py-1.5 rounded text-[12px] transition-colors truncate",
                          childActive
                            ? "bg-[#26221C] text-[#FBF8F1] font-medium"
                            : "text-[#6B655A] hover:text-[#C6BDA8] hover:bg-[#221E18]",
                        ].join(" ")}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer — bank-verified truth signature */}
      <div className="px-5 py-4 border-t border-[#2A251E] flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-full bg-[#26221C] border border-[#3B342A] flex items-center justify-center shrink-0">
          <ShieldCheck size={11} className="text-[#C99655]" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[10.5px] text-[#8B8478]">Bank-verified truth</span>
          <span className="text-[9px] uppercase tracking-[0.14em] text-[#5F594F] font-semibold">
            Server-side matching
          </span>
        </div>
      </div>
    </aside>
  );
}

/* ── KPI card ───────────────────────────────────────────────────────────── */

function Kpi({ label, value, note, tone }: {
  label: string; value: string; note: string;
  tone: "ok" | "bad" | "warn" | "info" | "muted";
}) {
  const accent = {
    ok:    { strip: "#4B7A54", value: "#3F6947", dot: "#4B7A54" },
    bad:   { strip: "#A6472F", value: "#8E3A25", dot: "#A6472F" },
    warn:  { strip: "#B0742E", value: "#8E5E21", dot: "#B0742E" },
    info:  { strip: "#2E6B7A", value: "#245868", dot: "#2E6B7A" },
    muted: { strip: "#D6CCBA", value: "#1F1B16", dot: "#B5AC98" },
  }[tone];

  return (
    <div
      className="relative bg-white rounded-2xl overflow-hidden border border-[#EAE3D6] transition-transform duration-200 hover:-translate-y-0.5"
      style={{
        boxShadow: "0 1px 2px rgba(31,27,22,0.04), 0 1px 0 rgba(31,27,22,0.03)",
      }}
    >
      {/* Top color strip categorizes without shouting */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ backgroundColor: accent.strip }}
      />
      <div className="px-5 pt-[18px] pb-5 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: accent.dot }}
          />
          <span className="text-[11px] uppercase tracking-[0.1em] text-[#8A8175] font-semibold">
            {label}
          </span>
        </div>
        <span
          className="text-[28px] leading-tight tabular-nums"
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: accent.value,
            fontWeight: 500,
          }}
        >
          {value}
        </span>
        <span className="text-[11.5px] text-[#8A8175] leading-snug">{note}</span>
      </div>
    </div>
  );
}

/* ── Document chip (pill for missing documents) ─────────────────────────── */

function DocChip({ tone, children }: {
  tone: "bad" | "warn" | "ok";
  children: React.ReactNode;
}) {
  const styles = {
    bad:  "bg-[#F9ECE7] text-[#8E3A25] border-[#F0D6CB]",
    warn: "bg-[#FBF2E6] text-[#8E5E21] border-[#EFD9B0]",
    ok:   "bg-[#F0F5EF] text-[#3F6947] border-[#D6E4D9]",
  }[tone];

  return (
    <span className={`text-[12px] px-3 py-[5px] rounded-full font-medium border inline-flex items-center gap-1.5 ${styles}`}>
      {tone === "ok" ? <CheckCircle2 size={11} /> : <span aria-hidden>✕</span>}
      {children}
    </span>
  );
}

/* ── Workspace ──────────────────────────────────────────────────────────── */

export function FinanceWorkspace({ view = "reconciliation" }: { view?: FinanceView }) {
  const pathname = usePathname();
  const [isFounder] = useState(true);
  const [recon, setRecon] = useState<ReconPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dashVersion, setDashVersion] = useState(0);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const refresh = useCallback(async () => {
    setDashVersion((v) => v + 1);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const qs = params.toString();
      const r = await fetch(`/api/reconcile${qs ? `?${qs}` : ""}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setRecon(r);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST", body: JSON.stringify({}) });
      const json = await res.json();
      for (const r of json.results ?? []) {
        if (r.error) toast.error(`${r.store}: ${r.error}`);
        else toast.success(`${r.store}: ${r.fetched} orders synced`);
      }
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const onConfirm = async (bankLineId: string) => {
    const res = await fetch("/api/reconcile/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankLineId, actor: "founder" }),
    });
    if (res.ok) { toast.success("Settlement confirmed"); refresh(); }
    else toast.error("Confirm failed");
  };

  const lines = recon?.lines ?? [];
  const settled = lines.filter((r) => r.state === "SETTLED");
  const buckets = {
    awaiting: lines.filter((r) => r.state === "AWAITING_PAYOUT"),
    variance: lines.filter((r) => r.state === "PAYOUT_VARIANCE"),
    unresolved: lines.filter((r) => r.state === "ORDERS_UNRESOLVED"),
  };
  const sum = (arr: { bankAmount: number }[]) => arr.reduce((s, r) => s + r.bankAmount, 0);

  const showOrders = view === "orders" || view === "sales";
  const showDashboard = view === "dashboard";
  const showDocuments = view === "documents";
  const showReports = view === "reports";
  const showMarketing = view === "marketing";
  const showInventory = view === "inventory";
  const showCustomers = view === "customers";
  const showReconContext =
    view === "reconciliation" || view === "orders" || view === "sales" || view === "payouts" || view === "returns";

  const exceptionCount = buckets.variance.length + buckets.unresolved.length;

  const exportHref = (() => {
    const p = new URLSearchParams();
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    const qs = p.toString();
    return `/api/reconcile/export${qs ? `?${qs}` : ""}`;
  })();

  const activeItem = NAV.find((n) => n.href === pathname);

  return (
    <div className="min-h-screen bg-[#FBF8F1] text-[#1F1B16] antialiased">
      <Sidebar pathname={pathname} />

      <main className="ml-60 min-h-screen">
        <div className="max-w-[1320px] mx-auto px-10 pt-8 pb-28">
          {/* Header — page title (from active nav) + right-aligned actions */}
          <header className="flex items-end justify-between gap-6 mb-7 pb-5 border-b border-[#EAE3D6]">
            <div className="flex flex-col leading-tight">
              <span className="text-[10.5px] uppercase tracking-[0.16em] text-[#B08343] font-semibold mb-2">
                {view === "reconciliation" ? "Bank → payout → orders" : "Workspace"}
              </span>
              <h1
                className="text-[28px] tracking-[-0.01em] text-[#1F1B16]"
                style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500 }}
              >
                {activeItem?.label ?? "Reconciliation"}
              </h1>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button
                className={`${btnBase} ${btnSolid}`}
                disabled={syncing}
                onClick={sync}
              >
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                Sync stores
              </button>

              {view === "reconciliation" && (
                <>
                  <a className={`${btnBase} ${btnGhost}`} href={exportHref}>
                    <FileChartColumn size={14} /> Export
                  </a>
                  <UploadButton
                    endpoint="/api/upload/bank"
                    accept=".pdf,.csv,.txt,.xls,.xlsx"
                    label="Upload bank statement"
                    onDone={refresh}
                  />
                </>
              )}
            </div>
          </header>

          {/* Date-range bar for context-sharing views */}
          {showReconContext && view !== "reconciliation" && (
            <div className="flex items-center gap-3 flex-wrap mb-5">
              <label className="inline-flex items-center gap-2 text-[12px] text-[#8A8175] font-medium">
                <span className="uppercase tracking-[0.08em] text-[10.5px] text-[#B5AC98]">From</span>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="border border-[#D6CCBA] rounded-md px-2.5 py-1.5 text-[12.5px] bg-white text-[#1F1B16] focus:outline-none focus:border-[#B08343] focus:ring-2 focus:ring-[#FBF3E6]"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-[12px] text-[#8A8175] font-medium">
                <span className="uppercase tracking-[0.08em] text-[10.5px] text-[#B5AC98]">To</span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="border border-[#D6CCBA] rounded-md px-2.5 py-1.5 text-[12.5px] bg-white text-[#1F1B16] focus:outline-none focus:border-[#B08343] focus:ring-2 focus:ring-[#FBF3E6]"
                />
              </label>
              {(fromDate || toDate) && (
                <button
                  className={`${btnBase} ${btnGhost} !px-3 !py-1.5 !text-[12.5px]`}
                  onClick={() => { setFromDate(""); setToDate(""); }}
                >
                  Clear range
                </button>
              )}
              <a className={`${btnBase} ${btnGhost} !px-3 !py-1.5 !text-[12.5px]`} href={exportHref}>
                <FileChartColumn size={14} /> Export reconciliation
              </a>
            </div>
          )}

          {/* Documents required */}
          {showReconContext&&view !== "orders" &&
            recon &&
            (!recon.documents.bankStatement ||
              recon.documents.missingPayouts.length > 0 ||
              recon.documents.range?.noStatementForRange) && (
              <div
                className="mb-6 bg-white border border-[#EAE3D6] rounded-2xl px-4 py-3.5 flex items-center gap-2.5 flex-wrap"
                style={{ boxShadow: "0 1px 2px rgba(31,27,22,0.04)" }}
              >
                <span className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] font-semibold text-[#8A8175]">
                  <FileSpreadsheet size={12} className="text-[#B08343]" />
                  Documents required
                </span>

                {!recon.documents.bankStatement && (
                  <DocChip tone="bad">
                    Bank statement — upload the daily statement (PDF or CSV) to start
                  </DocChip>
                )}

                {recon.documents.range?.noStatementForRange && (
                  <DocChip tone="bad">
                    No bank statement covers {recon.documents.range.from ?? "the start"} →{" "}
                    {recon.documents.range.to ?? "the end"} — upload that period's statement, or widen the range
                  </DocChip>
                )}

                {recon.documents.missingPayouts.map((d) => (
                  <DocChip key={d.provider} tone="warn">
                    {d.provider} payout file · {aed(d.awaitingAmount)} waiting to be explained
                  </DocChip>
                ))}

                {recon.documents.bankStatement &&
                  recon.documents.missingPayouts.length === 0 &&
                  !recon.documents.range?.noStatementForRange && (
                    <DocChip tone="ok">All documents present</DocChip>
                  )}
              </div>
            )}

          {/* Reconciliation-chain KPIs */}
          {showReconContext && view !== "orders" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <Kpi
                label="Bank-confirmed settled"
                value={aed(sum(settled))}
                note={`${settled.length} of ${lines.length} credit lines`}
                tone="ok"
              />
              <Kpi
                label="Awaiting payout file"
                value={aed(sum(buckets.awaiting))}
                note={`${buckets.awaiting.length} lines · money in transit`}
                tone="info"
              />
              <Kpi
                label="Orders settled"
                value={`${recon?.settledOrders ?? 0} / ${recon?.totalOrders ?? 0}`}
                note="stamped by bank-confirmed payouts"
                tone="ok"
              />
              <Kpi
                label="Exceptions"
                value={String(exceptionCount)}
                note="variance or unresolved orders"
                tone={exceptionCount ? "bad" : "muted"}
              />
            </div>
          )}

          {/* View body */}
          {showDashboard ? (
            <FounderDashboard version={dashVersion} />
          ) : showDocuments ? (
            <DocumentsPanel version={dashVersion} onDone={refresh} />
          ) : showReports ? (
            <ReportsPanel version={dashVersion} />
          ) : showMarketing ? (
            <MarketingPanel />
          ) : showInventory ? (
            <InventoryPanel />
          ) : showCustomers ? (
            <CustomersPanel />
          ) : showOrders ? (
            <OrdersLedger />
          ) : view === "settings" ? (
            <ZohoSettingsPanel />
          ) : (
            <ReconView
              recon={recon}
              loading={loading}
              isFounder={isFounder}
              fromDate={fromDate}
              toDate={toDate}
              onRange={(f, t) => {
                setFromDate(f);
                setToDate(t);
              }}
              onConfirm={onConfirm}
              refresh={refresh}
              uploadSlotFor={(provider) => (
                <UploadButton
                  ghost
                  endpoint="/api/upload/payout"
                  extraFields={{ provider }}
                  accept=".csv,.xls,.xlsx"
                  label={`Upload ${provider} payout file`}
                  onDone={refresh}
                />
              )}
            />
          )}

          <footer className="mt-12 pt-6 border-t border-[#EAE3D6] flex items-start gap-2.5 text-[11.5px] text-[#8A8175] leading-relaxed">
            <ShieldCheck size={13} className="text-[#B08343] shrink-0 mt-0.5" />
            <span>
              Parsing and matching run server-side. This surface is for review and confirmation — the bank
              line is truth, everything else must earn its place against it.
            </span>
          </footer>
        </div>
      </main>

      <StoreChat />
    </div>
  );
}