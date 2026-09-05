


"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Omnia Finance OS — bank-first finance workspace.

   Bank is the only source of truth. Every reconciliation row proves a chain:
       BANK CREDIT ──► PAYOUT FILE ──► ORDERS
   Verified state earns the gold. Everything else stays quiet.

   Reconciliation is now tabbed: Bank recon (chain-of-proof view) and
   Invoices workbench (invoice-first bulk payment recording). Both feed the
   same Zoho, but come at it from opposite directions. Two flows, one truth.
   ─────────────────────────────────────────────────────────────────────────── */

import {
  FileSpreadsheet, Upload, ShieldCheck, ChevronRight, CheckCircle2,
  RefreshCcw, Loader2, LayoutDashboard, PackageSearch, Receipt,
  WalletCards, FolderOpen, RotateCcw, FileChartColumn, Settings,
  Megaphone, Boxes, Users, ArrowLeftRight,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
import { InvoicesWorkbench } from "@/components/finance/invoices-workbench";
import { useReconciliation } from "@/lib/hooks/use-reconciliation-query";
import { ZohoSettingsProvider } from "@/lib/hooks/use-zoho-settings";
import type { ReconPayload } from "@/components/finance/reconciliation/types";

export type FinanceView =
  | "dashboard" | "sales" | "orders" | "reconciliation"
  | "payouts" | "documents" | "returns" | "reports" | "marketing" | "inventory" | "customers" | "settings";

/* ── Nav config ─────────────────────────────────────────────────────────── */

type NavChild = { href: string; label: string; matchParams?: Record<string, string> };
type NavItem = {
  href: string;
  view: FinanceView;
  label: string;
  icon: React.ElementType;
  children?: NavChild[];
};

const NAV: NavItem[] = [
  { href: "/", view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", view: "orders", label: "Orders", icon: PackageSearch },
  {
    href: "/reconciliation", view: "reconciliation", label: "Reconciliation", icon: RefreshCcw,
    children: [
      { href: "/reconciliation", label: "Bank recon" },
      { href: "/reconciliation?tab=invoices", label: "Invoices workbench", matchParams: { tab: "invoices" } },
    ],
  },
  {
    href: "/payouts", view: "payouts", label: "Payouts", icon: WalletCards,
    children: [
      { href: "/payouts?gateway=stripe",   label: "Stripe",   matchParams: { gateway: "stripe" } },
      { href: "/payouts?gateway=telr",     label: "Telr",     matchParams: { gateway: "telr" } },
      { href: "/payouts?gateway=tabby",    label: "Tabby",    matchParams: { gateway: "tabby" } },
      { href: "/payouts?gateway=tamara",   label: "Tamara",   matchParams: { gateway: "tamara" } },
      { href: "/payouts?gateway=checkout", label: "Checkout", matchParams: { gateway: "checkout" } },
      { href: "/payouts?gateway=cod",      label: "COD",      matchParams: { gateway: "cod" } },
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

/* ── Upload button ──────────────────────────────────────────────────────── */

function UploadButton({ endpoint, extraFields, accept, label, onDone, variant = "outline" }: {
  endpoint: string;
  extraFields?: Record<string, string>;
  accept: string;
  label: string;
  onDone: () => void;
  variant?: "outline" | "ghost";
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
          ? `${json.credits} credits + ${json.debits} debits parsed (${json.inserted} new${json.updated ? `, ${json.updated} corrected` : ""})`
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
      <Button
        variant={variant}
        size="sm"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={variant === "outline"
          ? "h-9 border-[#D6CCBA] bg-white text-[#1F1B16] hover:bg-[#FBF3E6] hover:border-[#C4B896]"
          : "h-9 border-[#D6CCBA] hover:bg-[#FBF3E6] hover:text-[#1F1B16]"
        }
      >
        {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Upload size={14} className="mr-1.5" />}
        {label}
      </Button>
      <input ref={input} type="file" className="hidden" accept={accept} onChange={(e) => upload(e.target.files?.[0])} />
    </>
  );
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */

function Sidebar({ pathname, searchParams }: { pathname: string; searchParams: URLSearchParams }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const paramString = searchParams.toString();

  const matchChild = (child: NavChild, itemHref: string) => {
    if (pathname !== itemHref && !child.href.startsWith(pathname)) return false;
    if (!child.matchParams) return paramString === "";
    for (const [k, v] of Object.entries(child.matchParams)) {
      if (searchParams.get(k) !== v) return false;
    }
    return true;
  };

  const isChildActive = (item: NavItem) =>
    item.children?.some((c) => matchChild(c, item.href)) ?? false;

  const isOpen = (item: NavItem) => {
    if (!item.children?.length) return false;
    if (item.href in expanded) return expanded[item.href];
    return pathname === item.href || pathname.startsWith(item.href + "/") || isChildActive(item);
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col text-[#8B8478]"
      style={{ backgroundImage: "linear-gradient(180deg, #1B1712 0%, #181510 40%, #14110D 100%)" }}
    >
      {/* Brand */}
      <div className="border-b border-[#2A251E] px-5 pt-7 pb-6">
        <div className="flex flex-col leading-none">
          <span
            className="text-[22px] tracking-[0.24em] text-[#F5EFDF] italic font-normal"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            OMNIA
          </span>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-px w-4 bg-[#B08343]" aria-hidden />
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.24em] text-[#8B8478]">
              Finance OS
            </span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4" aria-label="Finance navigation">
        {NAV.map((item) => {
          const active = pathname === item.href && (!item.children || paramString === "");
          const hasChildren = Boolean(item.children?.length);
          const open = isOpen(item);
          const childHot = isChildActive(item);

          return (
            <div key={item.href} className="flex flex-col">
              <div className="group relative flex items-center gap-0.5">
                {active && (
                  <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-[#C99655]" />
                )}
                <Link
                  href={item.href}
                  className={[
                    "flex flex-1 items-center gap-2.5 rounded-md px-3 py-[9px] text-[13px] transition-colors",
                    active
                      ? "bg-[#26221C] font-medium text-[#FBF8F1]"
                      : childHot
                      ? "text-[#C6BDA8] hover:bg-[#221E18]"
                      : "text-[#8B8478] hover:bg-[#221E18] hover:text-[#D6CCBA]",
                  ].join(" ")}
                >
                  <item.icon
                    size={14}
                    strokeWidth={active ? 2.2 : 1.8}
                    className={active ? "text-[#C99655]" : childHot ? "text-[#8B8478]" : "text-[#5F594F] group-hover:text-[#8B8478]"}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>

                {hasChildren && (
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [item.href]: !open }))}
                    className="rounded p-1.5 text-[#5F594F] transition-colors hover:bg-[#221E18] hover:text-[#8B8478]"
                    aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
                  >
                    <ChevronRight size={11} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
                  </button>
                )}
              </div>

              {hasChildren && open && (
                <div className="ml-[26px] mt-1 mb-1.5 flex flex-col gap-0.5 border-l border-[#2A251E] pl-3">
                  {item.children!.map((child) => {
                    const childActive = matchChild(child, item.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={[
                          "truncate rounded px-2.5 py-1.5 text-[12px] transition-colors",
                          childActive
                            ? "bg-[#26221C] font-medium text-[#FBF8F1]"
                            : "text-[#6B655A] hover:bg-[#221E18] hover:text-[#C6BDA8]",
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

      {/* Footer */}
      <div className="flex items-center gap-2.5 border-t border-[#2A251E] px-5 py-4">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#3B342A] bg-[#26221C]">
          <ShieldCheck size={11} className="text-[#C99655]" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[10.5px] text-[#8B8478]">Bank-verified truth</span>
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5F594F]">Server-side matching</span>
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
      className="relative overflow-hidden rounded-2xl border border-[#EAE3D6] bg-white transition-transform duration-200 hover:-translate-y-0.5"
      style={{ boxShadow: "0 1px 2px rgba(31,27,22,0.04), 0 1px 0 rgba(31,27,22,0.03)" }}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2px]" style={{ backgroundColor: accent.strip }} />
      <div className="flex flex-col gap-1.5 px-5 pt-[18px] pb-5">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent.dot }} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8A8175]">{label}</span>
        </div>
        <span
          className="text-[28px] tabular-nums leading-tight"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: accent.value, fontWeight: 500 }}
        >
          {value}
        </span>
        <span className="text-[11.5px] leading-snug text-[#8A8175]">{note}</span>
      </div>
    </div>
  );
}

/* ── Document chip ──────────────────────────────────────────────────────── */

function DocChip({ tone, children }: { tone: "bad" | "warn" | "ok"; children: React.ReactNode }) {
  const styles = {
    bad:  "bg-[#F9ECE7] text-[#8E3A25] border-[#F0D6CB]",
    warn: "bg-[#FBF2E6] text-[#8E5E21] border-[#EFD9B0]",
    ok:   "bg-[#F0F5EF] text-[#3F6947] border-[#D6E4D9]",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12px] font-medium ${styles}`}>
      {tone === "ok" ? <CheckCircle2 size={11} /> : <span aria-hidden>✕</span>}
      {children}
    </span>
  );
}

/* ── Reconciliation tabbed view ─────────────────────────────────────────── */

function ReconciliationTabs({
  recon, loading, isFounder, fromDate, toDate, onRange, onConfirm, refresh, uploadSlotFor,
}: {
  recon: ReconPayload | null;
  loading: boolean;
  isFounder: boolean;
  fromDate: string;
  toDate: string;
  onRange: (f: string, t: string) => void;
  onConfirm: (id: string) => void;
  refresh: () => void;
  uploadSlotFor: (provider: string) => React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = searchParams.get("tab") === "invoices" ? "invoices" : "recon";

  // Mount each tab's content the first time it's opened, then keep it
  // mounted (hidden via CSS) instead of letting Radix unmount it on every
  // switch — both tabs own Zoho-backed fetches that shouldn't re-fire just
  // because the user glanced away and back.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([activeTab]));
  useEffect(() => {
    setVisited((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);

  const setTab = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    if (tab === "recon") params.delete("tab");
    else params.set("tab", tab);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <ZohoSettingsProvider>
      <Tabs value={activeTab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-5 h-auto gap-1 rounded-lg border border-[#EAE3D6] bg-white p-1">
          <TabsTrigger
            value="recon"
            className="gap-1.5 rounded-md px-3.5 py-1.5 text-[12.5px] font-medium text-[#8A8175] data-[state=active]:bg-[#1F1B16] data-[state=active]:text-[#FBF8F1] data-[state=active]:shadow-none"
          >
            <RefreshCcw size={13} />
            Bank recon
          </TabsTrigger>
          <TabsTrigger
            value="invoices"
            className="gap-1.5 rounded-md px-3.5 py-1.5 text-[12.5px] font-medium text-[#8A8175] data-[state=active]:bg-[#1F1B16] data-[state=active]:text-[#FBF8F1] data-[state=active]:shadow-none"
          >
            <Receipt size={13} />
            Invoices workbench
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="recon"
          forceMount={visited.has("recon") || undefined}
          className={activeTab === "recon" ? "mt-0" : "mt-0 hidden"}
        >
          {visited.has("recon") && (
            <ReconView
              recon={recon}
              loading={loading}
              isFounder={isFounder}
              fromDate={fromDate}
              toDate={toDate}
              onRange={onRange}
              onConfirm={onConfirm}
              refresh={refresh}
              uploadSlotFor={uploadSlotFor}
            />
          )}
        </TabsContent>

        <TabsContent
          value="invoices"
          forceMount={visited.has("invoices") || undefined}
          className={activeTab === "invoices" ? "mt-0" : "mt-0 hidden"}
        >
          {visited.has("invoices") && <InvoicesWorkbench />}
        </TabsContent>
      </Tabs>
    </ZohoSettingsProvider>
  );
}

/* ── Workspace ──────────────────────────────────────────────────────────── */

export function FinanceWorkspace({ view = "reconciliation" }: { view?: FinanceView }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isFounder] = useState(true);

  const showOrders = view === "orders" || view === "sales";
  const showDashboard = view === "dashboard";
  const showDocuments = view === "documents";
  const showReports = view === "reports";
  const showMarketing = view === "marketing";
  const showInventory = view === "inventory";
  const showCustomers = view === "customers";
  const showReconContext =
    view === "reconciliation" || view === "orders" || view === "sales" || view === "payouts" || view === "returns";

  // /api/reconcile is DB-only — no Zoho traffic — but there's still no
  // reason to poll it every 60s while the user is looking at Marketing or
  // Inventory. Gate the hook's interval to views that actually show recon
  // data.
  const { recon, loading, syncing, dashVersion, fromDate, toDate, onRange, refresh, sync, onConfirm } =
    useReconciliation(showReconContext);

  const lines = recon?.lines ?? [];
  const settled = lines.filter((r) => r.state === "SETTLED");
  const buckets = {
    awaiting: lines.filter((r) => r.state === "AWAITING_PAYOUT"),
    variance: lines.filter((r) => r.state === "PAYOUT_VARIANCE"),
    unresolved: lines.filter((r) => r.state === "ORDERS_UNRESOLVED"),
  };
  const sum = (arr: { bankAmount: number }[]) => arr.reduce((s, r) => s + r.bankAmount, 0);
  const exceptionCount = buckets.variance.length + buckets.unresolved.length;

  const isInvoicesTab = view === "reconciliation" && searchParams.get("tab") === "invoices";

  const exportHref = (() => {
    const p = new URLSearchParams();
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    const qs = p.toString();
    return `/api/reconcile/export${qs ? `?${qs}` : ""}`;
  })();

  const activeItem = NAV.find((n) => n.href === pathname);
  const pageTitle = isInvoicesTab ? "Invoices workbench" : activeItem?.label ?? "Reconciliation";
  const pageEyebrow =
    view === "reconciliation"
      ? (isInvoicesTab ? "Invoice-first · bulk mark paid" : "Bank → payout → orders")
      : "Workspace";

  return (
    <div className="min-h-screen bg-[#f8f8f8] text-[#1F1B16] antialiased">
      <Sidebar pathname={pathname} searchParams={searchParams} />

      <main className="ml-60 min-h-screen">
        <div className="mx-auto max-w-[1320px] px-10 pt-8 pb-28">
          {/* Header */}
          <header className="mb-7 flex items-end justify-between gap-6 border-b border-[#EAE3D6] pb-5">
            <div className="flex flex-col leading-tight">
              <span className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#B08343]">
                {pageEyebrow}
              </span>
              <h1
                className="text-[28px] tracking-[-0.01em] text-[#1F1B16]"
                style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500 }}
              >
                {pageTitle}
              </h1>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={sync}
                className="h-9 border-[#D6CCBA] bg-white text-[#1F1B16] hover:bg-[#FBF3E6] hover:border-[#C4B896]"
              >
                {syncing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCcw size={14} className="mr-1.5" />}
                Sync stores
              </Button>

              {view === "reconciliation" && !isInvoicesTab && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-9 border border-[#D6CCBA] hover:bg-[#FBF3E6] hover:text-[#1F1B16]"
                  >
                    <a href={exportHref}>
                      <FileChartColumn size={14} className="mr-1.5" /> Export
                    </a>
                  </Button>
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

          {/* Date-range bar for context-sharing views (not on reconciliation — recon has its own) */}
          {showReconContext && view !== "reconciliation" && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-[12px] font-medium text-[#8A8175]">
                <span className="text-[10.5px] uppercase tracking-[0.08em] text-[#B5AC98]">From</span>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => onRange(e.target.value, toDate)}
                  className="rounded-md border border-[#D6CCBA] bg-white px-2.5 py-1.5 text-[12.5px] text-[#1F1B16] focus:border-[#B08343] focus:outline-none focus:ring-2 focus:ring-[#FBF3E6]"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-[12px] font-medium text-[#8A8175]">
                <span className="text-[10.5px] uppercase tracking-[0.08em] text-[#B5AC98]">To</span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => onRange(fromDate, e.target.value)}
                  className="rounded-md border border-[#D6CCBA] bg-white px-2.5 py-1.5 text-[12.5px] text-[#1F1B16] focus:border-[#B08343] focus:outline-none focus:ring-2 focus:ring-[#FBF3E6]"
                />
              </label>
              {(fromDate || toDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRange("", "")}
                  className="h-8 border border-[#D6CCBA] px-3 text-[12.5px] hover:bg-[#FBF3E6] hover:text-[#1F1B16]"
                >
                  Clear range
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-8 border border-[#D6CCBA] px-3 text-[12.5px] hover:bg-[#FBF3E6] hover:text-[#1F1B16]"
              >
                <a href={exportHref}>
                  <FileChartColumn size={14} className="mr-1.5" /> Export reconciliation
                </a>
              </Button>
            </div>
          )}

          {/* Documents required — only on Bank recon tab and adjacent context views */}
          {/* {showReconContext && !isInvoicesTab && view !== "orders" &&
            recon &&
            (!recon.documents.bankStatement ||
              recon.documents.missingPayouts.length > 0 ||
              recon.documents.range?.noStatementForRange) && (
              <div
                className="mb-6 flex flex-wrap items-center gap-2.5 rounded-2xl border border-[#EAE3D6] bg-white px-4 py-3.5"
                style={{ boxShadow: "0 1px 2px rgba(31,27,22,0.04)" }}
              >
                <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8A8175]">
                  <FileSpreadsheet size={12} className="text-[#B08343]" />
                  Documents required
                </span>

                {!recon.documents.bankStatement && (
                  <DocChip tone="bad">Bank statement — upload the daily statement (PDF or CSV) to start</DocChip>
                )}

                {recon.documents.range?.noStatementForRange && (
                  <DocChip tone="bad">
                    No bank statement covers {recon.documents.range.from ?? "the start"} → {recon.documents.range.to ?? "the end"} — upload that period's statement, or widen the range
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
            )} */}

          {/* KPIs — always visible on recon context; on Invoices tab too, for continuity */}
          {showReconContext && view !== "orders" && (
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <ReconciliationTabs
              recon={recon}
              loading={loading}
              isFounder={isFounder}
              fromDate={fromDate}
              toDate={toDate}
              onRange={onRange}
              onConfirm={onConfirm}
              refresh={refresh}
              uploadSlotFor={(provider) => (
                <UploadButton
                  variant="ghost"
                  endpoint="/api/upload/payout"
                  extraFields={{ provider }}
                  accept=".csv,.xls,.xlsx"
                  label={`Upload ${provider} payout file`}
                  onDone={refresh}
                />
              )}
            />
          )}

          <footer className="mt-12 flex items-start gap-2.5 border-t border-[#EAE3D6] pt-6 text-[11.5px] leading-relaxed text-[#8A8175]">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[#B08343]" />
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