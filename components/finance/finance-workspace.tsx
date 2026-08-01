"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Omnia Finance OS — bank-first finance workspace.

   Bank is the only source of truth. Every reconciliation row proves a chain:
       BANK CREDIT ──► PAYOUT FILE ──► ORDERS
   A link is either resolved (gold) or broken (muted/red). An order is only
   "Settled" when the whole chain resolves. Confirm is gated to the Founder.

   All data comes from Supabase-backed API routes:
     GET  /api/reconcile        — recompute + return chain lines
     GET  /api/orders           — normalized orders with finance status
     POST /api/sync             — pull Shopify (WA/UAE/KSA) + Woo into Supabase
     POST /api/upload/bank      — parse bank statement, any bank (PDF/CSV/TXT)
     POST /api/upload/payout    — parse payout file (Telr xls, Stripe csv, …)
     POST /api/reconcile/confirm
   ─────────────────────────────────────────────────────────────────────────── */

import {
  Landmark, FileSpreadsheet, Package, ArrowRight, Check, AlertTriangle,
  Clock, HelpCircle, Upload, ShieldCheck, ChevronDown, Lock, BadgeCheck,
  RefreshCcw, Loader2, LayoutDashboard, ChartNoAxesCombined, PackageSearch,
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

const NAV: { href: string; view: FinanceView; label: string; icon: React.ElementType }[] = [
  { href: "/", view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  // { href: "/sales", view: "sales", label: "Sales", icon: ChartNoAxesCombined },
  { href: "/orders", view: "orders", label: "Orders", icon: PackageSearch },
  { href: "/reconciliation", view: "reconciliation", label: "Reconciliation", icon: RefreshCcw },
  { href: "/payouts", view: "payouts", label: "Payouts", icon: WalletCards },
  { href: "/documents", view: "documents", label: "Bank actuals", icon: FolderOpen },
  { href: "/returns", view: "returns", label: "Returns", icon: RotateCcw },
  // { href: "/reports", view: "reports", label: "Reports", icon: FileChartColumn },
  { href: "/marketing", view: "marketing", label: "Marketing", icon: Megaphone },
  { href: "/inventory", view: "inventory", label: "Inventory", icon: Boxes },
  { href: "/customers", view: "customers", label: "Customers", icon: Users },
  { href: "/settings", view: "settings", label: "Settings", icon: Settings },
];

const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
const aed2 = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

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
      <button className={`btn ${ghost ? "ghost" : ""}`} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {label}
      </button>
      <input ref={input} type="file" className="hidden-input" accept={accept}
        onChange={(e) => upload(e.target.files?.[0])} />
    </>
  );
}

/* ── Workspace ──────────────────────────────────────────────────────────── */

const VIEW_META: Record<FinanceView, { title: string; sub: string }> = {
  dashboard: { title: "Financial command centre", sub: "One bank-grounded view of settlements and cash exposure across all four Omnia stores." },
  sales: { title: "Sales intelligence", sub: "Unified sales across WhatsApp, Shopify UAE, Shopify KSA, and WooCommerce." },
  orders: { title: "Order ledger", sub: "Every order traced from checkout through payout file and bank settlement." },
  reconciliation: { title: "Bank reconciliation", sub: "Bank is the only source of truth. Every credit must be explained by a payout file, and every payout must resolve to real orders before it counts as settled." },
  payouts: { title: "Gateway payouts", sub: "Settlement batches from every payment provider, linked to bank-confirmed credits." },
  documents: { title: "Bank actuals", sub: "Every bank statement and gateway payout file ever uploaded — upload here, or download exactly what was ingested." },
  returns: { title: "Returns monitor", sub: "Returns and refund exposure." },
  reports: { title: "Finance reports", sub: "Founder-ready settlement packs." },
  marketing: { title: "Marketing performance", sub: "Ad spend and conversions from Meta, Google, TikTok, and Snapchat, next to actual store revenue for each store." },
  inventory: { title: "Inventory sync", sub: "Zoho's authoritative stock next to live Shopify and WooCommerce quantities, plus recent orders missing from Zoho." },
  customers: { title: "Customers", sub: "Every customer ranked by lifetime spend across all stores, with full cross-store order history, expected LTV, and blended acquisition cost." },
  settings: { title: "Workspace settings", sub: "Stores, gateways, and reporting preferences." },
};

