"use client";

/* Founder dashboard v2 — visual-first. Gradient hero (headline money),
   AI insight rail (what needs attention + actions), chart grid, order
   spotlight, latest orders. Data spine unchanged: /api/dashboard +
   /api/insights. Every number on screen drills into a drawer or dialog. */

import {
  Loader2, Radio, Truck, Download, User, MapPin, Mail, Phone, Copy, CheckCheck,
  BadgeCheck, PackageCheck, PackageX, HelpCircle, Package, ArrowRight,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { InvoiceModal } from "@/components/finance/invoice-modal";
import { CampaignDrawer } from "@/components/finance/CampaignDrawer";
import type { Dash, MoneyDrawerKind, SpotlightOrder } from "./types";
import { STORE_COLOR, GATEWAY_COLOR, aed2, shortDate } from "./types";
import { HeroBand } from "./hero";
import { InsightRail } from "./insight-rail";
import { RevenueArea, GatewayDonut, TopProductsCarousel, CHARTS_CSS } from "./charts";
import { MoneyDrawer } from "./money-drawer";

/* ── live pulse (unchanged behavior: poll /api/pulse, toast new orders) ──── */

type Pulse = {
  now: string;
  newOrders: { uid: string; order_number: string; store_id: string; customer_name: string; gross_aed: number; gateway: string; items: { title: string; qty: number }[] }[];
  metrics: string[];
};

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
    <div className="dv2-pulse">
      <span className="dv2-pulse-dot" />
      <Radio size={12} />
      <span key={metric} className="dv2-pulse-text">{metric ?? "Watching the stores for new activity…"}</span>
    </div>
  );
}

/* ── order spotlight (ported, re-skinned) ───────────────────────────────── */

const SPOT_FINANCE: Record<SpotlightOrder["finance_status"], { label: string; tone: string }> = {
  SETTLED: { label: "Payment settled", tone: "ok" },
  AWAITING_BANK: { label: "Awaiting bank", tone: "warn" },
  MISSING_PAYOUT: { label: "Missing payout file", tone: "muted" },
  COD_PENDING: { label: "Cash on delivery", tone: "muted" },
};

function OrderSpotlight({ o }: { o: SpotlightOrder }) {
  const [copied, setCopied] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const financeMeta = SPOT_FINANCE[o.finance_status];
  const invMeta = {
    in_stock: { label: "In stock", icon: PackageCheck, tone: "ok" },
    out_of_stock: { label: "Out of stock", icon: PackageX, tone: "bad" },
    unknown: { label: "Stock unknown", icon: HelpCircle, tone: "muted" },
  }[o.inventory];

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
    <section className="dv2-panel">
      <header className="dv2-panel-head">
        <h2>Most recent order</h2>
        <span>#{o.order_number} · {o.store_id} · {o.order_date ? shortDate(o.order_date) : "—"}</span>
      </header>

      <div className="spot-grid">
        <div className="spot-cell">
          <span className="spot-label">Payment</span>
          <span className={`dv2-pill ${financeMeta.tone}`}><BadgeCheck size={12} />{financeMeta.label}</span>
          <span className="spot-sub">{aed2(o.gross_aed)} via {o.gateway}</span>
        </div>
        <div className="spot-cell">
          <span className="spot-label">Inventory</span>
          <span className={`dv2-pill ${invMeta.tone}`}><invMeta.icon size={12} />{invMeta.label}</span>
          <span className="spot-sub">{o.fulfillment_status || "unfulfilled"}</span>
        </div>
        <div className="spot-cell">
          <span className="spot-label">Courier</span>
          {o.courier ? (
            <span className="dv2-pill ok"><Truck size={12} />{o.courier}</span>
          ) : (
            <span className="dv2-pill muted"><Truck size={12} />Not assigned yet</span>
          )}
          <span className="spot-sub">{o.tracking_number ? `# ${o.tracking_number}` : `ETA ${o.eta_date}`}</span>
        </div>
        <div className="spot-cell">
          <button className="dv2-pill ok spot-link" onClick={() => setInvoiceOpen(true)}>
            <Download size={12} />Generate invoice
          </button>
          <span className="spot-label">Invoice</span>
          <span className="spot-sub">{o.tracking_url ? <a href={o.tracking_url} target="_blank" rel="noreferrer">Track shipment</a> : "confirm courier & address first"}</span>
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
          <button className="spot-copy" onClick={copyMessage}>
            {copied ? <CheckCheck size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy message"}
          </button>
        </div>
      </div>

      {invoiceOpen && (
        <InvoiceModal
          order={{
            uid: o.uid,
            order_number: o.order_number,
            order_date: o.order_date,
            customer_name: o.customer.name,
            customer_phone: o.customer.phone,
            city: o.customer.city,
            country: o.customer.country,
            gateway: o.gateway,
            gross_aed: o.gross_aed,
            currency: "AED",
          }}
          onClose={() => setInvoiceOpen(false)}
        />
      )}
    </section>
  );
}

