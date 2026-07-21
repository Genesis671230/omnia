// "use client";

// /* Customer 360 — every order a customer ever placed, across every store,
//    ranked by lifetime spend. Read-only, informational: no gift-sending, no
//    campaign triggers here, just the numbers a founder needs to decide who to
//    reward and what a customer is worth. Two numbers are estimates, not
//    measurements, and are labeled as such wherever they're shown:
//      - expectedLtvNextYear: a recency-decayed run-rate projection
//      - cac: blended per store/month (no per-order ad attribution exists) */

// import { useEffect, useMemo, useState } from "react";
// import { AnimatePresence, motion } from "framer-motion";
// import {
//   Users, Search, Mail, Phone, Copy, X, Crown, Star, ArrowUpDown,
//   Loader2, Calendar, ShoppingBag, TrendingUp, HelpCircle,
// } from "lucide-react";
// import { toast } from "sonner";
// import { ORDER_STATUS_META, type OrderRow } from "@/lib/types/orders";

// type CustomerOrder = {
//   uid: string; order_number: string; store_id: string; order_date: string | null;
//   gross_aed: number; currency: string; gateway: string;
//   financial_status: string; fulfillment_status: string;
//   finance_status: OrderRow["finance_status"]; fulfillment_stage: string;
// };

// type Customer = {
//   key: string; matchedBy: "email" | "phone"; name: string; email: string; phone: string;
//   stores: string[]; totalOrders: number; totalSpendAed: number; aov: number;
//   firstOrderDate: string | null; lastOrderDate: string | null; expectedLtvNextYear: number;
//   orders: CustomerOrder[]; rank: number; tier: "VIP" | "Loyal" | null;
// };

// type CacRow = { store: string; month: string; spend: number; newCustomers: number; cac: number | null };

// type CustomersPayload = {
//   customers: Customer[];
//   unidentifiedCount: number;
//   cac: { currentMonth: CacRow[]; history: CacRow[] };
// };

// const CANCELLED = new Set(["voided", "refunded", "cancelled"]);

// const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
// const aed2 = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

// function timeAgo(iso: string | null): string {
//   if (!iso) return "—";
//   const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
//   if (days < 1) return "today";
//   if (days < 30) return `${days}d ago`;
//   if (days < 365) return `${Math.round(days / 30.44)}mo ago`;
//   return `${(days / 365).toFixed(1)}y ago`;
// }

// const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// function copy(text: string, label: string) {
//   if (!text) return;
//   navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Copy failed"));
// }

// type SortKey = "totalSpendAed" | "totalOrders" | "expectedLtvNextYear" | "lastOrderDate";

// const SORT_LABEL: Record<SortKey, string> = {
//   totalSpendAed: "LTV to date", totalOrders: "Orders", expectedLtvNextYear: "Expected LTV", lastOrderDate: "Last order",
// };

// /* ── Drawer: full cross-store order history for one customer ───────────── */

// function CustomerDrawer({ c, onClose }: { c: Customer; onClose: () => void }) {
//   return (
//     <AnimatePresence>
//       <motion.div className="cust-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
//         <motion.div
//           className="cust-drawer"
//           initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
//           transition={{ type: "spring", stiffness: 300, damping: 32 }}
//           onClick={(e) => e.stopPropagation()}
//         >
//           <header>
//             <div>
//               <span className="cd-name">
//                 {c.tier === "VIP" && <Crown size={14} className="tier-icon vip" />}
//                 {c.tier === "Loyal" && <Star size={13} className="tier-icon loyal" />}
//                 {c.name}
//               </span>
//               <span className="cd-sub">Rank #{c.rank} · matched by {c.matchedBy}</span>
//             </div>
//             <button className="icon-btn" onClick={onClose}><X size={16} /></button>
//           </header>

//           <div className="cd-contact">
//             {c.email && (
//               <button className="cd-chip" onClick={() => copy(c.email, "Email")}>
//                 <Mail size={13} /> {c.email} <Copy size={11} />
//               </button>
//             )}
//             {c.phone && (
//               <button className="cd-chip" onClick={() => copy(c.phone, "Phone")}>
//                 <Phone size={13} /> {c.phone} <Copy size={11} />
//               </button>
//             )}
//             {c.stores.map((s) => <span key={s} className="store-badge">{s}</span>)}
//           </div>

//           <div className="cd-stats">
//             <div><span>Lifetime spend</span><b>{aed2(c.totalSpendAed)}</b></div>
//             <div><span>Orders</span><b>{c.totalOrders}</b></div>
//             <div><span>AOV</span><b>{aed2(c.aov)}</b></div>
//             <div><span>Expected LTV (next 12mo)<span className="hint" title="Estimate: lifetime spend ÷ months active × 12, scaled down the longer since their last order. Not a guarantee."><HelpCircle size={11} /></span></span><b>{aed2(c.expectedLtvNextYear)}</b></div>
//             <div><span>First order</span><b>{dateFmt(c.firstOrderDate)}</b></div>
//             <div><span>Last order</span><b>{dateFmt(c.lastOrderDate)} <em className="conf">{timeAgo(c.lastOrderDate)}</em></b></div>
//           </div>

//           <h4 className="cd-h4"><ShoppingBag size={13} /> Order history ({c.orders.length})</h4>
//           <div className="cd-orders">
//             {c.orders.map((o) => {
//               const cancelled = CANCELLED.has(o.financial_status);
//               const financeMeta = ORDER_STATUS_META[o.finance_status];
//               return (
//                 <div key={o.uid} className="cd-order-row">
//                   <span className="mono">#{o.order_number}</span>
//                   <span className="store-badge">{o.store_id}</span>
//                   <span className="cd-order-date">{dateFmt(o.order_date)}</span>
//                   <span className="cd-order-gw">{o.gateway}</span>
//                   <span className="cd-order-stage">{o.fulfillment_stage}</span>
//                   <span className={`pill ${cancelled ? "muted" : financeMeta.tone}`}>{cancelled ? o.financial_status : financeMeta.label}</span>
//                   <span className="mono cd-order-amt">{aed2(o.gross_aed)}</span>
//                 </div>
//               );
//             })}
//           </div>
//         </motion.div>
//       </motion.div>
//     </AnimatePresence>
//   );
// }