export function FinanceWorkspace({ view = "reconciliation" }: { view?: FinanceView }) {
  const pathname = usePathname();
  const [isFounder, setIsFounder] = useState(true);
  const [recon, setRecon] = useState<ReconPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState("all");
  const [dashVersion, setDashVersion] = useState(0);
  // Date-range filter for the reconciliation view + export — bank credit
  // matching still runs over ALL data (a payout can straddle the boundary),
  // only the displayed/exported lines are scoped to the window.
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

  // Bank credits and order status change as the persistent payout-sync
  // scheduler runs — poll so a founder watching this view sees settlements
  // land without needing to hit "Sync stores" themselves.
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
  // The bank-settlement KPI bar and document checklist below belong to the
  // reconciliation chain (bank → payout → orders) — showing them on pages
  // with their own contextual metrics (marketing spend, inventory mismatch
  // counts, report totals) is noise, not "each page's own view of metrics".
  const showReconContext = view === "reconciliation" || view === "orders" || view === "sales" || view === "payouts" || view === "returns";
  const meta = VIEW_META[view] ?? VIEW_META.reconciliation;

  return (
    <div className="wrap">
      <style>{CSS}</style>

      <nav className="topnav" aria-label="Finance navigation">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={pathname === n.href ? "topnav-item on" : "topnav-item"}>
            <n.icon size={13} />{n.label}
          </Link>
        ))}
      </nav>


      {/* {view !=="orders"&&(
         */}
        <header className="top">
        <div>
          {/* <p className="eyebrow">{meta.title}</p> */}
          {/* <h1>{meta.title}</h1> */}
          {/* <p className="sub">{meta.sub}</p> */}
        </div>
        <div className="top-right">
          {/* <div className="role">
            <span className="role-label">Viewing as</span>
            <div className="role-switch">
              <button className={isFounder ? "on" : ""} onClick={() => setIsFounder(true)}>Founder</button>
              <button className={!isFounder ? "on" : ""} onClick={() => setIsFounder(false)}>Operator</button>
            </div>
          </div> */}
          <div className="top-actions fixed top-6">
            <button className="btn" disabled={syncing} onClick={sync}>
              {syncing ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />} Sync stores
            </button>
            {view === "reconciliation" && (
              <>
                {/* Export follows the same range the view is scoped to — the
                    filter bar below owns those dates now. */}
                <a className="btn ghost" href={`/api/reconcile/export${(() => {
                  const p = new URLSearchParams();
                  if (fromDate) p.set("from", fromDate);
                  if (toDate) p.set("to", toDate);
                  const qs = p.toString();
                  return qs ? `?${qs}` : "";
                })()}`}>
                  <FileChartColumn size={14} /> Export
                </a>
                <UploadButton endpoint="/api/upload/bank" accept=".pdf,.csv,.txt,.xls,.xlsx"
                  label="Upload bank statement" onDone={refresh} />
              </>
            )}
          </div>
        </div>
      </header>
          {/* )} */}

      {showReconContext && view !== "reconciliation" && (
        <div className="range-bar">
          <label>From <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label>To <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} /></label>
          {(fromDate || toDate) && (
            <button className="btn ghost" onClick={() => { setFromDate(""); setToDate(""); }}>Clear range</button>
          )}
          <a className="btn ghost" href={`/api/reconcile/export${(() => {
            const p = new URLSearchParams();
            if (fromDate) p.set("from", fromDate);
            if (toDate) p.set("to", toDate);
            const qs = p.toString();
            return qs ? `?${qs}` : "";
          })()}`}>
            <FileChartColumn size={14} /> Export reconciliation
          </a>
        </div>
      )}

      {/* Document checklist — what's missing before things can settle */}
      {showReconContext && recon &&   (
        !recon.documents.bankStatement ||
        recon.documents.missingPayouts.length > 0 ||
        recon.documents.range?.noStatementForRange 
      ) && (
        <div className="docs">
          <span className="docs-title"><FileSpreadsheet size={13} /> Documents required</span>
          {!recon.documents.bankStatement && (
            <span className="doc-chip bad">✕ Bank statement — upload the daily statement (PDF or CSV, any bank) to start</span>
          )}
          {recon.documents.range?.noStatementForRange && (
            <span className="doc-chip bad">
              ✕ No bank statement covers {recon.documents.range.from ?? "the start"} → {recon.documents.range.to ?? "the end"} —
              upload that period's statement, or widen the range
            </span>
          )}
          {recon.documents.missingPayouts.map((d) => (
            <span key={d.provider} className="doc-chip warn">
              ✕ {d.provider} payout file · {aed(d.awaitingAmount)} waiting to be explained
            </span>
          ))}
          {recon.documents.bankStatement && recon.documents.missingPayouts.length === 0 && !recon.documents.range?.noStatementForRange && (
            <span className="doc-chip ok">✓ All documents present</span>
          )}
        </div>
      )}

      {showReconContext && view !=="orders"&& (
        <div className="kpis">
          <Kpi label="Bank-confirmed settled" value={aed(sum(settled))} note={`${settled.length} of ${lines.length} credit lines`} tone="ok" />
          <Kpi label="Awaiting payout file" value={aed(sum(buckets.awaiting))} note={`${buckets.awaiting.length} lines · money in transit`} tone="info" />
          <Kpi label="Orders settled" value={`${recon?.settledOrders ?? 0} / ${recon?.totalOrders ?? 0}`} note="stamped by bank-confirmed payouts" tone="ok" />
          <Kpi label="Exceptions" value={String(buckets.variance.length + buckets.unresolved.length)} note="variance or unresolved orders" tone={buckets.variance.length + buckets.unresolved.length ? "bad" : "muted"} />
        </div>
      )}

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
          onRange={(f, t) => { setFromDate(f); setToDate(t); }}
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

      <footer className="foot">
        <ShieldCheck size={14} />
        Parsing and matching run server-side. This surface is for review and confirmation — the bank line is truth,
        everything else must earn its place against it.
      </footer>

      <StoreChat />
    </div>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-note">{note}</span>
    </div>
  );
}

