"use client";

/* Reconciliation page, top to bottom:
 *   1. header row: page tabs (Reconciliation, Bank Transactions, Insights) +
 *      search + export, right aligned, never overlapping what's below
 *   2. KPI strip (sticky with the header on desktop)
 *   3. filters: status pills (+ date range), then gateway multi-select chips
 *   4. one table for every filtered credit; a row opens the side drawer
 *
 * Search, status and gateway filters run in memory. The DATE range stays
 * server-side: /api/reconcile matches over all data and filters its output,
 * because a payout can straddle the boundary. */

import { useCallback, useMemo, useState } from "react";
import { BarChart3, Check, ChevronDown, Download, Landmark, Loader2, RefreshCcw, Search, X } from "lucide-react";
import { matchesQuery } from "@/lib/reconciliation/filters";
import { inStatus, type StatusFilter } from "@/lib/reconciliation/match-status";
import { useZohoSettings } from "@/lib/hooks/use-zoho-settings";
import { gatewayColor } from "./colors";
import { InsightsTab } from "./insights-tab";
import { BankTransactionsTab } from "./bank-transactions-tab";
import { UnmatchedPayouts } from "./unmatched-payouts";
import { ReconKpis } from "./recon-kpis";
import { ReconGrid } from "./recon-grid";
import { ReconDrawer } from "./recon-drawer";
import type { ReconLine, ReconPayload, UploadSlotFor } from "./types";

type PageTab = "recon" | "transactions" | "insights";

const STATUS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "settled", label: "Settled" },
  { key: "awaiting", label: "Awaiting" },
  { key: "exceptions", label: "Exceptions" },
  { key: "flagged", label: "Flagged" },
];

// Spec order first; any other gateway present in the data follows.
const GATEWAY_ORDER = ["Tabby", "Stripe", "Telr", "Tamara", "Checkout", "COD", "Shopify Payments"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "7d", range: () => [iso(new Date(Date.now() - 6 * 864e5)), iso(new Date())] },
  { label: "30d", range: () => [iso(new Date(Date.now() - 29 * 864e5)), iso(new Date())] },
  { label: "This month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; } },
  { label: "All", range: () => ["", ""] },
];