// /* ── Panel ───────────────────────────────────────────────────────────────── */

// export function CustomersPanel() {
//   const [data, setData] = useState<CustomersPayload | null>(null);
//   const [loading, setLoading] = useState(true);
//   const [q, setQ] = useState("");
//   const [sortKey, setSortKey] = useState<SortKey>("totalSpendAed");
//   const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
//   const [selected, setSelected] = useState<Customer | null>(null);

//   useEffect(() => {
//     fetch("/api/customers").then((r) => r.json()).then(setData).catch(() => toast.error("Failed to load customers")).finally(() => setLoading(false));
//   }, []);

//   const rows = useMemo(() => {
//     const list = data?.customers ?? [];
//     const filtered = q
//       ? list.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q.toLowerCase()))
//       : list;
//     const sorted = [...filtered].sort((a, b) => {
//       const av = sortKey === "lastOrderDate" ? (a.lastOrderDate ?? "") : a[sortKey];
//       const bv = sortKey === "lastOrderDate" ? (b.lastOrderDate ?? "") : b[sortKey];
//       const cmp = av < bv ? -1 : av > bv ? 1 : 0;
//       return sortDir === "asc" ? cmp : -cmp;
//     });
//     return sorted;
//   }, [data, q, sortKey, sortDir]);

//   const toggleSort = (key: SortKey) => {
//     if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
//     else { setSortKey(key); setSortDir("desc"); }
//   };

//   if (loading) return <div className="empty"><Loader2 size={18} className="spin" /> Loading customers…</div>;
//   if (!data || data.customers.length === 0) {
//     return <div className="empty">No identifiable customers yet — orders need an email or phone number before they can be grouped into a customer.</div>;
//   }

//   const totalLtv = data.customers.reduce((s, c) => s + c.totalSpendAed, 0);
//   const avgAov = data.customers.length ? data.customers.reduce((s, c) => s + c.aov, 0) / data.customers.length : 0;

//   return (
//     <>
//       <div className="cust-kpis">
//         <div className="cust-kpi"><span><Users size={12} /> Customers</span><b>{data.customers.length}</b><em>{data.unidentifiedCount > 0 ? `${data.unidentifiedCount} orders unidentified (no email/phone)` : "all orders identified"}</em></div>
//         <div className="cust-kpi"><span><TrendingUp size={12} /> Total LTV</span><b>{aed(totalLtv)}</b><em>lifetime spend, all customers</em></div>
//         <div className="cust-kpi"><span>Avg AOV</span><b>{aed2(avgAov)}</b><em>average across customers</em></div>
//         <div className="cust-kpi cac-kpi">
//           <span>Blended CAC this month<span className="hint" title="Ad spend this store this month ÷ net-new customers first-acquired at that store this month. Never per-customer — no click-to-order attribution exists in this data."><HelpCircle size={11} /></span></span>
//           <div className="cac-chips">
//             {data.cac.currentMonth.map((r) => (
//               <span key={r.store} className="cac-chip">
//                 <b className="store-badge">{r.store}</b> {r.cac != null ? aed2(r.cac) : "—"}
//                 {r.newCustomers > 0 && <em className="conf">{r.newCustomers} new</em>}
//               </span>
//             ))}
//           </div>
//         </div>
//       </div>

//       <div className="filters">
//         <div className="search-wrap">
//           <Search size={14} />
//           <input className="search" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
//         </div>
//         <div className="sort-buttons">
//           {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
//             <button key={k} className={`tab ${sortKey === k ? "on" : ""}`} onClick={() => toggleSort(k)}>
//               {SORT_LABEL[k]} <ArrowUpDown size={11} />
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="table-wrap">
//         <table>
//           <thead>
//             <tr>
//               <th>#</th><th>Customer</th><th>Stores</th><th style={{ textAlign: "right" }}>Orders</th>
//               <th style={{ textAlign: "right" }}>LTV to date</th><th style={{ textAlign: "right" }}>AOV</th>
//               <th>Last order</th><th style={{ textAlign: "right" }}>Expected LTV</th>
//             </tr>
//           </thead>
//           <tbody>
//             {rows.slice(1,50).map((c) => (
//               <tr key={c.key} className="cust-row" onClick={() => setSelected(c)}>
//                 <td className="mono">{c.rank}</td>
//                 <td>
//                   <span className="cust-name">
//                     {c.tier === "VIP" && <span title="Top 10 by lifetime spend"><Crown size={12} className="tier-icon vip" /></span>}
//                     {c.tier === "Loyal" && <span title="Top 50 by lifetime spend"><Star size={11} className="tier-icon loyal" /></span>}
//                     {c.name}
//                   </span>
//                 </td>
//                 <td>{c.stores.map((s) => <span key={s} className="store-badge" style={{ marginRight: 4 }}>{s}</span>)}</td>
//                 <td className="mono" style={{ textAlign: "right" }}>{c.totalOrders}</td>
//                 <td className="mono" style={{ textAlign: "right" }}>{aed2(c.totalSpendAed)}</td>
//                 <td className="mono" style={{ textAlign: "right" }}>{aed2(c.aov)}</td>
//                 <td><Calendar size={11} style={{ marginRight: 4, color: "var(--muted)" }} />{timeAgo(c.lastOrderDate)}</td>
//                 <td className="mono" style={{ textAlign: "right" }}>{aed2(c.expectedLtvNextYear)}</td>
//               </tr>
//             ))}
//           </tbody>
//         </table>
//       </div>
//       <p className="table-note">{rows.length} of {data.customers.length} customers · ranked by lifetime spend across all stores · Expected LTV is an estimate, not a guarantee.</p>