/* ── dashboard ──────────────────────────────────────────────────────────── */

export function FounderDashboard({ version }: { version: number }) {
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [store, setStore] = useState("All");
  const [drawer, setDrawer] = useState<MoneyDrawerKind>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);

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
    return <div className="dv2-loading"><style>{DASH_CSS}</style><Loader2 size={18} className="dv2-spin" /> Building your view…</div>;
  }

  const trendStores = ["WA", "UAE", "KSA", "WOO"].filter((s) =>
    data.trend.some((t) => (t.byStore[s] || 0) > 0),
  );

  return (
    <div className="dv2" style={{ opacity: loading ? 0.65 : 1 }}>
      <style>{DASH_CSS}</style>
      <style>{CHARTS_CSS}</style>

      <PulseTicker />

      <HeroBand data={data} days={days} store={store} onDays={setDays} onStore={setStore} onOpenDrawer={setDrawer} />

      <InsightRail days={days} store={store} onViewCampaign={setCampaignId} onViewMoney={setDrawer} />

      <div className="dv2-grid">
        <section className="dv2-panel dv2-span2">
          <header className="dv2-panel-head">
            <h2>Daily revenue</h2>
            <span>stacked by store · hover for detail</span>
          </header>
          <RevenueArea trend={data.trend} stores={trendStores} />
          <div className="dv2-legend">
            {trendStores.map((s) => <span key={s}><i style={{ background: STORE_COLOR[s] }} />{s}</span>)}
          </div>
        </section>

        <section className="dv2-panel">
          <header className="dv2-panel-head">
            <h2>Payment mix</h2>
            <span>share of revenue</span>
          </header>
          <GatewayDonut gateways={data.gateways} total={data.kpis.revenue} />
        </section>
      </div>

      <section className="dv2-panel">
        <header className="dv2-panel-head">
          <h2>Top performing products</h2>
          <span>by revenue · {data.window.days}d {store !== "All" ? `· ${store}` : "· all stores"}</span>
        </header>
        <TopProductsCarousel products={data.topProducts} />
      </section>

      {data.spotlight && <OrderSpotlight o={data.spotlight} />}

      <section className="dv2-panel">
        <header className="dv2-panel-head">
          <h2>Latest orders</h2>
          <a className="dv2-more" href="/orders">All orders <ArrowRight size={12} /></a>
        </header>
        <div className="dv2-orders">
          {data.recentOrders.map((o) => (
            <div key={o.uid} className="dv2-order">
              <span className="dv2-order-store" style={{ background: `${STORE_COLOR[o.store_id] ?? "#94a3b8"}22`, color: STORE_COLOR[o.store_id] ?? "#94a3b8" }}>{o.store_id}</span>
              <span className="dv2-order-num">#{o.order_number}</span>
              <span className="dv2-order-name" dir="auto">{o.customer_name || "—"}</span>
              <span className="dv2-order-gw"><i style={{ background: GATEWAY_COLOR[o.gateway] ?? "#94a3b8" }} />{o.gateway}</span>
              <span className={`dv2-pill ${o.payout_status === "settled" ? "ok" : "muted"}`}>{o.payout_status === "settled" ? "Settled" : "Awaiting"}</span>
              <b>{aed2(o.gross_aed)}</b>
            </div>
          ))}
          {data.recentOrders.length === 0 && <p className="dv2-quiet">No orders in this window.</p>}
        </div>
      </section>

      <MoneyDrawer kind={drawer} data={data} onClose={() => setDrawer(null)} />
      {campaignId && <CampaignDrawer campaignId={campaignId} days={days} onClose={() => setCampaignId(null)} />}
    </div>
  );
}