function ago(isoTime?: string) {
  if (!isoTime) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(isoTime)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(isoTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ReconView({
  recon, loading, isFounder, fromDate, toDate, onRange, onConfirm, refresh, uploadSlotFor,
}: {
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
  const [gwMenu, setGwMenu] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { config: zohoConfig } = useZohoSettings();

  const lines = useMemo(() => recon?.lines ?? [], [recon]);
  const postings = recon?.zohoPostings ?? {};

  const gatewayOptions = useMemo(() => {
    const present = new Set(lines.map((l) => l.provider));
    const ordered = GATEWAY_ORDER.filter((g) => present.has(g) || ["Tabby", "Stripe", "Telr", "Tamara", "Checkout", "COD"].includes(g));
    const extra = [...present].filter((g) => !ordered.includes(g)).sort();
    return [...ordered, ...extra];
  }, [lines]);

  // Search + gateway: the scope the KPIs, status counts and Insights describe.
  const scoped = useMemo(
    () => lines.filter((l) => (gateways.size === 0 || gateways.has(l.provider)) && matchesQuery(l, query)),
    [lines, gateways, query],
  );
  const asLine = (l: ReconLine) => ({ ...l, forceBook: l.forceBook ?? null });
  const counts = useMemo(() => Object.fromEntries(STATUS.map((s) => [s.key, scoped.filter((l) => inStatus(asLine(l), s.key)).length])) as Record<StatusFilter, number>, [scoped]);
  const visible = useMemo(() => scoped.filter((l) => inStatus(asLine(l), status)), [scoped, status]);

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

  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
      active ? "bg-[#1F1B16] text-[#FBF8F1]" : "bg-white text-[#5E564B] ring-1 ring-inset ring-[#EAE3D6] hover:text-[#1F1B16] hover:ring-[#D6CCBA]"
    }`;

  return (
    <div className="space-y-4">
      {/* 1 + 2: header row and KPI strip, sticky together on desktop */}
      <div className="z-30 -mx-2 space-y-3 bg-[#f8f8f8]/95 px-2 pb-3 pt-1 backdrop-blur md:sticky md:top-0">
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
          <nav className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-inset ring-[#EAE3D6]" aria-label="Reconciliation sections">
            {([["recon", "Reconciliation", RefreshCcw], ["transactions", "Bank Transactions", Landmark], ["insights", "Insights", BarChart3]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                aria-current={tab === k ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${tab === k ? "bg-[#1F1B16] text-[#FBF8F1]" : "text-[#6B6358] hover:bg-[#FBF8F1] hover:text-[#1F1B16]"}`}
              >
                <Icon size={13} aria-hidden /> {label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <label className="relative flex-1 md:w-72 md:flex-none">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8175]" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ref, order, amount…"
                aria-label="Search credits"
                className="h-9 w-full rounded-lg border-0 bg-white pl-8 pr-8 text-[13px] text-[#1F1B16] ring-1 ring-inset ring-[#EAE3D6] placeholder:text-[#B5AC98] focus:outline-none focus:ring-2 focus:ring-[#B08343]"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#8A8175] hover:text-[#1F1B16]"><X size={13} /></button>
              )}
            </label>
            <button
              onClick={exportXlsx}
              disabled={exporting || lines.length === 0}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#B08343] px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-[#9A723A] disabled:opacity-60"
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export .xlsx
            </button>
          </div>
        </div>
        {tab === "recon" && <ReconKpis lines={scoped} loading={loading} />}
      </div>

      {/* Bank Transactions keeps its own fetch and selection, so it stays mounted. */}
      <div className={tab === "transactions" ? "" : "hidden"}>
        <BankTransactionsTab fromDate={fromDate} toDate={toDate} onRange={onRange} zohoSettings={zohoConfig?.effective} zohoAccounts={zohoConfig?.allAccounts ?? []} />
      </div>

      {tab === "insights" && <InsightsTab lines={scoped} />}

      {tab === "recon" && (
        <>
          {/* 3a: status + date range */}
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
              {STATUS.map((s) => (
                <button key={s.key} onClick={() => setStatus(s.key)} aria-pressed={status === s.key} className={pill(status === s.key)}>
                  {s.label}
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${status === s.key ? "bg-white/20" : "bg-[#F3EFE7] text-[#6B6358]"}`}>{counts[s.key] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              {PRESETS.map((p) => {
                const [f, t] = p.range();
                const active = f === fromDate && t === toDate;
                return <button key={p.label} onClick={() => onRange(f, t)} className={`rounded-md px-2.5 py-1 font-medium ${active ? "bg-[#FBF3E6] text-[#6F5325] ring-1 ring-inset ring-[#E7D3B0]" : "text-[#6B6358] hover:bg-white"}`}>{p.label}</button>;
              })}
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => onRange(e.target.value, toDate)} aria-label="From date" className="h-8 rounded-md border-0 bg-white px-2 text-[12px] ring-1 ring-inset ring-[#EAE3D6] focus:outline-none focus:ring-2 focus:ring-[#B08343]" />
              <span className="text-[#B5AC98]">to</span>
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => onRange(fromDate, e.target.value)} aria-label="To date" className="h-8 rounded-md border-0 bg-white px-2 text-[12px] ring-1 ring-inset ring-[#EAE3D6] focus:outline-none focus:ring-2 focus:ring-[#B08343]" />
            </div>
          </div>

          {/* 3b: gateways — chips on desktop, one dropdown on phones. None selected = all. */}
          <div className="flex items-center gap-2">
            <div className="hidden flex-wrap items-center gap-1.5 md:flex" role="group" aria-label="Gateways">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A8175]">Gateway</span>
              {gatewayOptions.map((g) => {
                const on = gateways.has(g);
                return (
                  <button key={g} onClick={() => toggleGateway(g)} aria-pressed={on} className={pill(on)}>
                    <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(g) }} aria-hidden />
                    {g}
                    {on && <Check size={12} aria-hidden />}
                  </button>
                );
              })}
              {gateways.size > 0 && <button onClick={() => setGateways(new Set())} className="ml-1 text-[12px] font-medium text-[#B08343] hover:underline">All gateways</button>}
            </div>
            <div className="relative w-full md:hidden">
              <button onClick={() => setGwMenu((v) => !v)} aria-expanded={gwMenu} className="flex h-9 w-full items-center justify-between rounded-lg bg-white px-3 text-[13px] ring-1 ring-inset ring-[#EAE3D6]">
                <span>{gateways.size === 0 ? "All gateways" : [...gateways].join(", ")}</span>
                <ChevronDown size={14} className="text-[#8A8175]" />
              </button>
              {gwMenu && (
                <div className="absolute left-0 right-0 z-20 mt-1 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-[#EAE3D6]">
                  {gatewayOptions.map((g) => (
                    <button key={g} onClick={() => toggleGateway(g)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-[#FBF8F1]">
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${gateways.has(g) ? "border-[#1F1B16] bg-[#1F1B16] text-white" : "border-[#D6CCBA]"}`}>{gateways.has(g) && <Check size={11} />}</span>
                      <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(g) }} aria-hidden /> {g}
                    </button>
                  ))}
                  <button onClick={() => { setGateways(new Set()); setGwMenu(false); }} className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-[#B08343] hover:bg-[#FBF8F1]">All gateways</button>
                </div>
              )}
            </div>
            <span className="ml-auto hidden shrink-0 text-[11.5px] text-[#8A8175] md:inline" title={recon?.computedAt}>
              {recon?.refreshing ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Updating…</span> : recon?.computedAt ? `Updated ${ago(recon.computedAt)}` : null}
            </span>
          </div>

          <UnmatchedPayouts payouts={recon?.unmatchedPayouts ?? []} refresh={refresh} />

          {/* 4: one table */}
          <ReconGrid
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