//       {selected && <CustomerDrawer c={selected} onClose={() => setSelected(null)} />}

//       <style jsx global>{CUSTOMERS_PANEL_CSS}</style>
//     </>
//   );
// }

// const CUSTOMERS_PANEL_CSS = `
//   .cust-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
//   .cust-kpi { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
//   .cust-kpi > span { font-size: 11.5px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
//   .cust-kpi > b { font-family: Georgia, serif; font-size: 22px; }
//   .cust-kpi > em { font-size: 10.5px; color: var(--muted); font-style: normal; }
//   .cac-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
//   .cac-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; background: var(--info-wash, #E8F1F3); color: var(--info, #2E6B7A); padding: 4px 9px; border-radius: 8px; }
//   .cac-chip .conf { margin-left: 2px; }
//   .hint { color: var(--muted); cursor: help; margin-left: 3px; }

//   .sort-buttons { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }

//   .cust-row { cursor: pointer; transition: background .1s; }
//   .cust-row:hover { background: var(--gold-wash); }
//   .cust-name { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
//   .tier-icon.vip { color: var(--gold); }
//   .tier-icon.loyal { color: var(--info, #2E6B7A); }

//   .cust-overlay { position: fixed; inset: 0; background: rgba(31,27,22,.45); z-index: 60; display: flex; justify-content: flex-end; }
//   .cust-drawer { background: var(--card); width: 100%; max-width: 480px; height: 100%; overflow-y: auto; box-shadow: -12px 0 40px rgba(0,0,0,.2); }
//   .cust-drawer header { display: flex; justify-content: space-between; align-items: flex-start; padding: 18px 20px; border-bottom: 1px solid var(--line); }
//   .cd-name { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 16px; }
//   .cd-sub { display: block; font-size: 11.5px; color: var(--muted); margin-top: 4px; }
//   .cd-contact { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 20px 16px; }
//   .cd-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; border: 1px solid var(--line-strong); background: var(--cream); border-radius: 999px; padding: 5px 11px; cursor: pointer; color: var(--ink); }
//   .cd-chip:hover { border-color: var(--gold); color: var(--gold-deep); }
//   .cd-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 0 20px 18px; }
//   .cd-stats > div { display: flex; flex-direction: column; gap: 3px; }
//   .cd-stats span { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; }
//   .cd-stats b { font-size: 15px; font-weight: 600; }
//   .cd-h4 { display: flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0; padding: 14px 20px 8px; border-top: 1px solid var(--line); }
//   .cd-orders { display: flex; flex-direction: column; padding: 0 20px 20px; }
//   .cd-order-row { display: grid; grid-template-columns: 70px 50px 1fr 80px 80px 90px 90px; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
//   .cd-order-date { color: var(--muted); }
//   .cd-order-gw { color: var(--muted); }
//   .cd-order-stage { color: var(--muted); text-transform: capitalize; font-size: 11.5px; }
//   .cd-order-amt { text-align: right; font-weight: 600; }
// `;






"use client";

/* Customer 360 — every order a customer ever placed, across every store,
   ranked by lifetime spend. Reads the real /api/customers payload:
     - customers[]: aggregate rows (totals, AOV, expectedLtvNextYear, tier, rank,
       city, orders[])
     - unidentifiedCount: orders with no email/phone
     - cac.currentMonth / cac.history: blended per-store/month CAC
   Two numbers are estimates, labeled as such wherever shown:
     - expectedLtvNextYear: recency-decayed run-rate projection
     - cac: blended per store/month (no per-order ad attribution exists) */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import {
  Users, Search, Mail, Phone, Copy, X, Crown, Star, ArrowUpDown, ArrowUp, ArrowDown,
  Loader2, Calendar, ShoppingBag, TrendingUp, HelpCircle, MapPin, UserPlus, Repeat,
  Download, SlidersHorizontal, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { ORDER_STATUS_META, type OrderRow } from "@/lib/types/orders";

/* ── payload shapes (mirror app/api/customers/route.ts) ─────────────────── */
type CustomerOrder = {
  uid: string; order_number: string; store_id: string; order_date: string | null;
  gross_aed: number; currency: string; gateway: string;
  financial_status: string; fulfillment_status: string;
  finance_status: OrderRow["finance_status"]; fulfillment_stage: string;
};

type Customer = {
  key: string; matchedBy: "email" | "phone"; name: string; email: string; phone: string;
  city: string; stores: string[]; totalOrders: number; totalSpendAed: number; aov: number;
  firstOrderDate: string | null; lastOrderDate: string | null; expectedLtvNextYear: number;
  orders: CustomerOrder[]; rank: number; tier: "VIP" | "Loyal" | null;
};

type CacRow = { store: string; month: string; spend: number; newCustomers: number; cac: number | null };

type CustomersPayload = {
  customers: Customer[];
  unidentifiedCount: number;
  cac: { currentMonth: CacRow[]; history: CacRow[] };
};

const CANCELLED = new Set(["voided", "refunded", "cancelled"]);

/* ── formatters ─────────────────────────────────────────────────────────── */
const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v || 0);
const aed2 = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat("en-AE").format(v || 0);

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30.44)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}
const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function copy(text: string, label: string) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Copy failed"));
}

/* ── palette ────────────────────────────────────────────────────────────── */
const GILT = "#B08D57", GILT_DEEP = "#8A6B3A", TEAL = "#2E6B7A", CLAY = "#C6753D", SAGE = "#7A8B6F", PLUM = "#8A5A6D";
const LOC_COLORS = [TEAL, GILT, CLAY, SAGE, PLUM, "#5B7C99", "#A8843C", "#9C6B5A"];

const TierMark = ({ tier, size = 12 }: { tier: Customer["tier"]; size?: number }) =>
  tier === "VIP" ? <Crown size={size} className="tier vip" /> :
  tier === "Loyal" ? <Star size={size - 1} className="tier loyal" /> : null;