const DASH_CSS = `
  .dv2 { display: flex; flex-direction: column; gap: 18px; margin-top: 18px; transition: opacity .15s; }
  .dv2 * { box-sizing: border-box; }
  .dv2-loading { display: flex; gap: 10px; align-items: center; justify-content: center; padding: 60px; color: #8A8175; font-size: 14px; }
  .dv2-spin { animation: dv2spin 1s linear infinite; }
  @keyframes dv2spin { to { transform: rotate(360deg); } }

  .dv2-pulse { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; font-size: 12px; color: #6F5325;
    background: linear-gradient(120deg, #FBF3E6, #f3e8ff); border: 1px solid #EAE3D6; border-radius: 999px; padding: 7px 14px; }
  .dv2-pulse-dot { width: 7px; height: 7px; border-radius: 999px; background: #10b981; box-shadow: 0 0 0 0 rgba(16,185,129,.5); animation: dv2beat 1.8s infinite; flex-shrink: 0; }
  @keyframes dv2beat { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.45); } 70% { box-shadow: 0 0 0 7px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
  .dv2-pulse-text { animation: dv2fade .35s ease-out; font-weight: 500; }
  @keyframes dv2fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }

  .dv2-panel { background: #fff; border: 1px solid #EAE3D6; border-radius: 20px; padding: 20px 22px;
    box-shadow: 0 10px 30px -22px rgba(31,27,22,.25); }
  .dv2-panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .dv2-panel-head h2 { font-family: Georgia, serif; font-weight: 500; font-size: 17px; margin: 0; color: #1F1B16; }
  .dv2-panel-head span { font-size: 12px; color: #8A8175; }
  .dv2-more { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: #7c3aed; text-decoration: none; }
  .dv2-more:hover { text-decoration: underline; }

  .dv2-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 18px; }
  .dv2-legend { display: flex; gap: 14px; font-size: 11.5px; color: #8A8175; margin-top: 6px; }
  .dv2-legend span { display: inline-flex; align-items: center; gap: 5px; }
  .dv2-legend i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }

  .dv2-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 10px; border-radius: 999px; font-weight: 500; }
  .dv2-pill.ok { background: #d1fae5; color: #047857; } .dv2-pill.bad { background: #fee2e2; color: #dc2626; }
  .dv2-pill.warn { background: #fef3c7; color: #b45309; } .dv2-pill.muted { background: #F3EFE7; color: #8A8175; }
  .dv2-quiet { color: #8A8175; font-size: 13px; margin: 0; }

  /* spotlight */
  .spot-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  .spot-cell { display: flex; flex-direction: column; gap: 6px; border: 1px solid #EAE3D6; border-radius: 14px; padding: 12px 14px; }
  .spot-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: #8A8175; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
  .spot-sub { font-size: 11.5px; color: #8A8175; }
  .spot-sub a { color: #7c3aed; }
  .spot-link { border: 0; cursor: pointer; font: inherit; width: fit-content; }
  .spot-lower { display: grid; grid-template-columns: 1fr 1.4fr; gap: 14px; }
  .spot-customer { display: flex; flex-direction: column; gap: 6px; border: 1px solid #EAE3D6; border-radius: 14px; padding: 14px; }
  .spot-customer b { font-family: Georgia, serif; font-size: 15px; font-weight: 500; }
  .spot-customer span { font-size: 12px; color: #8A8175; display: inline-flex; align-items: center; gap: 6px; }
  .spot-draft { display: flex; flex-direction: column; gap: 8px; border-radius: 14px; padding: 14px; background: linear-gradient(120deg, #FBF3E6, #f5f3ff); }
  .spot-draft p { margin: 0; font-size: 12.5px; line-height: 1.6; color: #1F1B16; }
  .spot-copy { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; border: 1px solid #EAE3D6; background: #fff;
    border-radius: 9px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; color: #6F5325; }
  .spot-copy:hover { border-color: #c4b5fd; color: #7c3aed; }

  /* latest orders */
  .dv2-orders { display: flex; flex-direction: column; gap: 7px; }
  .dv2-order { display: flex; align-items: center; gap: 12px; border: 1px solid #EAE3D6; border-radius: 12px; padding: 9px 14px; font-size: 12.5px; transition: border-color .15s, transform .15s; }
  .dv2-order:hover { border-color: #c4b5fd; transform: translateX(2px); }
  .dv2-order-store { font-size: 10.5px; font-weight: 800; border-radius: 7px; padding: 3px 8px; }
  .dv2-order-num { font-family: ui-monospace, monospace; font-size: 12px; min-width: 72px; }
  .dv2-order-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dv2-order-gw { display: inline-flex; align-items: center; gap: 6px; color: #8A8175; min-width: 90px; }
  .dv2-order-gw i { width: 8px; height: 8px; border-radius: 2.5px; }
  .dv2-order b { font-variant-numeric: tabular-nums; min-width: 96px; text-align: right; }

  @media (max-width: 980px) {
    .dv2-grid { grid-template-columns: 1fr; }
    .spot-grid { grid-template-columns: repeat(2, 1fr); }
    .spot-lower { grid-template-columns: 1fr; }
  }
  @media (max-width: 620px) {
    .dv2-order-gw { display: none; }
    .dv2-order-name { display: none; }
  }
`;
