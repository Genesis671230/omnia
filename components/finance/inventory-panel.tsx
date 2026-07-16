"use client";

/* Cross-platform inventory comparison — Zoho's authoritative stock_on_hand
   vs live Shopify (per store) and WooCommerce quantities, plus recent store
   orders with no matching Zoho sales order (see lib/zoho-sync.ts,
   lib/inventory-compare.ts). Read-only: this panel never writes to Zoho. */

import { AlertTriangle, Boxes, CheckCircle2, Loader2, PackageX, RefreshCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type StockMismatch = {
  sku: string;
  name: string;
  zohoStock: number;
  storeStock: { storeId: string; quantity: number | null }[];
  maxDiff: number;
};

type MissingOrder = { uid: string; orderNumber: string; storeId: string; orderDate: string | null; grossAed: number };

type Summary = {
  mismatches: StockMismatch[];
  missingOrders: MissingOrder[];
  counts: { zohoItems: number; storeInventoryRows: number; zohoOrders: number };
};

type SyncStatus = {
  zoho: boolean;
  shopify: string[];
  woo: boolean;
  lastRun: {
    trigger: string;
    finished_at: string | null;
    source_results: { source: string; fetched: number; saved: number; error?: string }[];
  } | null;
};

const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

function ZohoSyncBadge({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/integrations/zoho").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/zoho", { method: "POST" });
      const json = await res.json();
      for (const r of json.results ?? []) {
        if (r.error) toast.error(`${r.source}: ${r.error}`);
        else toast.success(`${r.source}: ${r.saved} synced`);
      }
      load();
      onSynced();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (!status) return null;
  const run = status.lastRun;
  const bySource = new Map((run?.source_results ?? []).map((r) => [r.source, r]));
  const sources = ["zoho-items", "zoho-orders", ...status.shopify.map((c) => `shopify-${c}`), ...(status.woo ? ["woo"] : [])];

  const chip = (source: string, label: string) => {
    const r = bySource.get(source);
    const ok = r && !r.error;
    const failed = r?.error;
    return (
      <span key={source} className="sync-chip" title={r?.error || (r ? `${r.saved} saved` : undefined)}>
        {ok ? <CheckCircle2 size={12} className="ok" /> : failed ? <XCircle size={12} className="bad" /> : null}
        {label}
      </span>
    );
  };
console.log(status,status.shopify);
  return (
    <div className="sync-badge">
      <RefreshCcw size={12} />
      <span>Inventory sync {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
      {chip("zoho-items", "Zoho items")}
      {chip("zoho-orders", "Zoho orders")}
      {status.shopify.map((c) => chip(`shopify-${c}`, `Shopify ${c}`))}
      {status.woo && chip("woo", "WooCommerce")}
      {sources.length === 0 && <span className="quiet">Nothing configured yet</span>}
      <button className="btn small" disabled={syncing} onClick={syncNow} style={{ marginLeft: "auto" }}>
        {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />} Sync now
      </button>
    </div>
  );
}

export function InventoryPanel() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory/summary");
      const json: Summary = await res.json();
      setData(json);
    } catch (e) {
      toast.error(`Inventory data load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="inventory">
      <style>{INVENTORY_CSS}</style>

      <ZohoSyncBadge onSynced={load} />

      {loading && !data ? (
        <div className="empty"><Loader2 size={18} className="spin" /> Loading inventory comparison…</div>
      ) : !data || (data.counts.zohoItems === 0 && data.counts.storeInventoryRows === 0) ? (
        <div className="empty">
          No inventory data synced yet. Connect Zoho and store credentials in .env, then use &quot;Sync now&quot; above.
        </div>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <span className="stat-label"><Boxes size={12} /> Zoho SKUs tracked</span>
              <b>{data.counts.zohoItems}</b>
            </div>
            <div className="stat-card">
              <span className="stat-label"><Boxes size={12} /> Live store inventory rows</span>
              <b>{data.counts.storeInventoryRows}</b>
            </div>
            <div className={data.mismatches.length ? "stat-card warn" : "stat-card"}>
              <span className="stat-label"><AlertTriangle size={12} /> Stock mismatches</span>
              <b>{data.mismatches.length}</b>
            </div>
            <div className={data.missingOrders.length ? "stat-card warn" : "stat-card"}>
              <span className="stat-label"><PackageX size={12} /> Orders missing from Zoho</span>
              <b>{data.missingOrders.length}</b>
            </div>
          </div>

          <section className="panel">
            <header><h2>Stock mismatches</h2><span>Zoho stock_on_hand vs live store quantity, by SKU</span></header>
            {data.mismatches.length === 0 ? (
              <p className="quiet">No mismatches — every synced SKU agrees with Zoho.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th><th>Name</th>
                      <th style={{ textAlign: "right" }}>Zoho stock</th>
                      <th>Store quantities</th>
                      <th style={{ textAlign: "right" }}>Max diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mismatches.map((m) => (
                      <tr key={m.sku}>
                        <td className="mono">{m.sku}</td>
                        <td>{m.name}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{m.zohoStock}</td>
                        <td>
                          {m.storeStock.map((s) => (
                            <span key={s.storeId} className="store-badge">{s.storeId}: {s.quantity ?? "—"}</span>
                          ))}
                        </td>
                        <td className="mono diff" style={{ textAlign: "right" }}>{m.maxDiff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <header><h2>Orders missing from Zoho</h2><span>Last 30 days, no matching Zoho sales order</span></header>
            {data.missingOrders.length === 0 ? (
              <p className="quiet">No gaps — every recent order has a matching Zoho reference.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th><th>Store</th><th>Date</th>
                      <th style={{ textAlign: "right" }}>Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.missingOrders.map((o) => (
                      <tr key={o.uid}>
                        <td className="mono">#{o.orderNumber}</td>
                        <td><span className="store-badge">{o.storeId}</span></td>
                        <td>{o.orderDate ? new Date(o.orderDate).toLocaleDateString() : "—"}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{aed(o.grossAed)}</td>
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
  .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
  .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
  .sync-chip .ok { color: #1baf7a; }
  .sync-chip .bad { color: #d9534f; }
  .empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .stat-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--card); display: flex; flex-direction: column; gap: 6px; }
  .stat-card.warn { border-color: #d9534f66; }
  .stat-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
  .stat-card b { font-size: 20px; }
  .panel { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
  .panel header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; flex-wrap: wrap; gap: 4px; }
  .panel header h2 { font-size: 16px; margin: 0; }
  .panel header span { font-size: 12.5px; color: var(--muted); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
  td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .mono { font-variant-numeric: tabular-nums; }
  .diff { color: #d9534f; font-weight: 700; }
  .store-badge { display: inline-block; font-size: 11px; font-weight: 600; background: var(--gold-wash); color: var(--gold-deep); border-radius: 6px; padding: 2px 7px; margin-right: 6px; }
  .quiet { color: var(--muted); font-size: 13px; }
`;
