"use client";

import { useMemo, useState } from "react";
import { ArrowRight, BarChart3, FileSpreadsheet, Flag, Landmark, Loader2, Package } from "lucide-react";
import { groupLines, matchesQuery, type GroupMode } from "@/lib/reconciliation/filters";
import { ReconFilters } from "./recon-filters";
import { ReconGroupHeader } from "./recon-group";
import { ReconRow } from "./recon-row";
import { InsightsTab } from "./insights-tab";
import { PayoutSummaryBar } from "./payout-summary-bar";
import { BankTransactionsTab } from "./bank-transactions-tab";
import type { ReconLine, ReconPayload } from "./types";
import { useZohoSettings } from "@/lib/hooks/use-zoho-settings";
import { gatewayFilterOptionsFromZohoAccounts, regionForLine } from "@/lib/reconciliation/gateway-filter";

/* The reconciliation surface: filters → tabs → grouped rows, or Insights.
 *
 * Search and grouping run over the lines already in memory. The DATE range is
 * the one filter that must stay server-side — /api/reconcile matches over all
 * data and filters only its output, because a payout can straddle a boundary.
 */

type Tab = "all" | "settled" | "awaiting" | "exceptions" | "flagged" | "transactions" | "insights";

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
  uploadSlotFor: (provider: string) => React.ReactNode;
}) {



  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("gateway");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [gatewayFilter, setGatewayFilter] = useState<string | null>(null); // null = All gateways

  const lines = useMemo(() => recon?.lines ?? [], [recon]);
  const postings = recon?.zohoPostings ?? {};
  const { config: zohoConfig } = useZohoSettings();

  const gatewayOptions = useMemo(
    () => gatewayFilterOptionsFromZohoAccounts(zohoConfig?.allAccounts ?? []),
    [zohoConfig],
  );

  const gatewayFiltered = useMemo(() => {
    if (!gatewayFilter) return lines;
    const opt = gatewayOptions.find((o) => o.key === gatewayFilter);
    if (!opt) return lines;
    return lines.filter((l) => l.provider === opt.gateway && regionForLine(l) === opt.region);
  }, [lines, gatewayFilter, gatewayOptions]);

  // Search first, then the tab — so a tab's count always describes what the
  // search left behind, never the unfiltered set.
  const searched = useMemo(
    () => gatewayFiltered.filter((l) => matchesQuery(l, query)),
    [gatewayFiltered, query],
  );

  const buckets = useMemo(() => ({
    all: searched,
    settled: searched.filter((l) => l.state === "SETTLED"),
    awaiting: searched.filter((l) => l.state === "AWAITING_PAYOUT"),
    // A flagged row belongs in Exceptions even when its math foots — that is
    // the entire point of letting a person raise a flag.
    exceptions: searched.filter(
      (l) => l.state === "PAYOUT_VARIANCE" || l.state === "ORDERS_UNRESOLVED" || l.reviewFlag,
    ),
    flagged: searched.filter((l) => l.reviewFlag),
    // Not used to render rows (BankTransactionsTab fetches its own data), but
    // buckets[tab] is indexed unconditionally below — every Tab needs a key
    // here or that lookup returns undefined and groupLines() throws on it.
    transactions: searched,
    insights: searched,
  }), [searched]);

  const visible: ReconLine[] = buckets[tab];
  const groups = useMemo(() => groupLines(visible, groupMode), [visible, groupMode]);

  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  const TABS: [Tab, string, number][] = [
    ["all", "All credits", buckets.all.length],
    ["settled", "Settled", buckets.settled.length],
    ["awaiting", "Awaiting", buckets.awaiting.length],
    ["exceptions", "Exceptions", buckets.exceptions.length],
    ["flagged", "Flagged", buckets.flagged.length],
    ["transactions", "Bank Transactions", -1],
    ["insights", "Insights", -1],
  ];

  return (
    <>
      <PayoutSummaryBar lines={gatewayFiltered} />

      <ReconFilters
        query={query} onQuery={setQuery}
        fromDate={fromDate} toDate={toDate} onRange={onRange}
        groupMode={groupMode} onGroupMode={setGroupMode}
        resultCount={searched.length} totalCount={lines.length}
      />

      {gatewayOptions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setGatewayFilter(null)}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
              gatewayFilter === null
                ? "border-[#1F1B16] bg-[#1F1B16] text-[#FBF8F1]"
                : "border-[#EAE3D6] bg-white text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
            }`}
          >
            All gateways
          </button>
          {gatewayOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setGatewayFilter(gatewayFilter === opt.key ? null : opt.key)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                gatewayFilter === opt.key
                  ? "border-[#1F1B16] bg-[#1F1B16] text-[#FBF8F1]"
                  : "border-[#EAE3D6] bg-white text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              tab === k
                ? "border-[#1F1B16] bg-[#1F1B16] text-[#FBF8F1]"
                : "border-[#EAE3D6] bg-white text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
            }`}
          >
            {k === "insights" && <BarChart3 size={13} />}
            {k === "flagged" && <Flag size={13} />}
            {k === "transactions" && <Landmark size={13} />}
            {label}
            {n >= 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${tab === k ? "bg-white/20" : "bg-black/[.06]"}`}>
                {n}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Stays mounted (hidden, not unmounted) across tab switches — it owns
         a live Zoho bank-transactions fetch plus its own filter/selection
         state, neither of which should reset just because the user looked
         at another tab. */}
      <div className={tab === "transactions" ? "" : "hidden"}>
        <BankTransactionsTab
          fromDate={fromDate}
          toDate={toDate}
          onRange={onRange}
          zohoSettings={zohoConfig?.effective}
          zohoAccounts={zohoConfig?.allAccounts ?? []}
        />
      </div>

      {tab === "transactions" ? null : loading ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-[14px] text-[#8A8175]">
          <Loader2 size={18} className="animate-spin" /> Running reconciliation…
        </div>
      ) : tab === "insights" ? (
        <InsightsTab lines={visible} />
      ) : lines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#8A8175]">
          No bank credits imported yet. Upload the daily bank statement — parsing turns it into credit lines, and each
          credit then waits for the payout file that explains it.
        </div>
      ) : visible.length === 0 ? (
        // Names the filters rather than reporting "no data", which would
        // misdiagnose an active filter as missing information.
        <div className="rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#8A8175]">
          No credits match{query ? <> the search <b className="text-[#1F1B16]">“{query}”</b></> : " this tab"}
          {(fromDate || toDate) && <> in {fromDate || "the start"} → {toDate || "now"}</>}.
          <br />
          {lines.length} credit{lines.length === 1 ? " is" : "s are"} loaded — widen the range or clear the search.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-[11.5px] text-[#8A8175]">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-sm bg-[#B08343]" /> resolved link
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-sm bg-[#D6CCBA]" /> pending
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-sm bg-[#A6472F]" /> broken
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              Read each row left→right: <Landmark size={12} /> bank <ArrowRight size={11} />
              <FileSpreadsheet size={12} /> payout <ArrowRight size={11} /> <Package size={12} /> orders
            </span>
          </div>

          <div className="space-y-3">
            {groups.map((g) => {
              const open = !collapsed.has(g.key);
              return (
                <div key={g.key} className="space-y-2">
                  {groupMode !== "none" && (
                    <ReconGroupHeader group={g} mode={groupMode} open={open} onToggle={() => toggleGroup(g.key)} />
                  )}
                  {open && (
                    <div className={`space-y-2 ${groupMode !== "none" ? "pl-3" : ""}`}>
                      {g.lines.map((r) => (
                        <ReconRow
                          key={r.id}
                          r={r}
                          isFounder={isFounder}
                          posting={postings[r.id]}
                          onConfirm={onConfirm}
                          refresh={refresh}
                          uploadSlot={uploadSlotFor(r.provider)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
