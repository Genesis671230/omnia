"use client";

/* Customer 360 — every order a customer ever placed, across every store,
   ranked by lifetime spend. Read-only, informational: no gift-sending, no
   campaign triggers here, just the numbers a founder needs to decide who to
   reward and what a customer is worth. Two numbers are estimates, not
   measurements, and are labeled as such wherever they're shown:
     - expectedLtvNextYear: a recency-decayed run-rate projection
     - cac: blended per store/month (no per-order ad attribution exists) */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Users, Search, Mail, Phone, Copy, X, Crown, Star, ArrowUpDown,
  Loader2, Calendar, ShoppingBag, TrendingUp, HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ORDER_STATUS_META, type OrderRow } from "@/lib/types/orders";

type CustomerOrder = {
  uid: string; order_number: string; store_id: string; order_date: string | null;
  gross_aed: number; currency: string; gateway: string;
  financial_status: string; fulfillment_status: string;
  finance_status: OrderRow["finance_status"]; fulfillment_stage: string;
};

type Customer = {
  key: string; matchedBy: "email" | "phone"; name: string; email: string; phone: string;
  stores: string[]; totalOrders: number; totalSpendAed: number; aov: number;
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

const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
const aed2 = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

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

type SortKey = "totalSpendAed" | "totalOrders" | "expectedLtvNextYear" | "lastOrderDate";

const SORT_LABEL: Record<SortKey, string> = {
  totalSpendAed: "LTV to date", totalOrders: "Orders", expectedLtvNextYear: "Expected LTV", lastOrderDate: "Last order",
};

/* ── Drawer: full cross-store order history for one customer ───────────── */

function CustomerDrawer({ c, onClose }: { c: Customer; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div className="cust-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div
          className="cust-drawer"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header>
            <div>
              <span className="cd-name">
                {c.tier === "VIP" && <Crown size={14} className="tier-icon vip" />}
                {c.tier === "Loyal" && <Star size={13} className="tier-icon loyal" />}
                {c.name}
              </span>
              <span className="cd-sub">Rank #{c.rank} · matched by {c.matchedBy}</span>
            </div>
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </header>

          <div className="cd-contact">
            {c.email && (
              <button className="cd-chip" onClick={() => copy(c.email, "Email")}>
                <Mail size={13} /> {c.email} <Copy size={11} />
              </button>
            )}
            {c.phone && (
              <button className="cd-chip" onClick={() => copy(c.phone, "Phone")}>
                <Phone size={13} /> {c.phone} <Copy size={11} />
              </button>
            )}
            {c.stores.map((s) => <span key={s} className="store-badge">{s}</span>)}
          </div>

          <div className="cd-stats">
            <div><span>Lifetime spend</span><b>{aed2(c.totalSpendAed)}</b></div>
            <div><span>Orders</span><b>{c.totalOrders}</b></div>
            <div><span>AOV</span><b>{aed2(c.aov)}</b></div>
            <div><span>Expected LTV (next 12mo)<span className="hint" title="Estimate: lifetime spend ÷ months active × 12, scaled down the longer since their last order. Not a guarantee."><HelpCircle size={11} /></span></span><b>{aed2(c.expectedLtvNextYear)}</b></div>
            <div><span>First order</span><b>{dateFmt(c.firstOrderDate)}</b></div>
            <div><span>Last order</span><b>{dateFmt(c.lastOrderDate)} <em className="conf">{timeAgo(c.lastOrderDate)}</em></b></div>
          </div>

          <h4 className="cd-h4"><ShoppingBag size={13} /> Order history ({c.orders.length})</h4>
          <div className="cd-orders">
            {c.orders.map((o) => {
              const cancelled = CANCELLED.has(o.financial_status);
              const financeMeta = ORDER_STATUS_META[o.finance_status];
              return (
                <div key={o.uid} className="cd-order-row">
                  <span className="mono">#{o.order_number}</span>
                  <span className="store-badge">{o.store_id}</span>
                  <span className="cd-order-date">{dateFmt(o.order_date)}</span>
                  <span className="cd-order-gw">{o.gateway}</span>
                  <span className="cd-order-stage">{o.fulfillment_stage}</span>
                  <span className={`pill ${cancelled ? "muted" : financeMeta.tone}`}>{cancelled ? o.financial_status : financeMeta.label}</span>
                  <span className="mono cd-order-amt">{aed2(o.gross_aed)}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

export function CustomersPanel() {
  const [data, setData] = useState<CustomersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalSpendAed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Customer | null>(null);

  useEffect(() => {
    fetch("/api/customers").then((r) => r.json()).then(setData).catch(() => toast.error("Failed to load customers")).finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const list = data?.customers ?? [];
    const filtered = q
      ? list.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q.toLowerCase()))
      : list;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortKey === "lastOrderDate" ? (a.lastOrderDate ?? "") : a[sortKey];
      const bv = sortKey === "lastOrderDate" ? (b.lastOrderDate ?? "") : b[sortKey];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, q, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  if (loading) return <div className="empty"><Loader2 size={18} className="spin" /> Loading customers…</div>;
  if (!data || data.customers.length === 0) {
    return <div className="empty">No identifiable customers yet — orders need an email or phone number before they can be grouped into a customer.</div>;
  }

  const totalLtv = data.customers.reduce((s, c) => s + c.totalSpendAed, 0);
  const avgAov = data.customers.length ? data.customers.reduce((s, c) => s + c.aov, 0) / data.customers.length : 0;

  return (
    <>
      <div className="cust-kpis">
        <div className="cust-kpi"><span><Users size={12} /> Customers</span><b>{data.customers.length}</b><em>{data.unidentifiedCount > 0 ? `${data.unidentifiedCount} orders unidentified (no email/phone)` : "all orders identified"}</em></div>
        <div className="cust-kpi"><span><TrendingUp size={12} /> Total LTV</span><b>{aed(totalLtv)}</b><em>lifetime spend, all customers</em></div>
        <div className="cust-kpi"><span>Avg AOV</span><b>{aed2(avgAov)}</b><em>average across customers</em></div>
        <div className="cust-kpi cac-kpi">
          <span>Blended CAC this month<span className="hint" title="Ad spend this store this month ÷ net-new customers first-acquired at that store this month. Never per-customer — no click-to-order attribution exists in this data."><HelpCircle size={11} /></span></span>
          <div className="cac-chips">
            {data.cac.currentMonth.map((r) => (
              <span key={r.store} className="cac-chip">
                <b className="store-badge">{r.store}</b> {r.cac != null ? aed2(r.cac) : "—"}
                {r.newCustomers > 0 && <em className="conf">{r.newCustomers} new</em>}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="filters">
        <div className="search-wrap">
          <Search size={14} />
          <input className="search" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="sort-buttons">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button key={k} className={`tab ${sortKey === k ? "on" : ""}`} onClick={() => toggleSort(k)}>
              {SORT_LABEL[k]} <ArrowUpDown size={11} />
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Customer</th><th>Stores</th><th style={{ textAlign: "right" }}>Orders</th>
              <th style={{ textAlign: "right" }}>LTV to date</th><th style={{ textAlign: "right" }}>AOV</th>
              <th>Last order</th><th style={{ textAlign: "right" }}>Expected LTV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.key} className="cust-row" onClick={() => setSelected(c)}>
                <td className="mono">{c.rank}</td>
                <td>
                  <span className="cust-name">
                    {c.tier === "VIP" && <span title="Top 10 by lifetime spend"><Crown size={12} className="tier-icon vip" /></span>}
                    {c.tier === "Loyal" && <span title="Top 50 by lifetime spend"><Star size={11} className="tier-icon loyal" /></span>}
                    {c.name}
                  </span>
                </td>
                <td>{c.stores.map((s) => <span key={s} className="store-badge" style={{ marginRight: 4 }}>{s}</span>)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{c.totalOrders}</td>
                <td className="mono" style={{ textAlign: "right" }}>{aed2(c.totalSpendAed)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{aed2(c.aov)}</td>
                <td><Calendar size={11} style={{ marginRight: 4, color: "var(--muted)" }} />{timeAgo(c.lastOrderDate)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{aed2(c.expectedLtvNextYear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-note">{rows.length} of {data.customers.length} customers · ranked by lifetime spend across all stores · Expected LTV is an estimate, not a guarantee.</p>

      {selected && <CustomerDrawer c={selected} onClose={() => setSelected(null)} />}

      <style jsx global>{CUSTOMERS_PANEL_CSS}</style>
    </>
  );
}

const CUSTOMERS_PANEL_CSS = `
  .cust-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
  .cust-kpi { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
  .cust-kpi > span { font-size: 11.5px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
  .cust-kpi > b { font-family: Georgia, serif; font-size: 22px; }
  .cust-kpi > em { font-size: 10.5px; color: var(--muted); font-style: normal; }
  .cac-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  .cac-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; background: var(--info-wash, #E8F1F3); color: var(--info, #2E6B7A); padding: 4px 9px; border-radius: 8px; }
  .cac-chip .conf { margin-left: 2px; }
  .hint { color: var(--muted); cursor: help; margin-left: 3px; }

  .sort-buttons { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }

  .cust-row { cursor: pointer; transition: background .1s; }
  .cust-row:hover { background: var(--gold-wash); }
  .cust-name { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
  .tier-icon.vip { color: var(--gold); }
  .tier-icon.loyal { color: var(--info, #2E6B7A); }

  .cust-overlay { position: fixed; inset: 0; background: rgba(31,27,22,.45); z-index: 60; display: flex; justify-content: flex-end; }
  .cust-drawer { background: var(--card); width: 100%; max-width: 480px; height: 100%; overflow-y: auto; box-shadow: -12px 0 40px rgba(0,0,0,.2); }
  .cust-drawer header { display: flex; justify-content: space-between; align-items: flex-start; padding: 18px 20px; border-bottom: 1px solid var(--line); }
  .cd-name { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 16px; }
  .cd-sub { display: block; font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  .cd-contact { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 20px 16px; }
  .cd-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; border: 1px solid var(--line-strong); background: var(--cream); border-radius: 999px; padding: 5px 11px; cursor: pointer; color: var(--ink); }
  .cd-chip:hover { border-color: var(--gold); color: var(--gold-deep); }
  .cd-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 0 20px 18px; }
  .cd-stats > div { display: flex; flex-direction: column; gap: 3px; }
  .cd-stats span { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; }
  .cd-stats b { font-size: 15px; font-weight: 600; }
  .cd-h4 { display: flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0; padding: 14px 20px 8px; border-top: 1px solid var(--line); }
  .cd-orders { display: flex; flex-direction: column; padding: 0 20px 20px; }
  .cd-order-row { display: grid; grid-template-columns: 70px 50px 1fr 80px 80px 90px 90px; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
  .cd-order-date { color: var(--muted); }
  .cd-order-gw { color: var(--muted); }
  .cd-order-stage { color: var(--muted); text-transform: capitalize; font-size: 11.5px; }
  .cd-order-amt { text-align: right; font-weight: 600; }
`;
