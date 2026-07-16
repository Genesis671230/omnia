"use client";

/* Founder dashboard — orders side (revenue, trend, gateways, top products)
   from the synced order book; cash side (payouts, settled, awaiting) from the
   bank statement + reconciliation. Interactive: period + store filters refetch
   /api/dashboard; the trend chart and tables carry hover detail. */

import {
  Landmark, Loader2, Package, TrendingUp, Wallet, Clock, BadgeCheck, AlertTriangle,
  Radio, Truck, Download, User, MapPin, Mail, Phone, Copy, CheckCheck, PackageCheck, PackageX, HelpCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/* Fixed, entity-keyed categorical colors (validated: dataviz palette on white).
   Sub-3:1 slots (aqua/yellow/magenta) always ship with visible text labels. */
const STORE_COLOR: Record<string, string> = {
  WA: "#2a78d6", UAE: "#1baf7a", KSA: "#eda100", WOO: "#4a3aa7",
};
const GATEWAY_COLOR: Record<string, string> = {
  Stripe: "#2a78d6", Telr: "#1baf7a", Checkout: "#eda100", Tabby: "#008300",
  Tamara: "#4a3aa7", "Shopify Payments": "#e34948", COD: "#e87ba4", Unclassified: "#8A8175",
};

type Dash = {
  window: { days: number; from: string; store: string };
  kpis: {
    revenue: number; orders: number; aov: number;
    bankCredits: number; bankDebits: number; settled: number; awaitingPayout: number;
    exceptions: number; codPendingAed: number; codPendingCount: number;
    settledOrders: number; totalOrders: number;
  };
  trend: { date: string; byStore: Record<string, number>; total: number }[];
  stores: { store: string; revenue: number; orders: number }[];
  gateways: { gateway: string; revenue: number; orders: number; share: number }[];
  payouts: {
    byProvider: { provider: string; total: number; count: number; lastDate: string | null }[];
    recent: { id: string; date: string | null; provider: string; amount: number; reference: string; state: string; confirmed: boolean }[];
    uploadedBatches: number;
  };
  topProducts: { title: string; sku: string; qty: number; revenue: number; orders: number; stores: string[]; image_url?: string }[];
  recentOrders: { uid: string; store_id: string; order_number: string; order_date: string | null; customer_name: string; gross_aed: number; gateway: string; payout_status: string }[];
  documents: { bankStatement: boolean; lastStatementDate: string | null };
  spotlight: {
    uid: string; order_number: string; store_id: string; order_date: string | null;
    gross_aed: number; gateway: string;
    finance_status: "SETTLED" | "AWAITING_BANK" | "MISSING_PAYOUT" | "COD_PENDING";
    fulfillment_status: string;
    inventory: "in_stock" | "out_of_stock" | "unknown";
    courier: string | null; tracking_number: string | null; tracking_url: string | null;
    eta_date: string;
    customer: { name: string; email: string; phone: string; city: string; country: string };
    line_items: { title: string; sku: string; qty: number; total_aed: number; image_url?: string }[];
    draft_message: string;
  } | null;
};

type Pulse = {
  now: string;
  newOrders: { uid: string; order_number: string; store_id: string; customer_name: string; gross_aed: number; gateway: string; items: { title: string; qty: number }[] }[];
  metrics: string[];
};

type SpotlightOrder = NonNullable<Dash["spotlight"]>;

const SPOTLIGHT_FINANCE: Record<SpotlightOrder["finance_status"], { label: string; tone: string }> = {
  SETTLED: { label: "Payment settled", tone: "ok" },
  AWAITING_BANK: { label: "Awaiting bank", tone: "warn" },
  MISSING_PAYOUT: { label: "Missing payout file", tone: "muted" },
  COD_PENDING: { label: "Cash on delivery", tone: "muted" },
};

const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
const aed2 = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);
const compact = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v));
const shortDate = (iso: string) =>
  new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const PAYOUT_STATE: Record<string, { label: string; tone: string; icon: React.ElementType }> = {
  SETTLED: { label: "Settled", tone: "ok", icon: BadgeCheck },
  AWAITING_PAYOUT: { label: "Awaiting file", tone: "muted", icon: Clock },
  PAYOUT_VARIANCE: { label: "Variance", tone: "bad", icon: AlertTriangle },
  ORDERS_UNRESOLVED: { label: "Unresolved", tone: "warn", icon: AlertTriangle },
};

