"use client";

/* Daily settlement report — the audit trail (settlement_records) rendered
   day by day: every order whose bank credit was confirmed that day, grouped
   by gateway, with a Zoho Books-ready CSV export. This is what an accountant
   gets pointed at, not the live (mutable) orders table. */

import { CalendarDays, CheckCircle2, Download, FileSpreadsheet, Landmark, Loader2, RefreshCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Record_ = {
  id: string; order_number: string; store_id: string; customer_name: string;
  customer_email: string; order_date: string | null; settlement_date: string | null;
  gateway: string; gross_aed: number; bank_reference: string; payout_id: string | null;
};
type Daily = {
  date: string;
  records: Record_[];
  byGateway: { gateway: string; count: number; gross: number }[];
  total: number;
  recentDates: { date: string; count: number; total: number }[];
};

const GATEWAY_COLOR: Record<string, string> = {
  Stripe: "#2a78d6", Telr: "#1baf7a", Checkout: "#eda100", Tabby: "#008300",
  Tamara: "#4a3aa7", "Shopify Payments": "#e34948", COD: "#e87ba4", Unclassified: "#8A8175",
};

const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
const aed2 = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);
const longDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const shortDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

type SyncStatus = {
  telr: boolean;
  stripe: boolean;
  lastRun: {
    trigger: string;
    finished_at: string | null;
    gateway_results: { provider: string; fetched: number; saved: number; error?: string }[];
    recon_summary: { total: number; settled: number; awaitingPayout: number; payoutVariance: number; ordersUnresolved: number } | null;
  } | null;
};

// Persistent payout-verification status — the in-app scheduler keeps pulling
// gateway payouts + re-reconciling in the background; this surfaces the last
// cycle so founders can see it's actually running, not just take it on faith.
function PayoutSyncBadge() {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch("/api/integrations/payouts").then((r) => r.json()).then((d) => { if (!cancelled) setStatus(d); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!status) return null;
  const run = status.lastRun;
  const byProvider = new Map((run?.gateway_results ?? []).map((r) => [r.provider, r]));

  const chip = (provider: string, configured: boolean) => {
    const r = byProvider.get(provider);
    const ok = configured && r && !r.error;
    const failed = configured && r?.error;
    return (
      <span key={provider} className="sync-chip" title={r?.error || (r ? `${r.saved} payout(s) saved` : undefined)}>
        {ok ? <CheckCircle2 size={12} className="ok" /> : failed ? <XCircle size={12} className="bad" /> : null}
        {provider}
        {!configured && " · manual upload"}
        {failed && " · API error"}
      </span>
    );
  };

  return (
    <div className="sync-badge">
      <RefreshCcw size={12} />
      <span>Payout verification {run?.finished_at ? `· last run ${timeAgo(run.finished_at)}` : "· no runs yet"}</span>
      {chip("Stripe", status.stripe)}
      {chip("Telr", status.telr)}
    </div>
  );
}

export function ReportsPanel({ version }: { version: number }) {
  const [data, setData] = useState<Daily | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string | null>(null);

  const load = useCallback(async (d?: string | null) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/daily${d ? `?date=${d}` : ""}`);
      const json: Daily = await res.json();
      setData(json);
      setDate(json.date);
    } catch (e) {
      toast.error(`Report load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <div className="empty"><Loader2 size={18} className="spin" /> Building the daily report…</div>;
  if (!data || data.recentDates.length === 0) {
    return (
      <div className="empty">
        No settled days yet. A day appears here the moment a bank credit is confirmed settled in Reconciliation —
        that confirmation is what gets recorded as proof, ready to export to Zoho Books.
      </div>
    );
  }

  return (
    <div className="reports">
      <style>{REPORTS_CSS}</style>

      <PayoutSyncBadge />

      <div className="reports-datebar">
        {data.recentDates.map((d) => (
          <button key={d.date} className={d.date === data.date ? "datechip on" : "datechip"} onClick={() => load(d.date)}>
            <CalendarDays size={12} />
            <span>{shortDate(d.date)}</span>
            <em>{aed(d.total)}</em>
          </button>
        ))}
      </div>

      <section className="panel" style={{ opacity: loading ? 0.6 : 1 }}>
        <header>
          <h2>{longDate(data.date)}</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span>{data.records.length} settled order{data.records.length === 1 ? "" : "s"} · {aed2(data.total)}</span>
            <a className="btn primary small" href={`/api/reports/daily/export?date=${data.date}`}>
              <Download size={13} /> Export CSV for Zoho Books
            </a>
          </div>
        </header>

        {data.byGateway.length > 0 && (
          <div className="provider-grid" style={{ marginBottom: 18 }}>
            {data.byGateway.map((g) => (
              <div key={g.gateway} className="provider-cell">
                <span className="p-name"><i style={{ background: GATEWAY_COLOR[g.gateway] || "#8A8175" }} />{g.gateway}</span>
                <b>{aed(g.gross)}</b>
                <span className="p-sub">{g.count} order{g.count === 1 ? "" : "s"} settled</span>
              </div>
            ))}
          </div>
        )}

        {data.records.length === 0 ? (
          <p className="quiet">No settlements recorded for this day.</p>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr><th>Order</th><th>Store</th><th>Customer</th><th>Gateway</th><th>Bank ref</th><th style={{ textAlign: "right" }}>AED</th></tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">#{r.order_number}</td>
                    <td><span className="store-badge">{r.store_id}</span></td>
                    <td dir="auto">{r.customer_name || "—"}</td>
                    <td><span className="bar-name" style={{ minWidth: 0 }}><i style={{ background: GATEWAY_COLOR[r.gateway] || "#8A8175" }} />{r.gateway}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.bank_reference || "—"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{aed2(r.gross_aed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="reports-note">
        <Landmark size={13} /> Every row here was written the moment its bank credit was confirmed settled —
        an immutable record independent of later syncs. <FileSpreadsheet size={13} /> The CSV export maps
        directly onto Zoho Books' invoice import.
      </p>
    </div>
  );
}

const REPORTS_CSS = `
  .reports { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
  .reports-datebar { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
  .datechip { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; border: 1px solid var(--line); background: var(--card); border-radius: 10px; padding: 8px 12px; cursor: pointer; flex-shrink: 0; }
  .datechip span { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
  .datechip em { font-style: normal; font-size: 13px; font-weight: 600; }
  .datechip.on { border-color: var(--gold); background: var(--gold-wash); }
  .datechip.on span, .datechip.on em { color: var(--gold-deep); }
  .reports-note { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin: 0; }
  .reports-note svg { flex-shrink: 0; color: var(--gold); vertical-align: -2px; margin-right: 4px; }
  .sync-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .sync-badge > svg { color: var(--gold); flex-shrink: 0; }
  .sync-chip { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--ink); }
  .sync-chip .ok { color: #1baf7a; }
  .sync-chip .bad { color: #d9534f; }
`;
