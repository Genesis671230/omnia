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

type ReconLine = {
  id: string;
  date: string | null;
  narration: string;
  reference: string;
  provider: string;
  confidence: string;
  bankAmount: number;
  payout: {
    id: string; net: number; source: string | null;
    currency: string | null; fxRate: number | null; fxSource: "bank" | "estimate" | null;
  } | null;
  variance: number;
  resolvedOrders: string[];
  unresolvedRefs: string[];
  refundedOrders: string[];
  qualityIssues: { ref: string; quality: string }[];
  state: "AWAITING_PAYOUT" | "PAYOUT_VARIANCE" | "ORDERS_UNRESOLVED" | "SETTLED";
  confirmedBy: string | null;
};

// Live per-order evidence behind a Stripe bank credit, from the Stripe API
// (GET /api/payouts/:id/stripe-proof) — the gateway's own ledger, not the
// uploaded CSV.
type StripeTxn = { ref: string; isRefund: boolean; quality: string; netShare: number; grossShare: number; feeShare: number };
type StripeProof =
  | { available: true; payoutId: string; net: number; refs: string[]; transactions: StripeTxn[] }
  | { available: false; reason: string };

type ReconPayload = {
  lines: ReconLine[];
  settledOrders: number;
  totalOrders: number;
  documents: {
    bankStatement: boolean;
    missingPayouts: { provider: string; awaitingAmount: number }[];
    range: { from: string | null; to: string | null; noStatementForRange: boolean } | null;
  };
};

const STATE_META = {
  SETTLED: { label: "Settled", tone: "ok", icon: Check },
  PAYOUT_VARIANCE: { label: "Variance", tone: "bad", icon: AlertTriangle },
  ORDERS_UNRESOLVED: { label: "Orders unresolved", tone: "warn", icon: HelpCircle },
  AWAITING_PAYOUT: { label: "Awaiting payout", tone: "info", icon: Clock },
} as const;

const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);
const aed2 = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

/* ── Chain link: the signature element ──────────────────────────────────── */

function ChainLink({ icon: Icon, label, sub, status }: {
  icon: React.ElementType; label: string; sub: string;
  status: "resolved" | "pending" | "broken";
}) {
  const c = {
    resolved: { ring: "var(--gold)", bg: "var(--gold-wash)", fg: "var(--ink)", subfg: "var(--gold-deep)" },
    pending: { ring: "var(--line)", bg: "transparent", fg: "var(--muted)", subfg: "var(--muted)" },
    broken: { ring: "var(--bad)", bg: "var(--bad-wash)", fg: "var(--bad)", subfg: "var(--bad)" },
  }[status];
  return (
    <div className="link" style={{ borderColor: c.ring, background: c.bg }}>
      <Icon size={15} style={{ color: c.fg, flexShrink: 0 }} />
      <div className="link-txt">
        <span style={{ color: c.fg }}>{label}</span>
        <span style={{ color: c.subfg }}>{sub}</span>
      </div>
    </div>
  );
}

function Connector({ ok }: { ok: boolean }) {
  return <ArrowRight size={14} style={{ color: ok ? "var(--gold)" : "var(--line-strong)", flexShrink: 0 }} />;
}

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

/* ── Reconciliation row ─────────────────────────────────────────────────── */