/* ── drawer: full cross-store order history for one customer ─────────────── */
function CustomerDrawer({ c, onClose }: { c: Customer; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div className="c360-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div
          className="c360-drawer"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dr-flare" />
          <header>
            <div>
              <span className="dr-name"><TierMark tier={c.tier} size={15} />{c.name}</span>
              <span className="dr-sub">Rank №{c.rank} · matched by {c.matchedBy}{c.city && c.city !== "Unknown" && <> · <MapPin size={11} /> {c.city}</>}</span>
            </div>
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </header>

          <div className="dr-contact">
            {c.email && (
              <button className="c360-chip" onClick={() => copy(c.email, "Email")}>
                <Mail size={13} /> {c.email} <Copy size={11} />
              </button>
            )}
            {c.phone && (
              <button className="c360-chip" onClick={() => copy(c.phone, "Phone")}>
                <Phone size={13} /> {c.phone} <Copy size={11} />
              </button>
            )}
            {c.stores.map((s) => <span key={s} className="store-badge">{s}</span>)}
          </div>

          <div className="dr-stats">
            <div><span>Lifetime spend</span><b>{aed2(c.totalSpendAed)}</b></div>
            <div><span>Orders</span><b>{c.totalOrders}</b></div>
            <div><span>AOV</span><b>{aed2(c.aov)}</b></div>
            <div><span>Expected LTV <em className="hint" title="Estimate: lifetime spend ÷ months active × 12, scaled down the longer since their last order. Not a guarantee."><HelpCircle size={11} /></em></span><b>{aed2(c.expectedLtvNextYear)}</b></div>
            <div><span>First order</span><b>{dateFmt(c.firstOrderDate)}</b></div>
            <div><span>Last order</span><b>{dateFmt(c.lastOrderDate)} <em className="conf">{timeAgo(c.lastOrderDate)}</em></b></div>
          </div>

          <h4 className="dr-h4"><ShoppingBag size={13} /> Order history ({c.orders.length})</h4>
          <div className="dr-orders">
            {c.orders.map((o) => {
              const cancelled = CANCELLED.has(o.financial_status);
              const meta = ORDER_STATUS_META[o.finance_status];
              return (
                <div key={o.uid} className="dr-order">
                  <span className="mono">#{o.order_number}</span>
                  <span className="store-badge">{o.store_id}</span>
                  <span className="dim">{dateFmt(o.order_date)}</span>
                  <span className="dim">{o.gateway}</span>
                  <span className="dim stage">{o.fulfillment_stage}</span>
                  <span className={`pill ${cancelled ? "muted" : meta.tone}`}>{cancelled ? o.financial_status : meta.label}</span>
                  <span className="mono amt">{aed2(o.gross_aed)}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── charts ─────────────────────────────────────────────────────────────── */
function ChartCard({ title, subtitle, icon: Icon, hint, children }: {
  title: string; subtitle?: string; icon: typeof MapPin; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="chart-card">
      <div className="chart-head">
        <span className="chart-title"><Icon size={13} /> {title}
          {hint && <em className="hint" title={hint}><HelpCircle size={11} /></em>}</span>
        {subtitle && <span className="chart-sub">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function ChartTip({ active, payload, label, fmt = aed }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rc-tip">
      {label && <div className="rc-tip-label">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="rc-tip-row"><span style={{ background: p.color || p.payload?.fill }} />{p.name}: <b>{fmt(p.value)}</b></div>
      ))}
    </div>
  );
}

/* ── feature-rich table ─────────────────────────────────────────────────── */
type SortKey = "rank" | "name" | "city" | "totalOrders" | "totalSpendAed" | "aov" | "lastOrderDate" | "expectedLtvNextYear";

const COLUMNS: {
  key: SortKey | "stores" | "type"; label: string; align: "left" | "right";
  sortable: boolean; always?: boolean; render: (c: Customer) => React.ReactNode;
}[] = [
  { key: "rank", label: "#", align: "left", sortable: true, always: true, render: (c) => <span className="mono rank">{c.rank}</span> },
  { key: "name", label: "Customer", align: "left", sortable: true, always: true,
    render: (c) => <span className="cust-name"><TierMark tier={c.tier} />{c.name}</span> },
  { key: "city", label: "Location", align: "left", sortable: true,
    render: (c) => c.city && c.city !== "Unknown" ? <span className="loc"><MapPin size={11} />{c.city}</span> : <span className="dim">—</span> },
  { key: "stores", label: "Stores", align: "left", sortable: false,
    render: (c) => c.stores.map((s) => <span key={s} className="store-badge">{s}</span>) },
  { key: "totalOrders", label: "Orders", align: "right", sortable: true, render: (c) => <span className="mono">{c.totalOrders}</span> },
  { key: "totalSpendAed", label: "LTV to date", align: "right", sortable: true, render: (c) => <span className="mono strong">{aed2(c.totalSpendAed)}</span> },
  { key: "aov", label: "AOV", align: "right", sortable: true, render: (c) => <span className="mono">{aed2(c.aov)}</span> },
  { key: "type", label: "Type", align: "left", sortable: false,
    render: (c) => c.totalOrders > 1 ? <span className="tag ret"><Repeat size={10} /> Returning</span> : <span className="tag new"><UserPlus size={10} /> New</span> },
  { key: "lastOrderDate", label: "Last order", align: "left", sortable: true, render: (c) => <span className="dim"><Calendar size={11} /> {timeAgo(c.lastOrderDate)}</span> },
  { key: "expectedLtvNextYear", label: "Expected LTV", align: "right", sortable: true, render: (c) => <span className="mono gilt">{aed2(c.expectedLtvNextYear)}</span> },
];

function CustomerTable({ customers, onSelect }: { customers: Customer[]; onSelect: (c: Customer) => void }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  const [typeFilter, setTypeFilter] = useState<"all" | "new" | "returning" | "vip">("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colMenu, setColMenu] = useState(false);

  const cols = COLUMNS.filter((c) => !hidden.has(c.key));

  const filtered = useMemo(() => {
    let list = customers;
    if (typeFilter === "new") list = list.filter((c) => c.totalOrders <= 1);
    if (typeFilter === "returning") list = list.filter((c) => c.totalOrders > 1);
    if (typeFilter === "vip") list = list.filter((c) => c.tier === "VIP");
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((c) => `${c.name} ${c.email} ${c.phone} ${c.city}`.toLowerCase().includes(s));
    }
    const sorted = [...list].sort((a, b) => {
      const av = sortKey === "lastOrderDate" ? (a.lastOrderDate ?? "") : (a[sortKey] as string | number);
      const bv = sortKey === "lastOrderDate" ? (b.lastOrderDate ?? "") : (b[sortKey] as string | number);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [customers, q, sortKey, sortDir, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize);
  useEffect(() => setPage(0), [q, typeFilter, pageSize]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" || k === "city" || k === "rank" ? "asc" : "desc"); }
  };

  const exportCsv = () => {
    const head = ["rank", "name", "email", "phone", "city", "stores", "orders", "ltv_aed", "aov_aed", "type", "last_order", "expected_ltv_aed"];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = filtered.map((c) => [c.rank, c.name, c.email, c.phone, c.city, c.stores.join("|"), c.totalOrders,
      c.totalSpendAed, c.aov, c.totalOrders > 1 ? "returning" : "new", c.lastOrderDate ?? "", c.expectedLtvNextYear].map(esc).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "customers.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="table-block">
      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={14} />
          <input className="search" placeholder="Search name, email, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="clear" onClick={() => setQ("")}><X size={12} /></button>}
        </div>
        <div className="seg">
          {([["all", "All"], ["new", "New"], ["returning", "Returning"], ["vip", "VIP"]] as const).map(([k, l]) => (
            <button key={k} className={typeFilter === k ? "on" : ""} onClick={() => setTypeFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="tool-actions">
          <div className="col-wrap">
            <button className="ghost-btn" onClick={() => setColMenu((v) => !v)}><SlidersHorizontal size={13} /> Columns</button>
            {colMenu && (
              <div className="col-menu" onMouseLeave={() => setColMenu(false)}>
                {COLUMNS.map((c) => (
                  <label key={c.key} className={c.always ? "disabled" : ""}>
                    <input type="checkbox" checked={!hidden.has(c.key)} disabled={c.always}
                      onChange={() => setHidden((h) => { const n = new Set(h); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="ghost-btn" onClick={exportCsv}><Download size={13} /> Export</button>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} style={{ textAlign: c.align }} className={c.sortable ? "sortable" : ""}
                  onClick={c.sortable ? () => toggleSort(c.key as SortKey) : undefined}>
                  <span className="th-inner" style={{ justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}>
                    {c.label}
                    {c.sortable && (sortKey === c.key
                      ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                      : <ArrowUpDown size={10} className="faint" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.key} className="cust-row" onClick={() => onSelect(c)}>
                {cols.map((col) => <td key={col.key} style={{ textAlign: col.align }}>{col.render(c)}</td>)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={cols.length} className="empty-row">No customers match “{q}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span className="foot-note">
          {filtered.length} of {customers.length} customers · ranked by lifetime spend across all stores · Expected LTV is an estimate, not a guarantee.
        </span>
        <div className="pager">
          <select value={pageSize} onChange={(e) => setPageSize(+e.target.value)}>
            {[12, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}><ChevronLeft size={14} /></button>
          <span className="page-num">{clampedPage + 1} / {pageCount}</span>
          <button disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}><ChevronRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}

/* ── panel ──────────────────────────────────────────────────────────────── */
export function CustomersPanel() {
  const [data, setData] = useState<CustomersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Customer | null>(null);

  useEffect(() => {
    fetch("/api/customers").then((r) => r.json()).then(setData)
      .catch(() => toast.error("Failed to load customers")).finally(() => setLoading(false));
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const cs = data.customers;
    const totalLtv = cs.reduce((s, c) => s + c.totalSpendAed, 0);
    const avgAov = cs.length ? cs.reduce((s, c) => s + c.aov, 0) / cs.length : 0;
    const returning = cs.filter((c) => c.totalOrders > 1).length;
    const newC = cs.length - returning;
    const retRate = cs.length ? (returning / cs.length) * 100 : 0;

    // location: group real customer.city, "Unknown" bucketed honestly.
    const cityMap: Record<string, { city: string; customers: number; spend: number }> = {};
    for (const c of cs) {
      const key = c.city || "Unknown";
      (cityMap[key] ??= { city: key, customers: 0, spend: 0 });
      cityMap[key].customers++;
      cityMap[key].spend += c.totalSpendAed;
    }
    const byCity = Object.values(cityMap).sort((a, b) => b.spend - a.spend);
    const knownCityCount = cs.filter((c) => c.city && c.city !== "Unknown").length;

    const splitPie = [
      { name: "Returning", value: returning, fill: TEAL },
      { name: "New", value: newC, fill: GILT },
    ];
    return { totalLtv, avgAov, returning, newC, retRate, byCity, knownCityCount, splitPie };
  }, [data]);

  if (loading) return <div className="c360 empty"><Loader2 size={18} className="spin" /> Loading customers…<style>{CSS}</style></div>;
  if (!data || data.customers.length === 0) {
    return <div className="c360 empty">No identifiable customers yet — orders need an email or phone number before they can be grouped into a customer.<style>{CSS}</style></div>;
  }

  const d = derived!;
  const currentCac = data.cac.currentMonth;

  return (
    <div className="c360">
      <div className="c360-bg" />
      <header className="c360-header">
        <div>
          <span className="eyebrow">Customer Intelligence</span>
          <h1>Customer 360</h1>
          <p>Every order, every store — ranked by what each customer is truly worth.</p>
        </div>
        <div className="header-badge"><Users size={14} /> {data.customers.length} identified</div>
      </header>

      {/* KPI row */}
      <div className="kpi-row">
        <div className="kpi feature">
          <span className="kpi-label"><TrendingUp size={12} /> Total lifetime value</span>
          <b className="kpi-val">{aed(d.totalLtv)}</b>
          <em>across {data.customers.length} customers · avg AOV {aed2(d.avgAov)}</em>
        </div>
        <div className="kpi">
          <span className="kpi-label"><Repeat size={12} /> Returning rate</span>
          <b className="kpi-val">{d.retRate.toFixed(0)}%</b>
          <em>{d.returning} returning · {d.newC} one-time</em>
        </div>
        <div className="kpi">
          <span className="kpi-label"><Users size={12} /> Unidentified</span>
          <b className="kpi-val">{data.unidentifiedCount}</b>
          <em>orders with no email / phone</em>
        </div>
        <div className="kpi cac-kpi">
          <span className="kpi-label">Blended CAC this month<em className="hint" title="Ad spend this store this month ÷ net-new customers first-acquired at that store this month. Never per-customer — no click-to-order attribution exists in this data."><HelpCircle size={11} /></em></span>
          <div className="cac-chips">
            {currentCac.map((r) => (
              <span key={r.store} className="cac-chip">
                <b className="store-badge">{r.store}</b> {r.cac != null ? aed2(r.cac) : "—"}
                {r.newCustomers > 0 && <em className="conf">{r.newCustomers} new</em>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* analytics: real fields only */}
      <div className="chart-grid">
        <ChartCard title="Customers by location" subtitle="Lifetime-spend concentration by city" icon={MapPin}
          hint={d.knownCityCount < data.customers.length ? `${data.customers.length - d.knownCityCount} customers have no city on their most recent order (shown as Unknown).` : "Spend grouped by each customer's most recent order city."}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.byCity} layout="vertical" margin={{ left: 6, right: 20, top: 4, bottom: 4 }}>
              <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="city" width={104} tick={{ fontSize: 11, fill: "#5c5040" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip fmt={aed} />} cursor={{ fill: "rgba(176,141,87,.08)" }} />
              <Bar dataKey="spend" name="Spend" radius={[0, 5, 5, 0]} barSize={15}>
                {d.byCity.map((row, i) => <Cell key={i} fill={row.city === "Unknown" ? "#C9BCA3" : LOC_COLORS[i % LOC_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="New vs returning" subtitle="Customer base composition" icon={Users}
          hint="Returning = more than one valid (non-cancelled) order across all stores.">
          <div className="pie-wrap">
            <ResponsiveContainer width="100%" height={218}>
              <PieChart>
                <Pie data={d.splitPie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3} stroke="none">
                  {d.splitPie.map((s, i) => <Cell key={i} fill={s.fill} />)}
                </Pie>
                <Tooltip content={<ChartTip fmt={num} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pie-center"><b>{d.retRate.toFixed(0)}%</b><span>returning</span></div>
          </div>
          <div className="pie-legend">
            <span><i style={{ background: TEAL }} /> Returning · {d.returning}</span>
            <span><i style={{ background: GILT }} /> New · {d.newC}</span>
          </div>
        </ChartCard>

        <ChartCard title="CAC history" subtitle="Blended per store, recent months" icon={TrendingUp}
          hint="From the API: ad spend ÷ net-new customers per store/month. Bars omit months with no attributable new customers.">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[...data.cac.history].filter((r) => r.cac != null).reverse().slice(-9)}
              margin={{ left: -12, right: 8, top: 8, bottom: 4 }}>
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#9a8b73" }} axisLine={false} tickLine={false}
                tickFormatter={(m: string) => m.slice(5)} />
              <YAxis tickFormatter={(v) => `${v}`} tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip fmt={aed2} />} cursor={{ fill: "rgba(46,107,122,.08)" }} />
              <Bar dataKey="cac" name="CAC" radius={[4, 4, 0, 0]} barSize={16}>
                {[...data.cac.history].filter((r) => r.cac != null).reverse().slice(-9).map((r, i) => (
                  <Cell key={i} fill={r.store === "UAE" ? TEAL : r.store === "KSA" ? GILT : CLAY} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="pie-legend">
            <span><i style={{ background: TEAL }} /> UAE</span>
            <span><i style={{ background: GILT }} /> KSA</span>
            <span><i style={{ background: CLAY }} /> WOO</span>
          </div>
        </ChartCard>
      </div>

      <CustomerTable customers={data.customers} onSelect={setSelected} />

      {selected && <CustomerDrawer c={selected} onClose={() => setSelected(null)} />}

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Outfit:wght@300;400;500;600&display=swap');
  .c360 { --parch:#F7F2E8; --card:#FDFBF6; --ink:#2A2420; --muted:#9a8b73; --line:#E8DFCE; --line-2:#DDD0B8;
    --gilt:#B08D57; --gilt-deep:#8A6B3A; --teal:#2E6B7A; --gold-wash:#F3EAD7; --ok-bg:#E6EFE8; --ok:#4B7A54; --warn-bg:#F6EBDC; --warn:#B07B36;
    position:relative; font-family:'Outfit',sans-serif; color:var(--ink); background:var(--parch); padding:26px 28px 40px; min-height:100%; overflow:hidden; }
  .c360.empty { display:flex; align-items:center; justify-content:center; gap:8px; color:var(--muted); font-size:14px; min-height:200px; padding:60px; }
  .c360-bg { position:absolute; inset:0; pointer-events:none; opacity:.5;
    background:
      radial-gradient(680px 340px at 88% -8%, rgba(176,141,87,.14), transparent 60%),
      radial-gradient(520px 300px at -6% 12%, rgba(46,107,122,.09), transparent 55%); }
  .c360 * { box-sizing:border-box; }
  .mono { font-variant-numeric:tabular-nums; font-feature-settings:'tnum'; }
  .spin { animation:c360spin 1s linear infinite; } @keyframes c360spin { to { transform:rotate(360deg); } }

  .c360-header { position:relative; display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; }
  .eyebrow { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--gilt-deep); font-weight:600; }
  .c360-header h1 { font-family:'Fraunces',serif; font-weight:500; font-size:40px; margin:4px 0 6px; letter-spacing:-.01em;
    background:linear-gradient(120deg,#2A2420,#7A5E33); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .c360-header p { color:var(--muted); font-size:13.5px; margin:0; max-width:440px; }
  .header-badge { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:500; color:var(--gilt-deep);
    background:var(--card); border:1px solid var(--line-2); padding:8px 14px; border-radius:999px; box-shadow:0 1px 0 rgba(255,255,255,.7) inset; }

  .kpi-row { display:grid; grid-template-columns:1.4fr 1fr 1fr 1.3fr; gap:14px; margin-bottom:18px; }
  .kpi { position:relative; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px;
    display:flex; flex-direction:column; gap:6px; box-shadow:0 1px 2px rgba(60,45,20,.04); overflow:hidden; }
  .kpi.feature { background:linear-gradient(135deg,#FBF4E6,#FDFBF6); border-color:var(--line-2); }
  .kpi.feature::after { content:''; position:absolute; right:-30px; top:-30px; width:120px; height:120px; border-radius:50%;
    background:radial-gradient(circle,rgba(176,141,87,.2),transparent 70%); }
  .kpi-label { font-size:11.5px; color:var(--muted); display:inline-flex; align-items:center; gap:6px; }
  .kpi-val { font-family:'Fraunces',serif; font-size:29px; font-weight:500; line-height:1; letter-spacing:-.01em; }
  .kpi.feature .kpi-val { font-size:33px; color:var(--gilt-deep); }
  .kpi em { font-size:10.5px; color:var(--muted); font-style:normal; }
  .cac-chips { display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
  .cac-chip { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; background:rgba(46,107,122,.08); color:var(--teal); padding:4px 9px; border-radius:8px; }
  .hint { color:var(--muted); cursor:help; display:inline-flex; margin-left:2px; }

  .chart-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:18px; }
  .chart-card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 16px 10px; box-shadow:0 1px 2px rgba(60,45,20,.04); }
  .chart-head { margin-bottom:8px; }
  .chart-title { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600; }
  .chart-sub { display:block; font-size:11px; color:var(--muted); margin-top:2px; }

  .pie-wrap { position:relative; }
  .pie-center { position:absolute; top:calc(50% - 4px); left:0; right:0; text-align:center; transform:translateY(-50%); pointer-events:none; }
  .pie-center b { font-family:'Fraunces',serif; font-size:26px; display:block; color:var(--teal); line-height:1; }
  .pie-center span { font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
  .pie-legend { display:flex; justify-content:center; gap:16px; padding:4px 0 8px; font-size:11.5px; color:#5c5040; flex-wrap:wrap; }
  .pie-legend span { display:inline-flex; align-items:center; gap:6px; }
  .pie-legend i { width:9px; height:9px; border-radius:3px; }

  .rc-tip { background:#211D18; color:#F7F2E8; border-radius:9px; padding:8px 11px; font-size:11.5px; box-shadow:0 6px 20px rgba(0,0,0,.28); }
  .rc-tip-label { font-weight:600; margin-bottom:4px; }
  .rc-tip-row { display:flex; align-items:center; gap:6px; }
  .rc-tip-row span { width:8px; height:8px; border-radius:2px; }

  .table-block { background:var(--card); border:1px solid var(--line); border-radius:16px; overflow:hidden; box-shadow:0 1px 2px rgba(60,45,20,.04); }
  .table-toolbar { display:flex; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .search-wrap { position:relative; display:flex; align-items:center; gap:8px; flex:1; min-width:220px;
    background:var(--parch); border:1px solid var(--line-2); border-radius:10px; padding:8px 11px; color:var(--muted); }
  .search-wrap:focus-within { border-color:var(--gilt); box-shadow:0 0 0 3px rgba(176,141,87,.12); }
  .search { border:none; background:transparent; outline:none; font-family:inherit; font-size:13px; color:var(--ink); width:100%; }
  .clear { border:none; background:none; color:var(--muted); cursor:pointer; display:flex; }
  .seg { display:inline-flex; background:var(--parch); border:1px solid var(--line-2); border-radius:10px; padding:3px; }
  .seg button { border:none; background:none; font-family:inherit; font-size:12px; font-weight:500; color:var(--muted); padding:6px 12px; border-radius:7px; cursor:pointer; transition:all .15s; }
  .seg button.on { background:var(--ink); color:var(--parch); box-shadow:0 1px 3px rgba(0,0,0,.15); }
  .tool-actions { display:flex; gap:8px; }
  .ghost-btn { display:inline-flex; align-items:center; gap:6px; font-family:inherit; font-size:12px; font-weight:500; color:#5c5040;
    background:var(--card); border:1px solid var(--line-2); border-radius:9px; padding:7px 11px; cursor:pointer; transition:all .15s; }
  .ghost-btn:hover { border-color:var(--gilt); color:var(--gilt-deep); }
  .col-wrap { position:relative; }
  .col-menu { position:absolute; right:0; top:calc(100% + 6px); z-index:20; background:var(--card); border:1px solid var(--line-2);
    border-radius:11px; padding:8px; box-shadow:0 10px 30px rgba(60,45,20,.16); min-width:160px; }
  .col-menu label { display:flex; align-items:center; gap:8px; font-size:12.5px; padding:5px 7px; border-radius:7px; cursor:pointer; }
  .col-menu label:hover { background:var(--gold-wash); }
  .col-menu label.disabled { opacity:.5; cursor:not-allowed; }
  .col-menu input { accent-color:var(--gilt); }

  .table-scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; }
  thead th { position:sticky; top:0; background:var(--gold-wash); font-size:10.5px; text-transform:uppercase; letter-spacing:.07em;
    color:var(--gilt-deep); font-weight:600; padding:11px 14px; text-align:left; white-space:nowrap; border-bottom:1px solid var(--line-2); }
  th.sortable { cursor:pointer; user-select:none; }
  th.sortable:hover { color:var(--ink); }
  .th-inner { display:inline-flex; align-items:center; gap:5px; }
  .faint { opacity:.35; }
  tbody tr { border-bottom:1px solid var(--line); cursor:pointer; transition:background .12s; }
  tbody tr:hover { background:var(--gold-wash); }
  tbody td { padding:11px 14px; font-size:13px; white-space:nowrap; }
  .rank { color:var(--muted); font-size:12px; }
  .cust-name { display:inline-flex; align-items:center; gap:6px; font-weight:500; }
  .tier.vip { color:var(--gilt); } .tier.loyal { color:var(--teal); }
  .loc { display:inline-flex; align-items:center; gap:4px; color:#5c5040; }
  .loc svg { color:var(--clay,#C6753D); }
  .strong { font-weight:600; } .gilt { color:var(--gilt-deep); font-weight:600; } .dim { color:var(--muted); display:inline-flex; align-items:center; gap:5px; }
  .store-badge { display:inline-block; font-size:10.5px; font-weight:600; color:var(--teal); background:rgba(46,107,122,.09);
    border:1px solid rgba(46,107,122,.16); padding:2px 7px; border-radius:6px; margin-right:4px; }
  .tag { display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; padding:3px 8px; border-radius:7px; }
  .tag.new { color:var(--gilt-deep); background:var(--gold-wash); border:1px solid var(--line-2); }
  .tag.ret { color:var(--teal); background:rgba(46,107,122,.1); border:1px solid rgba(46,107,122,.18); }
  .empty-row { text-align:center; color:var(--muted); padding:30px; }

  .table-foot { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-top:1px solid var(--line); flex-wrap:wrap; gap:10px; }
  .foot-note { font-size:11.5px; color:var(--muted); }
  .pager { display:flex; align-items:center; gap:8px; }
  .pager select { font-family:inherit; font-size:12px; color:#5c5040; background:var(--card); border:1px solid var(--line-2); border-radius:8px; padding:6px 8px; cursor:pointer; }
  .pager button { display:flex; border:1px solid var(--line-2); background:var(--card); border-radius:8px; padding:6px; cursor:pointer; color:#5c5040; }
  .pager button:disabled { opacity:.35; cursor:not-allowed; }
  .pager button:not(:disabled):hover { border-color:var(--gilt); color:var(--gilt-deep); }
  .page-num { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; min-width:52px; text-align:center; }

  .c360-overlay { position:fixed; inset:0; background:rgba(31,27,22,.5); backdrop-filter:blur(2px); z-index:60; display:flex; justify-content:flex-end; }
  .c360-drawer { position:relative; background:var(--card); width:100%; max-width:700px;padding-right:1rem; height:100%; overflow-y:auto; box-shadow:-16px 0 50px rgba(0,0,0,.25); }
  .dr-flare { position:absolute; top:0; left:0; right:0; height:120px; background:linear-gradient(180deg,rgba(176,141,87,.14),transparent); pointer-events:none; }
  .c360-drawer header { position:relative; display:flex; justify-content:space-between; align-items:flex-start; padding:22px 22px 16px; border-bottom:1px solid var(--line); }
  .dr-name { display:flex; align-items:center; gap:8px; font-family:'Fraunces',serif; font-weight:500; font-size:20px; }
  .dr-sub { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:var(--muted); margin-top:5px; }
  .icon-btn { border:1px solid var(--line-2); background:var(--card); border-radius:9px; padding:7px; cursor:pointer; color:#5c5040; display:flex; }
  .icon-btn:hover { border-color:var(--gilt); color:var(--gilt-deep); }
  .dr-contact { display:flex; gap:8px; flex-wrap:wrap; padding:14px 22px 6px; }
  .c360-chip { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; border:1px solid var(--line-2); background:var(--parch);
    border-radius:999px; padding:6px 12px; cursor:pointer; color:var(--ink); font-family:inherit; }
  .c360-chip:hover { border-color:var(--gilt); color:var(--gilt-deep); }
  .dr-stats { display:grid; grid-template-columns:1fr 1fr; gap:14px 18px; padding:16px 22px 20px; }
  .dr-stats > div { display:flex; flex-direction:column; gap:3px; }
  .dr-stats span { font-size:11px; color:var(--muted); display:inline-flex; align-items:center; gap:4px; }
  .dr-stats b { font-family:'Fraunces',serif; font-size:17px; font-weight:500; }
  .conf { font-size:10.5px; color:var(--muted); font-style:normal; }
  .dr-h4 { display:flex; align-items:center; gap:6px; font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--gilt-deep);
    margin:0; padding:14px 22px 8px; border-top:1px solid var(--line); font-weight:600; }
  .dr-orders { display:flex; flex-direction:column; padding:0 22px 24px; }
  .dr-order { display:grid; grid-template-columns:64px 52px 1fr 66px 84px 92px 88px; align-items:center; gap:8px; padding:10px 0;
    border-bottom:1px solid var(--line); font-size:12px; }
  .dr-order .stage { text-transform:capitalize; }
  .dr-order .amt { text-align:right; font-weight:600; }
  .pill { font-size:10.5px; font-weight:600; padding:3px 8px; border-radius:6px; text-align:center; }
  .pill.muted { color:var(--muted); background:var(--line); }

  @media (max-width:960px) {
    .kpi-row, .chart-grid { grid-template-columns:1fr; }
    .c360-header h1 { font-size:32px; }
  }
`;