/* ── Stacked daily revenue trend (SVG, hover tooltip) ───────────────────── */

function TrendChart({ trend, stores }: { trend: Dash["trend"]; stores: string[] }) {
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const W = 720, H = 190, PAD_L = 40, PAD_B = 20, PAD_T = 8;
  const plotW = W - PAD_L - 6, plotH = H - PAD_B - PAD_T;
  const max = Math.max(...trend.map((t) => t.total), 1);
  const n = trend.length;
  const slot = plotW / n;
  const barW = Math.max(Math.min(slot * 0.66, 26), 2);

  const y = (v: number) => PAD_T + plotH * (1 - v / max);
  const ticks = [max, max / 2];

  const tipDay = hover ? trend[hover.i] : null;

  return (
    <div className="chart-box" ref={box} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
        aria-label="Daily revenue, stacked by store">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - 6} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted)">{compact(t)}</text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - 6} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--line-strong)" strokeWidth="1" />
        {trend.map((d, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={d.date}>
              {stores.map((s) => {
                const v = d.byStore[s] || 0;
                if (v <= 0) return null;
                const y0 = y(acc + v), y1 = y(acc);
                acc += v;
                return (
                  <rect key={s} x={cx - barW / 2} y={y0} width={barW}
                    height={Math.max(y1 - y0 - 1.5, 0.75)} rx="1.5"
                    fill={STORE_COLOR[s] || "#8A8175"}
                    opacity={hover && hover.i !== i ? 0.45 : 1} />
                );
              })}
              <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH + PAD_B} fill="transparent"
                onMouseEnter={() => setHover({ i, x: (PAD_L + slot * i + slot / 2) / W })} />
              {(n <= 14 || i % Math.ceil(n / 8) === 0) && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tipDay && (
        <div className="tip" style={{ left: `${Math.min(Math.max((hover!.x) * 100, 8), 82)}%` }}>
          <b>{shortDate(tipDay.date)}</b>
          <span className="tip-total">{aed(tipDay.total)}</span>
          {stores.filter((s) => (tipDay.byStore[s] || 0) > 0).map((s) => (
            <span key={s} className="tip-row">
              <i style={{ background: STORE_COLOR[s] }} />{s} <em>{aed(tipDay.byStore[s])}</em>
            </span>
          ))}
          {tipDay.total === 0 && <span className="tip-row">no orders</span>}
        </div>
      )}
      <div className="legend-row">
        {stores.map((s) => (
          <span key={s}><i style={{ background: STORE_COLOR[s] }} />{s}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Live pulse: polls /api/pulse, toasts new orders, cycles headline metrics ── */

function usePulse() {
  const [metric, setMetric] = useState<string | null>(null);
  const metricsRef = useRef<string[]>([]);
  const metricIdxRef = useRef(0);
  const sinceRef = useRef(new Date().toISOString());
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/pulse?since=${encodeURIComponent(sinceRef.current)}`);
        const json: Pulse = await res.json();
        if (stopped) return;
        for (const o of json.newOrders) {
          if (seenRef.current.has(o.uid)) continue;
          seenRef.current.add(o.uid);
          const item = o.items[0];
          toast.success(
            item
              ? `New order #${o.order_number} · ${item.title}${item.qty > 1 ? ` ×${item.qty}` : ""} · ${o.store_id}`
              : `New order #${o.order_number} · ${aed2(o.gross_aed)} · ${o.store_id}`,
            { icon: "🎉" },
          );
        }
        sinceRef.current = json.now;
        metricsRef.current = json.metrics;
        if (json.metrics.length) setMetric(json.metrics[metricIdxRef.current % json.metrics.length]);
      } catch {
        // pulse is a nicety — silent on failure
      }
    };
    poll();
    const pollTimer = setInterval(poll, 20000);
    const rotateTimer = setInterval(() => {
      if (!metricsRef.current.length) return;
      metricIdxRef.current += 1;
      setMetric(metricsRef.current[metricIdxRef.current % metricsRef.current.length]);
    }, 5000);
    return () => { stopped = true; clearInterval(pollTimer); clearInterval(rotateTimer); };
  }, []);

  return metric;
}

