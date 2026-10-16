"use client";

/* Reconciliation page, top to bottom:
 *   1. header row: page tabs (Reconciliation, Bank Transactions, Insights) +
 *      search + export, right aligned, never overlapping what's below
 *   2. KPI strip (sticky with the header on desktop)
 *   3. one table card: its toolbar holds status tabs, gateway and date menus
 *      and the unmatched-files toggle, so the rows get the screen
 *   4. a row opens the side drawer
 *
 * Search, status and gateway filters run in memory. The DATE range stays
 * server-side: /api/reconcile matches over all data and filters its output,
 * because a payout can straddle the boundary. */

import { useCallback, useMemo, useState } from "react";
import { Download, Loader2, Search, X } from "lucide-react";
import { matchesQuery } from "@/lib/reconciliation/filters";
import { inStatus, type StatusFilter } from "@/lib/reconciliation/match-status";
import { useZohoSettings } from "@/lib/hooks/use-zoho-settings";
import { InsightsTab } from "./insights-tab";
import { LedgerTab } from "./ledger-tab";
import { BankTransactionsTab } from "./bank-transactions-tab";
import { UnmatchedPayouts } from "./unmatched-payouts";
import { MonthCloseHero } from "./month-close-hero";
import { ReconGrid } from "./recon-grid";
import { ReconDrawer } from "./recon-drawer";
import { ReconToolbar, STATUS_TABS as STATUS } from "./recon-toolbar";
import type { ReconLine, ReconPayload, UploadSlotFor } from "./types";
import { useScreenZohoOrg, useZohoOrgs } from "@/components/finance/zoho/org-picker";
import { BooksExplorer } from "@/components/finance/zoho/books-explorer";

type PageTab = "recon" | "transactions" | "insights" | "ledger" | "books";

// Spec order first; any other gateway present in the data follows.
const GATEWAY_ORDER = ["Tabby", "Stripe", "Telr", "Tamara", "Checkout", "COD", "Shopify Payments"];

