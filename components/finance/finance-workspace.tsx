


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
  Megaphone, Boxes, Users, ArrowLeftRight, Store, Truck,
  Inbox, PackageCheck,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
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
import { CodInvoicesReport } from "@/components/finance/cod-invoices-report";
import { InventoryPanel } from "@/components/finance/inventory-panel";
import { OrdersLedger } from "@/components/finance/orders-ledger";
import { OrdersAnalyticsPanel } from "@/components/finance/orders-analytics/orders-analytics";
import { AdsExplorer } from "@/components/finance/ads/ads-explorer";
import { DispatchPanel } from "@/components/finance/dispatch/dispatch-panel";
import { LeadsInbox } from "@/components/finance/leads-inbox";
import { SalesOrdersPanel } from "@/components/finance/sales-orders/sales-orders-panel";
import { CommandCenter } from "@/components/finance/dashboard-v2/command/command-center";
import { StorefrontPanel } from "@/components/finance/storefront/storefront-panel";
import { CustomersPanel } from "@/components/finance/customers-panel";
import { ReconView } from "@/components/finance/reconciliation/recon-view";
import { ZohoOrgsPanel } from "@/components/finance/zoho/zoho-orgs-panel";
import { BRAND } from "@/lib/config/brand";
import { ZohoSettingsPanel } from "@/components/finance/reconciliation/zoho-settings-panel";
import { PaymentSheetMonthsPanel } from "@/components/finance/payment-sheet-months-panel";
import { InvoicesWorkbench } from "@/components/finance/invoices-workbench";
import { useReconciliation } from "@/lib/hooks/use-reconciliation-query";
import type { UploadSlotFor } from "@/components/finance/reconciliation/types";
import { ZohoSettingsProvider } from "@/lib/hooks/use-zoho-settings";
import type { ReconPayload } from "@/components/finance/reconciliation/types";

export type FinanceView =
  | "dashboard" | "sales" | "orders" | "reconciliation"
  | "payouts" | "documents" | "returns" | "reports" | "marketing" | "storefronts" | "inventory" | "customers" | "settings" | "dispatch" | "leads" | "salesorders";

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
  { href: "/dispatch", view: "dispatch", label: "Dispatch", icon: Truck },
  { href: "/sales-orders", view: "salesorders", label: "Sales orders", icon: PackageCheck },
  { href: "/returns", view: "returns", label: "Returns", icon: RotateCcw },
  { href: "/marketing", view: "marketing", label: "Marketing", icon: Megaphone },
  { href: "/storefronts", view: "storefronts", label: "Storefronts", icon: Store },
  { href: "/inventory", view: "inventory", label: "Inventory", icon: Boxes },
  { href: "/customers", view: "customers", label: "Customers", icon: Users },
  { href: "/leads", view: "leads", label: "Leads", icon: Inbox },
  { href: "/settings", view: "settings", label: "Settings", icon: Settings },
];

const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);

/* ── Upload button ──────────────────────────────────────────────────────── */

/** Which bank / card account the next statement upload belongs to.
 *  "" = let the statement's own header decide (account no., card mask). */
function StatementAccountSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    fetch("/api/statement-accounts").then((r) => r.json()).then((j) => setAccounts(j.accounts ?? [])).catch(() => {});
  }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Statement account"
      className="h-9 max-w-[230px] rounded-full border border-[#D8E1F1] bg-white px-3 text-[12.5px] text-[#0F1B3D]">
      <option value="">Auto-detect account</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
    </select>
  );
}