function PulseTicker() {
  const metric = usePulse();
  return (
    <div className="pulse">
      <span className="pulse-dot" />
      <Radio size={12} />
      <span key={metric} className="pulse-text">{metric ?? "Watching the stores for new activity…"}</span>
    </div>
  );
}

/* ── Order spotlight: the most recent order, full chain in one card ─────── */

function OrderSpotlight({ o }: { o: SpotlightOrder }) {
  const [copied, setCopied] = useState(false);
  const financeMeta = SPOTLIGHT_FINANCE[o.finance_status];
  const invMeta = { in_stock: { label: "In stock", icon: PackageCheck, tone: "ok" }, out_of_stock: { label: "Out of stock", icon: PackageX, tone: "bad" }, unknown: { label: "Stock unknown", icon: HelpCircle, tone: "muted" } }[o.inventory];

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(o.draft_message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — select the text manually.");
    }
  };

  return (
    <section className="panel spotlight">
      <header>
        <h2>Most recent order</h2>
        <span>#{o.order_number} · {o.store_id} · {o.order_date ? shortDate(o.order_date) : "—"}</span>
      </header>

      <div className="spot-grid">
        <div className="spot-cell">
          <span className="spot-label">Payment</span>
          <span className={`pill ${financeMeta.tone}`}><BadgeCheck size={12} />{financeMeta.label}</span>
          <span className="spot-sub">{aed2(o.gross_aed)} via {o.gateway}</span>
        </div>
        <div className="spot-cell">
          <span className="spot-label">Inventory</span>
          <span className={`pill ${invMeta.tone}`}><invMeta.icon size={12} />{invMeta.label}</span>
          <span className="spot-sub">{o.fulfillment_status || "unfulfilled"}</span>
        </div>
        <div className="spot-cell">
          <span className="spot-label">Courier</span>
          {o.courier ? (
            <span className="pill ok"><Truck size={12} />{o.courier}</span>
          ) : (
            <span className="pill muted"><Truck size={12} />Not assigned yet</span>
          )}
          <span className="spot-sub">{o.tracking_number ? `# ${o.tracking_number}` : `ETA ${o.eta_date}`}</span>
        </div>
        <div className="spot-cell">
          <span className="spot-label">Invoice</span>
          <a className="pill ok spot-link" href={`/api/orders/${o.uid}/invoice`} target="_blank" rel="noreferrer">
            <Download size={12} />Download PDF
          </a>
          <span className="spot-sub">{o.tracking_url ? <a href={o.tracking_url} target="_blank" rel="noreferrer">Track shipment</a> : "generated on demand"}</span>
        </div>
      </div>

      <div className="spot-lower">
        <div className="spot-customer">
          <span className="spot-label"><User size={12} /> Customer</span>
          <b>{o.customer.name || "—"}</b>
          {o.customer.email && <span><Mail size={11} />{o.customer.email}</span>}
          {o.customer.phone && <span><Phone size={11} />{o.customer.phone}</span>}
          {(o.customer.city || o.customer.country) && <span><MapPin size={11} />{[o.customer.city, o.customer.country].filter(Boolean).join(", ")}</span>}
        </div>
        <div className="spot-draft">
          <span className="spot-label">Draft message to customer</span>
          <p>{o.draft_message}</p>
          <button className="btn ghost small" onClick={copyMessage}>
            {copied ? <CheckCheck size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy message"}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── Dashboard ──────────────────────────────────────────────────────────── */

export function FounderDashboard({ version }: { version: number }) {
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [store, setStore] = useState("All");


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?days=${days}&store=${store}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      toast.error(`Dashboard load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [days, store]);

  useEffect(() => { load(); }, [load, version]);

  if (!data) {
    return <div className="empty"><Loader2 size={18} className="spin" /> Building the founder view…</div>;
  }

  const k = data.kpis;
  const trendStores = ["WA", "UAE", "KSA", "WOO"].filter((s) =>
    data.trend.some((t) => (t.byStore[s] || 0) > 0),
  );
  const maxGateway = Math.max(...data.gateways.map((g) => g.revenue), 1);
  const maxProduct = Math.max(...data.topProducts.map((p) => p.revenue), 1);

  return (
    <div className="dash" style={{ opacity: loading ? 0.6 : 1 }}>
      <style>{DASH_CSS}</style>

      <PulseTicker />

      {/* filters: one row, above everything */}
      <div className="dash-filters">
        <div className="tabs" style={{ margin: 0 }}>
          {[7, 30, 60, 90].map((d) => (
            <button key={d} className={days === d ? "tab on" : "tab"} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          {["All", "WA", "UAE", "KSA", "WOO"].map((s) => (
            <button key={s} className={store === s ? "tab on" : "tab"} onClick={() => setStore(s)}>{s}</button>
          ))}
        </div>
      </div>

      {/* KPIs: sales claims vs bank truth, clearly separated */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="kpi"><span className="kpi-label"><TrendingUp size={12} /> Revenue · {data.window.days}d {store !== "All" ? `· ${store}` : ""}</span>
          <span className="kpi-value">{aed(k.revenue)}</span>
          <span className="kpi-note">{k.orders.toLocaleString()} orders · AOV {aed(k.aov)}</span></div>
        <div className="kpi ok"><span className="kpi-label"><Landmark size={12} /> Cash into bank</span>
          <span className="kpi-value">{aed(k.bankCredits)}</span>
          <span className="kpi-note">{data.documents.bankStatement && data.documents.lastStatementDate ? `statement to ${shortDate(data.documents.lastStatementDate)}` : "no statement uploaded yet"}</span></div>
        <div className="kpi ok"><span className="kpi-label"><BadgeCheck size={12} /> Bank-settled</span>
          <span className="kpi-value">{aed(k.settled)}</span>
          <span className="kpi-note">{k.settledOrders} of {k.totalOrders} orders stamped</span></div>
        <div className="kpi warn"><span className="kpi-label"><Clock size={12} /> Awaiting payout file</span>
          <span className="kpi-value">{aed(k.awaitingPayout)}</span>
          <span className="kpi-note">bank credits not yet explained</span></div>
        <div className="kpi muted"><span className="kpi-label"><Wallet size={12} /> COD outstanding</span>
          <span className="kpi-value">{aed(k.codPendingAed)}</span>
          <span className="kpi-note">{k.codPendingCount} orders with couriers</span></div>
        <div className={`kpi ${k.exceptions ? "bad" : "muted"}`}><span className="kpi-label"><AlertTriangle size={12} /> Exceptions</span>
          <span className="kpi-value">{k.exceptions}</span>
          <span className="kpi-note">variance or unresolved orders</span></div>
      </div>

      {/* revenue trend */}
      <section className="panel">
        <header><h2>Daily revenue</h2><span>{aed(k.revenue)} across {trendStores.length} store{trendStores.length === 1 ? "" : "s"}</span></header>
        <TrendChart trend={data.trend} stores={trendStores} />
      </section>

      <div className="two-col">
        {/* payment mix */}
        <section className="panel">
          <header><h2>Payments by gateway</h2><span>order revenue</span></header>
          <div className="bars">
            {data.gateways.map((g) => (
              <div key={g.gateway} className="bar-row" title={`${g.gateway}: ${aed2(g.revenue)} · ${g.orders} orders`}>
                <span className="bar-name"><i style={{ background: GATEWAY_COLOR[g.gateway] || "#8A8175" }} />{g.gateway}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(g.revenue / maxGateway) * 100}%`, background: GATEWAY_COLOR[g.gateway] || "#8A8175" }} />
                </div>
                <span className="bar-val">{aed(g.revenue)} <em>{g.share}%</em></span>
              </div>
            ))}
            {data.gateways.length === 0 && <p className="quiet">No orders in this window.</p>}
          </div>
        </section>

        {/* payouts received (bank truth) */}
        <section className="panel">
          <header><h2>Payouts received</h2><span>bank credits by provider</span></header>
          {!data.documents.bankStatement ? (
            <p className="quiet">Upload the bank statement (top right) — every settlement that actually reached the account will appear here, by provider.</p>
          ) : (
            <>
              <div className="provider-grid">
                {data.payouts.byProvider.map((p) => (
                  <div key={p.provider} className="provider-cell">
                    <span className="p-name"><i style={{ background: GATEWAY_COLOR[p.provider] || "#8A8175" }} />{p.provider}</span>
                    <b>{aed(p.total)}</b>
                    <span className="p-sub">{p.count} credit{p.count === 1 ? "" : "s"}{p.lastDate ? ` · last ${shortDate(p.lastDate)}` : ""}</span>
                  </div>
                ))}
              </div>
              <div className="payout-list">
                {data.payouts.recent.slice(0, 6).map((p) => {
                  const m = PAYOUT_STATE[p.state] ?? PAYOUT_STATE.AWAITING_PAYOUT;
                  return (
                    <div key={p.id} className="payout-line">
                      <span className="mono">{p.date ? shortDate(p.date) : "—"}</span>
                      <span className="p-provider"><i style={{ background: GATEWAY_COLOR[p.provider] || "#8A8175" }} />{p.provider}</span>
                      <span className="mono grow">{p.reference || "—"}</span>
                      <span className={`pill ${m.tone}`}><m.icon size={11} />{p.confirmed ? "Confirmed" : m.label}</span>
                      <b className="mono">{aed2(p.amount)}</b>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {data.spotlight && <OrderSpotlight o={data.spotlight} />}

      {/* top products */}
      <section className="panel">
        <header><h2>Top performing products</h2><span>by revenue · {data.window.days}d {store !== "All" ? `· ${store}` : "· all stores"}</span></header>
        {data.topProducts.length === 0 ? (
          <p className="quiet">No line items in this window — run a sync to pull products with each order.</p>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th></th><th>#</th><th>Product</th><th>SKU</th><th>Stores</th><th style={{ textAlign: "right" }}>Units</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ width: "18%" }}></th></tr></thead>
              <tbody>
                {data.topProducts.map((p, i) => (
                  <tr key={p.sku || p.title}>
                    <td>
                      <span className="w-[2rem] h-[2rem] bg-gray-200 rounded-md flex items-center justify-center">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="prod-thumb w-[4rem] h-[4rem] object-cover" loading="lazy" />
                      ) : (
                        <span className="prod-thumb prod-thumb-empty"><Package size={13} /></span>
                      )}
                      </span>
                    </td>
                    <td className="mono quiet-cell">{i + 1}</td>
                    <td className="prod-name" title={p.title}>{p.title}</td>
                    <td className="mono quiet-cell">{p.sku || "—"}</td>
                    <td>{p.stores.map((s) => <span key={s} className="store-badge" style={{ marginRight: 4 }}>{s}</span>)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{p.qty}</td>
                    <td className="mono" style={{ textAlign: "right" }}><b>{aed(p.revenue)}</b></td>
                    <td><div className="mini-track"><div className="mini-fill" style={{ width: `${(p.revenue / maxProduct) * 100}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* recent orders */}
      <section className="panel">
        <header><h2>Latest orders</h2><span><Package size={12} style={{ verticalAlign: -2 }} /> most recent in window</span></header>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>Order</th><th>Store</th><th>Customer</th><th>Gateway</th><th>Settlement</th><th style={{ textAlign: "right" }}>AED</th></tr></thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.uid}>
                  <td className="mono">#{o.order_number}</td>
                  <td><span className="store-badge">{o.store_id}</span></td>
                  <td dir="auto">{o.customer_name || "—"}</td>
                  <td><span className="bar-name" style={{ minWidth: 0 }}><i style={{ background: GATEWAY_COLOR[o.gateway] || "#8A8175" }} />{o.gateway}</span></td>
                  <td><span className={`pill ${o.payout_status === "settled" ? "ok" : "muted"}`}>{o.payout_status === "settled" ? "Settled" : "Awaiting"}</span></td>
                  <td className="mono" style={{ textAlign: "right" }}>{aed2(o.gross_aed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const DASH_CSS = `
  .dash { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; transition: opacity .15s; }
  .dash-filters { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .dash .kpis { margin: 0; }
  .dash .kpi-label { display: inline-flex; align-items: center; gap: 5px; }

  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
  .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
  .panel h2 { font-family: Georgia, serif; font-weight: 500; font-size: 17px; margin: 0; }
  .panel header span { font-size: 12px; color: var(--muted); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .chart-box { position: relative; }
  .tip { position: absolute; top: 0; transform: translateX(-50%); background: var(--ink); color: var(--cream);
    border-radius: 9px; padding: 8px 11px; font-size: 11.5px; display: flex; flex-direction: column; gap: 3px;
    pointer-events: none; box-shadow: 0 6px 18px rgba(31,27,22,.25); min-width: 130px; z-index: 5; }
  .tip b { font-size: 12px; }
  .tip-total { font-family: Georgia, serif; font-size: 15px; }
  .tip-row { display: inline-flex; align-items: center; gap: 6px; opacity: .9; }
  .tip-row em { font-style: normal; margin-left: auto; }
  .tip-row i, .legend-row i, .bar-name i, .p-name i, .p-provider i { width: 8px; height: 8px; border-radius: 2.5px; display: inline-block; flex-shrink: 0; }
  .legend-row { display: flex; gap: 14px; font-size: 11.5px; color: var(--muted); margin-top: 8px; }
  .legend-row span { display: inline-flex; align-items: center; gap: 5px; }

  .bars { display: flex; flex-direction: column; gap: 9px; }
  .bar-row { display: flex; align-items: center; gap: 10px; }
  .bar-name { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; min-width: 128px; }
  .bar-track { flex: 1; height: 14px; background: var(--cream); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 0 4px 4px 0; min-width: 2px; transition: width .3s; }
  .bar-val { font-size: 12px; min-width: 118px; text-align: right; font-variant-numeric: tabular-nums; }
  .bar-val em { font-style: normal; color: var(--muted); margin-left: 4px; }

  .provider-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .provider-cell { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
  .provider-cell b { font-family: Georgia, serif; font-size: 17px; font-weight: 500; }
  .p-name { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); }
  .p-sub { font-size: 10.5px; color: var(--muted); }

  .payout-list { display: flex; flex-direction: column; }
  .payout-line { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 12px; }
  .payout-line .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
  .p-provider { display: inline-flex; align-items: center; gap: 6px; min-width: 80px; }

  .quiet { color: var(--muted); font-size: 13px; line-height: 1.5; margin: 0; }
  .quiet-cell { color: var(--muted); }
  .prod-name { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prod-thumb { width: 2rem; height: 2rem; border-radius: 8px; object-fit: cover; display: block; border: 1px solid var(--line); background: var(--cream); }
  .prod-thumb-empty { display: flex; align-items: center; justify-content: center; color: var(--muted); }
  .mini-track { height: 8px; background: var(--cream); border-radius: 3px; overflow: hidden; min-width: 70px; }
  .mini-fill { height: 100%; background: var(--gold); border-radius: 0 3px 3px 0; min-width: 2px; }

  /* live pulse ticker */
  .pulse { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; font-size: 12px; color: var(--gold-deep); background: var(--gold-wash); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; }
  .pulse-dot { width: 7px; height: 7px; border-radius: 999px; background: #4B7A54; box-shadow: 0 0 0 0 rgba(75,122,84,.5); animation: pulse-beat 1.8s infinite; flex-shrink: 0; }
  @keyframes pulse-beat { 0% { box-shadow: 0 0 0 0 rgba(75,122,84,.45); } 70% { box-shadow: 0 0 0 7px rgba(75,122,84,0); } 100% { box-shadow: 0 0 0 0 rgba(75,122,84,0); } }
  .pulse-text { animation: pulse-fade .35s ease-out; font-weight: 500; }
  @keyframes pulse-fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }

  /* order spotlight */
  .spotlight .spot-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
  .spot-cell { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  .spot-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
  .spot-sub { font-size: 11.5px; color: var(--muted); }
  .spot-link { text-decoration: none; width: fit-content; }
  .spot-lower { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; }
  .spot-customer { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .spot-customer b { font-family: Georgia, serif; font-size: 15px; font-weight: 500; }
  .spot-customer span { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }
  .spot-draft { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--cream); }
  .spot-draft p { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--ink); }
  .btn.small { padding: 6px 12px; font-size: 12px; align-self: flex-start; }

  @media (max-width: 900px) {
    .two-col { grid-template-columns: 1fr; }
    .dash .kpis { grid-template-columns: repeat(2, 1fr) !important; }
    .spotlight .spot-grid { grid-template-columns: repeat(2, 1fr); }
    .spot-lower { grid-template-columns: 1fr; }
  }
`;