function ago(isoTime?: string) {
  if (!isoTime) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(isoTime)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(isoTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ReconView({
  recon, loading, isFounder, fromDate, toDate, onRange, onConfirm, refresh, uploadSlotFor, statementUpload, headerActions,
}: {
  /** Bank statement upload control, shown in the close's step 1. */
  statementUpload?: React.ReactNode;
  /** Sync / account controls, shown at the right of the tab row. */
  headerActions?: React.ReactNode;
  recon: ReconPayload | null;
  loading: boolean;
  isFounder: boolean;
  fromDate: string;
  toDate: string;
  onRange: (from: string, to: string) => void;
  onConfirm: (id: string) => void;
  refresh: () => void;
  uploadSlotFor: UploadSlotFor;
}) {
  const [tab, setTab] = useState<PageTab>("recon");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [gateways, setGateways] = useState<Set<string>>(new Set()); // empty = all
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { config: zohoConfig } = useZohoSettings();
  // Which Zoho books the page is looking at: "all", or one organisation —
  // filters the payouts and drives the Zoho Ledger tab.
  const [books, setBooks] = useScreenZohoOrg("reconciliation-books", "all");
  const { orgs } = useZohoOrgs();

  const lines = useMemo(() => recon?.lines ?? [], [recon]);
  const postings = recon?.zohoPostings ?? {};

  const gatewayOptions = useMemo(() => {
    const present = new Set(lines.map((l) => l.provider));
    const ordered = GATEWAY_ORDER.filter((g) => present.has(g) || ["Tabby", "Stripe", "Telr", "Tamara", "Checkout", "COD"].includes(g));
    const extra = [...present].filter((g) => !ordered.includes(g)).sort();
    return [...ordered, ...extra];
  }, [lines]);

  // Search + gateway: the scope the KPIs, status counts and Insights describe.
  const inBooks = useCallback(
    (l: ReconLine) => books === "all" || (!!l.payout && (l.payout.zohoConnectionId || "env") === books),
    [books],
  );
  const scoped = useMemo(
    () => lines.filter((l) => inBooks(l) && (gateways.size === 0 || gateways.has(l.provider)) && matchesQuery(l, query)),
    [lines, gateways, query, inBooks],
  );
  // Unclassified credits are owner transfers: no payout file will ever explain
  // them, so they never count as "needs file" (they stay under All).
  const inTab = (l: ReconLine, f: StatusFilter) =>
    f === "awaiting" && l.provider === "Unclassified" ? false : inStatus({ ...l, forceBook: l.forceBook ?? null }, f);
  const counts = useMemo(() => Object.fromEntries(STATUS.map((s) => [s.key, scoped.filter((l) => inTab(l, s.key)).length])) as Record<StatusFilter, number>, [scoped]);
  const visible = useMemo(() => scoped.filter((l) => inTab(l, status)), [scoped, status]);

  const toggleGateway = (g: string) => setGateways((prev) => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const clearFilters = () => { setQuery(""); setStatus("all"); setGateways(new Set()); onRange("", ""); };
  const filterSummary = [
    status !== "all" ? `status ${STATUS.find((s) => s.key === status)?.label}` : null,
    gateways.size ? `gateway ${[...gateways].join(", ")}` : null,
    query ? `search "${query}"` : null,
    fromDate || toDate ? `dates ${fromDate || "start"} to ${toDate || "today"}` : null,
  ].filter(Boolean).join(" · ") || "no filters";

  const liveOpen = openId ? lines.find((l) => l.id === openId) ?? null : null;
  const closeDrawer = useCallback(() => setOpenId(null), []);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const qs = new URLSearchParams({ format: "xlsx" });
      if (fromDate) qs.set("from", fromDate);
      if (toDate) qs.set("to", toDate);
      const res = await fetch(`/api/reconcile/export?${qs}`);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ?? "omnia-reconciliation.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1 + 2: header row and KPI strip, sticky together on desktop */}
      <div className="space-y-5">
        {/* Page title row: what this is, which books, search and sync */}
        <div className="flex flex-col gap-3 pt-6 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Month close</h1>
            <p className="mt-0.5 text-[13px] text-[#6B7385]">Every bank credit traced to its payout file and its orders.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <select
              value={books}
              onChange={(e) => setBooks(e.target.value)}
              aria-label="Zoho organisation"
              className="h-9 rounded-[6px] border border-[#D9DEE8] bg-white px-2.5 text-[13px] text-[#14131C] focus:border-[#0B1533] focus:outline-none"
            >
              {tab !== "ledger" && tab !== "books" && <option value="all">All books</option>}
              {orgs.filter((o) => o.status !== "disabled").map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {/* Search + export act on the payout rows; the Ledger tab has its own. */}
            <label className={`relative w-56 ${tab === "ledger" || tab === "books" ? "hidden" : ""}`}>
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8A93A5]" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search credits"
                className="h-9 w-full rounded-[6px] border border-[#D9DEE8] bg-white pl-8 pr-7 text-[13px] text-[#14131C] placeholder:text-[#9AA1B0] focus:border-[#0B1533] focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[#8A93A5] hover:text-[#14131C]"><X size={13} /></button>
              )}
            </label>
            {headerActions}
            <button
              onClick={exportXlsx}
              disabled={exporting || lines.length === 0}
              className={`${tab === "recon" || tab === "ledger" || tab === "books" ? "hidden" : "inline-flex"} h-9 shrink-0 items-center gap-1.5 rounded-[6px] border border-[#D9DEE8] bg-white px-3 text-[13px] text-[#14131C] hover:border-[#0B1533] disabled:opacity-60`}
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export .xlsx
            </button>
          </div>
        </div>

        {/* Section tabs: plain text, navy underline on the active one */}
        <nav className="flex gap-6 overflow-x-auto border-b border-[#E3E7F0]" aria-label="Reconciliation sections">
          {([["recon", "Close"], ["transactions", "Bank lines"], ["insights", "Insights"], ["ledger", "Zoho ledger"], ["books", "Zoho books"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-current={tab === k ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 pt-1 text-[13.5px] transition-colors ${tab === k ? "border-[#0B1533] font-medium text-[#0B1533]" : "border-transparent text-[#6B7385] hover:text-[#14131C]"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "recon" && (
          <MonthCloseHero
            lines={scoped} loading={loading} fromDate={fromDate} toDate={toDate} onRange={onRange}
            status={status} onStatus={setStatus}
            statementMissing={!!recon?.documents?.range?.noStatementForRange}
            actions={statementUpload} onExport={exportXlsx} exporting={exporting}
          />
        )}
      </div>

      {/* Bank Transactions keeps its own fetch and selection, so it stays mounted. */}
      <div className={tab === "transactions" ? "" : "hidden"}>
        <BankTransactionsTab fromDate={fromDate} toDate={toDate} onRange={onRange} zohoSettings={zohoConfig?.effective} zohoAccounts={zohoConfig?.allAccounts ?? []} />
      </div>

      {tab === "insights" && <InsightsTab lines={scoped} />}

      {tab === "ledger" && <LedgerTab org={books === "all" ? "env" : books} />}

      {tab === "books" && <BooksExplorer org={books === "all" ? "env" : books} />}

      {tab === "recon" && (
        <>
          {/* 4: one table */}
          <ReconGrid
            toolbar={
              <ReconToolbar
                status={status} onStatus={setStatus} counts={counts}
                gatewayOptions={gatewayOptions} gateways={gateways} onToggleGateway={toggleGateway} onClearGateways={() => setGateways(new Set())}
                fromDate={fromDate} toDate={toDate} onRange={onRange}
                unmatchedCount={recon?.unmatchedPayouts?.length ?? 0} unmatchedOpen={showUnmatched} onToggleUnmatched={() => setShowUnmatched((v) => !v)}
                shown={visible.length} total={lines.length}
                updatedLabel={recon?.computedAt ? `updated ${ago(recon.computedAt)}` : ""} refreshing={!!recon?.refreshing}
              />
            }
            above={showUnmatched ? <UnmatchedPayouts payouts={recon?.unmatchedPayouts ?? []} refresh={refresh} defaultOpen /> : undefined}
            lines={visible}
            loading={loading}
            postings={postings}
            refresh={refresh}
            uploadSlotFor={uploadSlotFor}
            onOpen={setOpenId}
            openId={openId}
            filterSummary={`Showing ${filterSummary}. ${lines.length} credit${lines.length === 1 ? " is" : "s are"} loaded.`}
            onClearFilters={clearFilters}
            hasAnyData={lines.length > 0}
          />
        </>
      )}

      {liveOpen && (
        <ReconDrawer
          line={liveOpen}
          isFounder={isFounder}
          posting={postings[liveOpen.id]}
          onConfirm={onConfirm}
          refresh={refresh}
          uploadSlot={uploadSlotFor(liveOpen.provider, liveOpen.id, "dropzone")}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