function UploadButton({ endpoint, extraFields, accept, label, onDone, variant = "outline" }: {
  endpoint: string;
  extraFields?: Record<string, string>;
  accept: string;
  label: string;
  onDone: () => void | Promise<void>;
  /** "dropzone": a large drag-and-drop area. Every variant accepts drops. */
  variant?: "outline" | "ghost" | "dropzone";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const allowed = accept.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      if (!dragging) setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (allowed.length && !allowed.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        toast.error(`${file.name} isn't a ${allowed.join(" / ")} file.`);
        return;
      }
      void upload(file);
    },
  };

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
          ? `${json.accountLabel ? `${json.accountLabel}: ` : ""}${json.credits} credits + ${json.debits} debits parsed (${json.inserted} new${json.updated ? `, ${json.updated} corrected` : ""})`
          : `Payout saved: ${json.payouts?.map((p: { id: string; orderRefs?: string[] }) => `${p.id} · ${p.orderRefs?.length ?? 0} orders`).join(", ")}`,
      );
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  if (variant === "dropzone") {
    return (
      <div
        {...dropProps}
        role="button"
        tabIndex={0}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) input.current?.click(); }}
        className={`flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          dragging ? "border-[#B08343] bg-[#FBF3E6]" : "border-[#D6CCBA] bg-[#FBF8F1] hover:border-[#B08343] hover:bg-[#FBF3E6]"
        } ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        {busy ? <Loader2 size={18} className="animate-spin text-[#B08343]" /> : <Upload size={18} className="text-[#B08343]" />}
        <span className="text-[13px] font-medium text-[#1F1B16]">
          {busy ? "Reading the file…" : dragging ? "Drop to upload" : label}
        </span>
        <span className="text-[11.5px] text-[#8A8175]">
          Drag and drop the {allowed.join(" / ")} file here, or click to choose. It&apos;s attached to this credit and its orders list straight away.
        </span>
        <input ref={input} type="file" className="hidden" accept={accept} onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    );
  }

  return (
    <span {...dropProps} className={`inline-flex rounded-full ${dragging ? "ring-2 ring-[#3B82F6] ring-offset-1" : ""}`}>
      <Button
        variant={variant}
        size="sm"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={variant === "outline"
          ? "h-9 rounded-full border-[#0F1B3D] bg-[#0F1B3D] px-3.5 text-[13px] text-white hover:bg-[#1E3A8A] hover:text-white"
          : "h-9 rounded-full border-[#D8E1F1] hover:bg-[#EAF1FD] hover:text-[#0F1B3D]"
        }
      >
        {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Upload size={14} className="mr-1.5" />}
        {label}
      </Button>
      <input ref={input} type="file" className="hidden" accept={accept} onChange={(e) => upload(e.target.files?.[0])} />
    </span>
  );
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */

/** Sidebar width, collapsed or not — remembered per browser, mirrored on
 *  <html> as --sb-w so fixed elements (the chat dock) can follow it. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("omnia.sidebar.collapsed") === "1"); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--sb-w", collapsed ? "76px" : "240px");
    try { localStorage.setItem("omnia.sidebar.collapsed", collapsed ? "1" : "0"); } catch { /* storage blocked */ }
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

function Sidebar({ pathname, searchParams, collapsed, onToggle }: {
  pathname: string; searchParams: URLSearchParams; collapsed: boolean; onToggle: () => void;
}) {
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
    if (collapsed || !item.children?.length) return false;
    if (item.href in expanded) return expanded[item.href];
    return pathname === item.href || pathname.startsWith(item.href + "/") || isChildActive(item);
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 240 }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      /* deep violet rail (founder's reference, 2026-10-13) */
      className="fixed inset-y-0 left-0 z-30 flex flex-col bg-[linear-gradient(180deg,#3B1D72_0%,#2E1660_55%,#24114D_100%)] text-white"
    >
      {/* Collapse toggle — a small round button sitting on the rail's edge */}
      <button
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3.5 top-7 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.12)] ring-1 ring-slate-200 transition hover:bg-[#3B1D72] hover:text-white"
      >
        <ChevronRight size={14} className={`transition-transform duration-300 ${collapsed ? "" : "rotate-180"}`} />
      </button>

      {/* Brand */}
      <div className={`flex h-20 items-center ${collapsed ? "justify-center" : "gap-3 px-5"}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#C77DFF,#7B5CFA)] text-[15px] font-semibold text-white">O</span>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-[15px] font-semibold uppercase tracking-[0.14em] text-white">{BRAND.name}</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Finance OS</div>
          </div>
        )}
      </div>

      {/* Nav — overflow-x-hidden stops labels spilling while the rail animates */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3 py-2" aria-label="Finance navigation">
        {NAV.map((item) => {
          const active = pathname === item.href && (!item.children || paramString === "");
          const hasChildren = Boolean(item.children?.length);
          const open = isOpen(item);
          const childHot = isChildActive(item) || (collapsed && pathname === item.href);
          const on = active || (collapsed && childHot);

          return (
            <div key={item.href} className="flex flex-col">
              <div className="group relative flex items-center gap-0.5">
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={[
                    "flex flex-1 items-center gap-3 rounded-full py-1.5 text-[13.5px] transition-colors",
                    collapsed ? "justify-center px-0" : "pl-1.5 pr-3",
                    on ? "bg-[#1D5BFF] text-white" : childHot ? "bg-white/[0.12] text-white" : "text-white/85 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  {/* round icon well, like the reference's top nav */}
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${on ? "bg-white/15" : "bg-white/[0.06] ring-1 ring-white/10 group-hover:ring-white/25"}`}>
                    <item.icon size={16} strokeWidth={1.8} />
                  </span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>

                {hasChildren && !collapsed && (
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [item.href]: !open }))}
                    className="rounded-full p-1.5 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
                  >
                    <ChevronRight size={13} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
                  </button>
                )}
              </div>

              <AnimatePresence initial={false}>
                {hasChildren && open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="ml-[30px] flex flex-col gap-0.5 overflow-hidden border-l border-white/15 pl-3"
                  >
                    <div className="h-1" />
                    {item.children!.map((child) => {
                      const childActive = matchChild(child, item.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={[
                            "truncate rounded-full px-3 py-1.5 text-[12.5px] transition-colors",
                            childActive ? "bg-white/15 font-medium text-white" : "text-white/80 hover:text-white",
                          ].join(" ")}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                    <div className="h-1" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`flex items-center gap-2.5 border-t border-white/10 py-4 ${collapsed ? "justify-center" : "px-5"}`}>
        <ShieldCheck size={15} className="shrink-0 text-[#C77DFF]" />
        {!collapsed && <span className="text-[11.5px] text-white/50">Bank-verified truth</span>}
      </div>
    </motion.aside>
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
  uploadSlotFor: UploadSlotFor;
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
        {/* <TabsList className="mb-5 h-auto gap-1 rounded-lg border border-[#EAE3D6] bg-white p-1">
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
        </TabsList> */}

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
  const [statementAccount, setStatementAccount] = useState("");
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

  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();
  const activeItem = NAV.find((n) => n.href === pathname);
  const pageTitle = isInvoicesTab ? "Invoices workbench" : activeItem?.label ?? "Reconciliation";
  const pageEyebrow =
    view === "reconciliation"
      ? (isInvoicesTab ? "Invoice-first · bulk mark paid" : "Bank → payout → orders")
      : "Workspace";

  return (
    <div className="min-h-screen bg-[var(--os-page)] text-slate-900 antialiased">
      <Sidebar pathname={pathname} searchParams={searchParams} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />

      <main className="min-h-screen transition-[margin] duration-300" style={{ marginLeft: sidebarCollapsed ? 76 : 240 }}>
        <div className="mx-auto max-w-[1440px] px-8 pt-0 pb-28">

          <header className="mb-2 flex items-center justify-between gap-6">
            <div className="flex flex-col leading-tight">
              {/* <span className="mb-3 inline-flex items-center gap-2 text-[13px] text-[#5E6B85]">
                Finance <span className="text-[#B6C1D6]">/</span> {pageEyebrow}
              </span> */}
              {/* <h1 className="text-[30px] font-light tracking-[-0.03em] text-slate-900">
                {pageTitle}
              </h1> */}
            </div>
            {view === "reconciliation" && !isInvoicesTab && (
            <div className="flex flex-wrap absolute top-0 right-0 items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={sync}
                className="h-9 rounded-full border-[#D8E1F1] bg-white px-3.5 text-[13px] text-[#0F1B3D] hover:bg-[#0F1B3D] hover:text-white hover:border-[#0F1B3D]"
              >
                {syncing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCcw size={14} className="mr-1.5" />}
                Sync stores
              </Button>

              {view === "reconciliation" && !isInvoicesTab && (
                <>
                  <StatementAccountSelect value={statementAccount} onChange={setStatementAccount} />
                  <UploadButton
                    endpoint="/api/upload/bank"
                    extraFields={statementAccount ? { account: statementAccount } : undefined}
                    accept=".pdf,.csv,.txt,.xls,.xlsx"
                    label="Upload statement"
                    onDone={refresh}
                  />
                </>
              )}
            </div>
            )}
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
          {/* {showReconContext && view !== "orders" && (
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
          )} */}

          {/* View body */}
          {showDashboard ? (
            <FounderDashboard version={dashVersion} />
          ) : showDocuments ? (
            <DocumentsPanel version={dashVersion} onDone={refresh} />
          ) : showReports ? (
            <>
              <CodInvoicesReport />
              <ReportsPanel version={dashVersion} />
            </>
          ) : showMarketing ? (
            <>
              <CommandCenter variant="marketing" />
              <AdsExplorer />
            </>
          ) : view === "leads" ? (
            <LeadsInbox />
          ) : view === "dispatch" ? (
            <DispatchPanel />
          ) : view === "salesorders" ? (
            <SalesOrdersPanel />
          ) : view === "storefronts" ? (
            <StorefrontPanel />
          ) : showInventory ? (
            <InventoryPanel />
          ) : showCustomers ? (
            <CustomersPanel />
          ) : showOrders ? (
            <>
              {view === "orders" && <OrdersAnalyticsPanel />}
              <OrdersLedger fromDate={fromDate} toDate={toDate} />
            </>
          ) : view === "settings" ? (
            <div className="space-y-6">
              <ZohoOrgsPanel />
              <ZohoSettingsPanel />
              <PaymentSheetMonthsPanel />
            </div>
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
              uploadSlotFor={(provider, bankLineId, variant) => (
                <UploadButton
                  variant={variant === "dropzone" ? "dropzone" : "ghost"}
                  endpoint="/api/upload/payout"
                  extraFields={bankLineId ? { provider, bankLineId } : { provider }}
                  accept=".csv,.xls,.xlsx,.pdf"
                  label={variant === "dropzone" ? `Upload ${provider} payout file` : `Upload ${provider === "Shopify Payments" ? "Shopify" : provider} file`}
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