function ReconRow({ r, isFounder, onConfirm, refresh }: {
  r: ReconLine; isFounder: boolean; onConfirm: (id: string) => void; refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = STATE_META[r.state];
  const payoutOk = !!r.payout && Math.abs(r.variance) <= 1;
  const ordersOk = payoutOk && r.unresolvedRefs.length === 0 && r.resolvedOrders.length > 0;

  // Payouts reach the bank within ~1 week, so a credit still missing its
  // payout file after 7 days is overdue — the file should already exist.
  const ageDays = r.date ? Math.floor((Date.now() - new Date(r.date).getTime()) / 86_400_000) : null;
  const overdue = !r.payout && ageDays !== null && ageDays > 7;

  // Live Stripe proof — fetched lazily the first time a Stripe row is opened.
  const isStripe = r.provider === "Stripe" && !!r.payout && r.payout.id.startsWith("STRIPE-");
  const [proof, setProof] = useState<StripeProof | null>(null);
  useEffect(() => {
    if (!open || !isStripe || proof || !r.payout) return;
    fetch(`/api/payouts/${encodeURIComponent(r.payout.id)}/stripe-proof`)
      .then((x) => x.json())
      .then((d: StripeProof) => setProof(d))
      .catch(() => setProof({ available: false, reason: "Could not reach Stripe" }));
  }, [open, isStripe, proof, r.payout]);

  return (
    <div className={`row ${meta.tone}`}>
      <button className="row-head" onClick={() => setOpen(!open)}>
        <div className="chain">
          <ChainLink icon={Landmark} label={aed2(r.bankAmount)} sub={`Bank · ${r.reference || r.id.slice(0, 8)}`} status="resolved" />
          <Connector ok={payoutOk} />
          <ChainLink icon={FileSpreadsheet}
            label={r.payout ? aed2(r.payout.net) : "No file"}
            sub={r.payout ? r.payout.id : "not uploaded"}
            status={r.payout ? (payoutOk ? "resolved" : "broken") : "pending"} />
          <Connector ok={ordersOk} />
          <ChainLink icon={Package}
            label={ordersOk ? `${r.resolvedOrders.length} orders` : r.unresolvedRefs.length ? `${r.unresolvedRefs.length} missing` : "—"}
            sub={r.unresolvedRefs.length ? `#${r.unresolvedRefs.join(", ")} not found` : ordersOk ? `#${r.resolvedOrders.join(", ")}` : "awaiting payout"}
            status={ordersOk ? "resolved" : r.unresolvedRefs.length ? "broken" : "pending"} />
        </div>
        <div className="row-right">
          <span className="provider">
            {r.provider}
            {r.confidence !== "keyword" && (
              <em className="conf" title={r.confidence === "inferred"
                ? "Provider inferred from settlement bank — needs a confirming rule or payout file"
                : "No rule matched this narration"}>
                {r.confidence}
              </em>
            )}
          </span>
          <span className={`pill ${meta.tone}`}><meta.icon size={12} />{r.confirmedBy ? "Confirmed" : meta.label}</span>
          {overdue && (
            <span className="pill bad" title={`Bank credited ${ageDays} days ago — the payout file should already be here`}>
              <AlertTriangle size={12} />{ageDays}d overdue
            </span>
          )}
          {r.refundedOrders.length > 0 && (
            <span className="pill muted" title={`Refunded: #${r.refundedOrders.join(", #")}`}>
              <RotateCcw size={12} />{r.refundedOrders.length} refund{r.refundedOrders.length > 1 ? "s" : ""}
            </span>
          )}
          {r.qualityIssues.length > 0 && (
            <span className="pill warn" title={r.qualityIssues.map((q) => `#${q.ref}: ${q.quality}`).join(" · ")}>
              <AlertTriangle size={12} />{r.qualityIssues.length} to review
            </span>
          )}
          <ChevronDown size={16} className="chev" style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </div>
      </button>

      {open && (
        <div className="row-body">
          <p className="narr">{r.narration}</p>
          <div className="detail-grid">
            <div><span>Date</span><b>{r.date}</b></div>
            <div><span>Bank credit</span><b>{aed2(r.bankAmount)}</b></div>
            <div><span>Payout net</span><b>{r.payout ? aed2(r.payout.net) : "—"}</b></div>
            <div><span>Variance</span><b style={{ color: Math.abs(r.variance) > 1 ? "var(--bad)" : "inherit" }}>{aed2(r.variance)}</b></div>
            {r.payout?.currency && (
              <div>
                <span>FX rate applied</span>
                <b>
                  1 {r.payout.currency} = {r.payout.fxRate ?? "—"} AED
                  {r.payout.fxSource && (
                    <em className="conf" title={r.payout.fxSource === "bank"
                      ? "Read straight from the bank's wire narration for this credit — the rate the bank actually applied"
                      : "No rate quoted in the bank narration — falling back to our static estimate, which can drift from what the bank actually applied"}>
                      {" "}{r.payout.fxSource === "bank" ? "bank-quoted" : "estimate"}
                    </em>
                  )}
                </b>
              </div>
            )}
            <div><span>Orders resolved</span><b>{r.resolvedOrders.length ? r.resolvedOrders.map((o) => "#" + o).join(", ") : "—"}</b></div>
            {r.refundedOrders.length > 0 && (
              <div><span>Refunded (excluded from settled)</span><b>{r.refundedOrders.map((o) => "#" + o).join(", ")}</b></div>
            )}
          </div>

          {r.qualityIssues.length > 0 && (
            <div className="note muted">
              {r.qualityIssues.length} description{r.qualityIssues.length > 1 ? "s" : ""} need a look:{" "}
              {r.qualityIssues.map((q, i) => (
                <span key={q.ref + i}>#{q.ref} ({q.quality === "refund_unmatched" ? "refund, no matching order" : q.quality}){i < r.qualityIssues.length - 1 ? ", " : ""}</span>
              ))}
            </div>
          )}

          {r.state === "PAYOUT_VARIANCE" && r.payout && (
            <div className="note bad">
              {(() => {
                const surplus = r.variance > 0;
                let cause: string;
                if (r.payout.fxSource === "estimate") {
                  cause = "the FX estimate used to convert this payout likely drifted from the bank's actual wire rate";
                } else if (r.refundedOrders.length > 0) {
                  cause = `${r.refundedOrders.length} refund${r.refundedOrders.length > 1 ? "s" : ""} on this payout may not net out the way expected`;
                } else {
                  cause = "a bank fee, rounding, or a partial settlement not reflected in the payout file";
                }
                return (
                  <>
                    Bank credited <b>{aed2(r.bankAmount)}</b> but the {r.provider} payout ({r.payout.id}) says <b>{aed2(r.payout.net)}</b> —
                    a {surplus ? "surplus" : "shortfall"} of <b>{aed2(Math.abs(r.variance))}</b>. Likely cause: {cause}.
                    Re-check the payout file's totals, or confirm this is expected before treating the credit as settled.
                  </>
                );
              })()}
            </div>
          )}
          {r.state === "ORDERS_UNRESOLVED" && (
            <div className="note bad">
              {r.unresolvedRefs.length > 0 ? (
                <>
                  The {r.provider} payout {r.payout ? `(${r.payout.id}) ` : ""}net matches the bank, but order <b>#{r.unresolvedRefs.join(", #")}</b> {r.unresolvedRefs.length > 1 ? "aren't" : "isn't"} in the synced orders.
                  Run a sync (or widen the window) — this credit can't be called Settled until every order it pays for is accounted for.
                </>
              ) : (
                <>
                  The {r.provider} payout {r.payout ? `(${r.payout.id}) ` : ""}net matches the bank, but it carries no chargeable order references —
                  nothing to settle from this credit yet.
                </>
              )}
            </div>
          )}
          {r.state === "SETTLED" && r.payout && (
            <div className="note ok">
              The {r.provider} payout ({r.payout.id}) net matches the bank credit exactly, and all {r.resolvedOrders.length} order{r.resolvedOrders.length > 1 ? "s are" : " is"} accounted for.
              {r.confirmedBy ? " Confirmed by the founder." : " Ready for founder confirmation."}
            </div>
          )}
          {r.state === "AWAITING_PAYOUT" && (
            <div className="note info">
              {r.confidence === "unknown"
                ? "No classification rule matches this narration. Add a descriptor rule, then upload the payout file that explains it."
                : r.confidence === "inferred"
                  ? `Provider inferred from the settlement bank, not confirmed. Upload the ${r.provider} payout file to prove which gateway and which orders this pays for.`
                  : (() => {
                      const statementNoun: Record<string, string> = {
                        Tabby: "settlement report", Tamara: "merchant statement", COD: "remittance invoice",
                        Stripe: "payout reconciliation report", Checkout: "settlement export", Telr: "payout file",
                      };
                      const noun = statementNoun[r.provider] ?? "payout file";
                      return (
                        <>
                          Bank credit confirmed as {r.provider}
                          {r.reference ? <> (ref <b>{r.reference}</b>)</> : null}. Upload the {r.provider} {noun} that explains it — the invoice/reference number visible here should match the file.
                        </>
                      );
                    })()}
            </div>
          )}

          {overdue && (
            <div className="note bad">
              This bank credit is <b>{ageDays} days old</b>. {r.provider} payouts normally reach the bank within a week, so the payout file is overdue —
              upload it below, or check the {r.provider} dashboard for a settlement that hasn&apos;t been exported yet.
            </div>
          )}

          {isStripe && (
            <div className="stripe-proof">
              <div className="proof-head">
                <ShieldCheck size={13} /> Stripe proof
                {proof?.available && <span className="proof-sub">live from Stripe · payout {proof.payoutId}</span>}
              </div>
              {!proof ? (
                <div className="proof-loading"><Loader2 size={13} className="spin" /> Pulling balance transactions…</div>
              ) : !proof.available ? (
                <div className="note muted">Couldn&apos;t load live Stripe proof: {proof.reason}</div>
              ) : proof.transactions.length === 0 ? (
                <div className="note muted">Stripe returned no per-order transactions for this payout.</div>
              ) : (
                <table className="proof-table">
                  <thead><tr><th>Order</th><th>Gross</th><th>Fee</th><th className="r">Net</th><th /></tr></thead>
                  <tbody>
                    {proof.transactions.map((t, i) => (
                      <tr key={t.ref + i} className={t.isRefund ? "refund" : ""}>
                        <td className="mono">#{t.ref}</td>
                        <td className="mono">{aed2(t.grossShare)}</td>
                        <td className="mono">{aed2(t.feeShare)}</td>
                        <td className="mono r">{aed2(t.netShare)}</td>
                        <td>{t.isRefund ? <span className="pill muted"><RotateCcw size={11} />refund</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>Net settled</td><td /><td /><td className="mono r"><b>{aed2(proof.net)}</b></td><td /></tr></tfoot>
                </table>
              )}
            </div>
          )}

          <div className="row-actions">
            {r.state === "SETTLED" && !r.confirmedBy && (
              isFounder ? (
                <button className="btn primary" onClick={() => onConfirm(r.id)}>
                  <BadgeCheck size={15} /> Confirm settlement
                </button>
              ) : (
                <button className="btn locked" disabled>
                  <Lock size={13} /> Founder confirms settlement
                </button>
              )
            )}
            {r.confirmedBy && <span className="confirmed-tag"><Check size={14} /> Confirmed by founder</span>}
            {r.state !== "SETTLED" && r.provider !== "Unclassified" && (
              <UploadButton ghost endpoint="/api/upload/payout"
                extraFields={{ provider: r.provider }}
                accept=".csv,.xls,.xlsx"
                label={`Upload ${r.provider} payout file`}
                onDone={refresh} />
            )}
          </div>
        </div>
      )}
    </div>
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
  const sum = (arr: ReconLine[]) => arr.reduce((s, r) => s + r.bankAmount, 0);
  const viewLines = ({
    all: lines, settled, awaiting: buckets.awaiting,
    exceptions: [...buckets.variance, ...buckets.unresolved],
  } as Record<string, ReconLine[]>)[tab];

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
          <p className="eyebrow">Omnia financial operations</p>
          <h1>{meta.title}</h1>
          <p className="sub">{meta.sub}</p>
        </div>
        <div className="top-right">
          <div className="role">
            <span className="role-label">Viewing as</span>
            <div className="role-switch">
              <button className={isFounder ? "on" : ""} onClick={() => setIsFounder(true)}>Founder</button>
              <button className={!isFounder ? "on" : ""} onClick={() => setIsFounder(false)}>Operator</button>
            </div>
          </div>
          <div className="top-actions">
            <button className="btn" disabled={syncing} onClick={sync}>
              {syncing ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />} Sync stores
            </button>
            {view ==="reconciliation"&&   <UploadButton endpoint="/api/upload/bank" accept=".pdf,.csv,.txt"
            label="Upload bank statement" onDone={refresh} />
          }
          </div>
        </div>
      </header>
          {/* )} */}

      {showReconContext &&(
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
      ) : (
        <>
          <div className="tabs">
            {([["all", "All credits", lines.length], ["settled", "Settled", settled.length],
            ["awaiting", "Awaiting", buckets.awaiting.length],
            ["exceptions", "Exceptions", buckets.variance.length + buckets.unresolved.length]] as [string, string, number][]).map(([k, l, n]) => (
              <button key={k} className={tab === k ? "tab on" : "tab"} onClick={() => setTab(k)}>
                {l} <span className="count">{n}</span>
              </button>
            ))}
          </div>

          <div className="legend">
            <span><i style={{ background: "var(--gold)" }} /> resolved link</span>
            <span><i style={{ background: "var(--line-strong)" }} /> pending</span>
            <span><i style={{ background: "var(--bad)" }} /> broken</span>
            <span className="legend-chain">Read each row left→right: <Landmark size={12} /> bank <ArrowRight size={11} /> <FileSpreadsheet size={12} /> payout <ArrowRight size={11} /> <Package size={12} /> orders</span>
          </div>

          {loading ? (
            <div className="empty"><Loader2 size={18} className="spin" /> Running reconciliation…</div>
          ) : lines.length === 0 ? (
            <div className="empty">
              No bank credits imported yet. Upload the daily bank statement — parsing turns it into credit lines,
              and each credit then waits for the payout file that explains it.
            </div>
          ) : (
            <div className="rows">
              {viewLines.map((r) => (
                <ReconRow key={r.id} r={r} isFounder={isFounder} onConfirm={onConfirm} refresh={refresh} />
              ))}
            </div>
          )}
        </>
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