const CSS = `
  .wrap {
    --cream: #FBF8F1; --card: #FFFFFF; --ink: #1F1B16; --muted: #8A8175;
    --line: #EAE3D6; --line-strong: #D6CCBA;
    --gold: #B08343; --gold-deep: #6F5325; --gold-wash: #FBF3E6;
    --ok: #4B7A54; --ok-wash: #F0F5EF;
    --warn: #B0742E; --warn-wash: #FBF2E6;
    --info: #2E6B7A; --info-wash: #E8F1F3;
    --bad: #A6472F; --bad-wash: #F9ECE7;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink); background: var(--cream);
    padding: 32px; padding-bottom: 110px; max-width: 1320px; margin: 0 auto; min-height: 100vh;
  }
  .wrap * { box-sizing: border-box; }
  .topnav { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
  .topnav-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); text-decoration: none; padding: 6px 11px; border-radius: 999px; font-weight: 500; }
  .topnav-item:hover { background: var(--gold-wash); color: var(--gold-deep); }
  .topnav-item.on { background: var(--ink); color: var(--cream); }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap; }
  .eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--gold); margin: 0 0 8px; font-weight: 600; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; font-size: 34px; margin: 0; letter-spacing: -.01em; }
  .sub { color: var(--muted); font-size: 14px; max-width: 620px; margin: 10px 0 0; line-height: 1.5; }
  .top-right { display: flex; flex-direction: column; gap: 12px; align-items: flex-end; }
  .top-actions { display: flex; gap: 8px; }
  .role { text-align: right; }
  .role-label { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); display: block; margin-bottom: 6px; }
  .role-switch { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 10px; overflow: hidden; background: var(--card); }
  .role-switch button { border: 0; background: transparent; padding: 8px 16px; font-size: 13px; cursor: pointer; color: var(--muted); font-weight: 500; }
  .role-switch button.on { background: var(--ink); color: var(--cream); }

  .docs { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 22px; padding: 12px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  .docs-title { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 600; }
  .doc-chip { font-size: 12px; padding: 5px 11px; border-radius: 999px; font-weight: 500; }
  .doc-chip.bad { background: var(--bad-wash); color: var(--bad); }
  .doc-chip.warn { background: var(--warn-wash); color: var(--warn); }
  .doc-chip.ok { background: var(--ok-wash); color: var(--ok); }
  .doc-chip.info { background: var(--info-wash); color: var(--info); }

  .range-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 22px; }
  .range-bar label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); font-weight: 500; }
  .range-bar input[type="date"] { border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px 9px; font-size: 12.5px; background: var(--card); color: var(--ink); }
  .range-bar .btn { padding: 7px 12px; font-size: 12.5px; text-decoration: none; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 22px 0; }
  .kpi { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 6px; }
  .kpi-label { font-size: 12px; color: var(--muted); }
  .kpi-value { font-family: Georgia, serif; font-size: 26px; }
  .kpi-note { font-size: 11px; color: var(--muted); }
  .kpi.ok .kpi-value { color: var(--ok); } .kpi.bad .kpi-value { color: var(--bad); } .kpi.warn .kpi-value { color: var(--warn); }
  .kpi.info .kpi-value { color: var(--info); }

  .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .tab { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 7px 15px; font-size: 13px; cursor: pointer; color: var(--muted); display: inline-flex; align-items: center; gap: 7px; }
  .tab.on { background: var(--ink); color: var(--cream); border-color: var(--ink); }
  .tab .count { font-size: 11px; background: rgba(0,0,0,.08); border-radius: 999px; padding: 1px 7px; }
  .tab.on .count { background: rgba(255,255,255,.18); }

  .legend { display: flex; gap: 18px; align-items: center; font-size: 11.5px; color: var(--muted); margin-bottom: 14px; flex-wrap: wrap; }
  .legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; margin-right: 5px; vertical-align: -1px; }
  .legend-chain { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; }

  .rows { display: flex; flex-direction: column; gap: 10px; }
  .row { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; transition: border-color .15s; }
  .row.ok { border-left: 3px solid var(--ok); } .row.bad { border-left: 3px solid var(--bad); }
  .row.warn { border-left: 3px solid var(--warn); } .row.muted { border-left: 3px solid var(--line-strong); }
  .row.info { border-left: 3px solid var(--info); }
  .row-head { width: 100%; border: 0; background: transparent; cursor: pointer; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; gap: 20px; text-align: left; }

  .chain { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; }
  .link { display: flex; align-items: center; gap: 8px; border: 1px solid; border-radius: 10px; padding: 7px 11px; min-width: 0; }
  .link-txt { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
  .link-txt span:first-child { font-size: 13px; font-weight: 600; white-space: nowrap; }
  .link-txt span:last-child { font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; }

  .row-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .provider { font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
  .conf { font-style: normal; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--warn); background: var(--warn-wash); padding: 2px 6px; border-radius: 5px; }
  .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 10px; border-radius: 999px; font-weight: 500; }
  .pill.ok { background: var(--ok-wash); color: var(--ok); } .pill.bad { background: var(--bad-wash); color: var(--bad); }
  .pill.warn { background: var(--warn-wash); color: var(--warn); } .pill.muted { background: #F3EFE7; color: var(--muted); }
  .pill.info { background: var(--info-wash); color: var(--info); }
  .chev { color: var(--muted); transition: transform .15s; }

  .row-body { padding: 4px 18px 18px; border-top: 1px solid var(--line); }
  .narr { font-size: 12.5px; color: var(--muted); margin: 12px 0 14px; font-family: ui-monospace, monospace; }
  .detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
  .detail-grid > div { display: flex; flex-direction: column; gap: 3px; }
  .detail-grid span { font-size: 11px; color: var(--muted); } .detail-grid b { font-size: 14px; font-weight: 600; }
  .note { font-size: 13px; line-height: 1.5; padding: 11px 14px; border-radius: 10px; margin-bottom: 14px; }
  .note.bad { background: var(--bad-wash); color: var(--bad); } .note.muted { background: #F3EFE7; color: var(--gold-deep); }
  .note.info { background: var(--info-wash); color: var(--gold-deep); }
  .note.ok { background: var(--ok-wash); color: var(--ok); }

  .stripe-proof { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; background: var(--cream); }
  .proof-head { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--gold-deep); font-weight: 600; margin-bottom: 10px; }
  .proof-head svg { color: var(--gold); }
  .proof-sub { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--muted); font-size: 11px; margin-left: 4px; }
  .proof-verdict { font-size: 13px; line-height: 1.55; color: var(--ink); margin: 0 0 8px; }
  .proof-verdict b { font-variant-numeric: tabular-nums; }
  .proof-toggle { background: none; border: 0; padding: 0; font: inherit; font-size: 12px; color: var(--gold-deep); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .proof-loading { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; }
  .proof-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .proof-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--line); }
  .proof-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); }
  .proof-table tr:last-child td { border-bottom: 0; }
  .proof-table .r { text-align: right; }
  .proof-table tr.refund td { color: var(--muted); }
  .proof-table tfoot td { border-top: 1px solid var(--line-strong); border-bottom: 0; padding-top: 8px; color: var(--gold-deep); }

  .row-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 7px; border-radius: 9px; padding: 9px 15px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); }
  .btn:disabled { opacity: .6; cursor: wait; }
  .btn.primary { background: var(--gold); border-color: var(--gold); color: #fff; }
  .btn.ghost { background: transparent; }
  .btn.locked { background: #F3EFE7; color: var(--muted); border-style: dashed; cursor: not-allowed; }
  .btn.small { padding: 6px 12px; font-size: 12px; }
  .confirmed-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ok); font-weight: 500; }
  .hidden-input { display: none; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .empty { background: var(--card); border: 1px dashed var(--line-strong); border-radius: 14px; padding: 40px; text-align: center; color: var(--muted); font-size: 14px; line-height: 1.6; display: flex; gap: 10px; align-items: center; justify-content: center; }

  .filters { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
  .search { flex: 1; min-width: 220px; border: 1px solid var(--line); border-radius: 10px; padding: 9px 14px; font-size: 13px; background: var(--card); color: var(--ink); outline: none; }
  .search:focus { border-color: var(--gold); }
  .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; padding: 12px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td { padding: 11px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  .mono { font-family: ui-monospace, monospace; font-size: 12.5px; }
  .store-badge { font-size: 11px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 2px 7px; color: var(--muted); font-weight: 600; }
  .tick { color: var(--ok); } .cross { color: var(--line-strong); font-size: 12px; }
  .table-note { font-size: 12px; color: var(--muted); margin-top: 10px; }

  .foot { display: flex; gap: 9px; align-items: flex-start; font-size: 12px; color: var(--muted); margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--line); line-height: 1.5; }
  .foot svg { flex-shrink: 0; margin-top: 1px; color: var(--gold); }

  @media (max-width: 900px) {
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .chain { flex-wrap: wrap; }
    .row-head { flex-direction: column; align-items: flex-start; }
    .detail-grid { grid-template-columns: repeat(2, 1fr); }
    .legend-chain { margin-left: 0; }
    .top-right { align-items: flex-start; }
  }
`;
