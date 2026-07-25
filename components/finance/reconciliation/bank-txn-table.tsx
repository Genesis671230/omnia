// bank-txn-table.tsx
"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { PostingStatusBadge, type PostingStatus } from "./posting-status-badge";
import type { BankTxnLine, BankTxnPostingState } from "./bank-txn-row";
import type { DraftPosting } from "@/lib/reconciliation/mapping-resolver";
import { aed2 } from "./types";

type SortKey = "date" | "amount" | "status";

function resolveStatus(posting?: BankTxnPostingState): PostingStatus {
  if (!posting) return "not_posted";
  return (posting.status as PostingStatus) ?? "not_posted";
}

export function BankTxnTable({
  lines, postings, draftsByLineId, selected, onToggleSelect,
}: {
  lines: BankTxnLine[];
  postings: Record<string, BankTxnPostingState>;
  draftsByLineId: Map<string, DraftPosting>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = useMemo(() => {
    const rows = [...lines];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = String(a.date).localeCompare(String(b.date));
      if (sortKey === "amount") cmp = a.amount - b.amount;
      if (sortKey === "status") cmp = resolveStatus(postings[a.id]).localeCompare(resolveStatus(postings[b.id]));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [lines, postings, sortKey, sortDir]);

  const Header = ({ label, sortableKey }: { label: string; sortableKey?: SortKey }) => (
    <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#8A8175]">
      {sortableKey ? (
        <button onClick={() => toggleSort(sortableKey)} className="inline-flex items-center gap-1">
          {label} <ArrowUpDown size={11} className="opacity-50" />
        </button>
      ) : label}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-[#EAE3D6]">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-[#FBF8F1]">
          <tr>
            <th className="w-8 px-3 py-2" />
            <Header label="Date" sortableKey="date" />
            <Header label="Description" />
            <Header label="Reference" />
            <Header label="Amount" sortableKey="amount" />
            <Header label="Direction" />
            <Header label="Gateway" />
            <Header label="Status" sortableKey="status" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const posting = postings[l.id];
            const draft = draftsByLineId.get(l.id);
            const status = resolveStatus(posting);
            return (
              <tr key={l.id} className="border-t border-[#EAE3D6] hover:bg-[#FBF8F1]">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => onToggleSelect(l.id)} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[#1F1B16]">{l.date}</td>
                <td className="max-w-xs truncate px-3 py-2 text-[#1F1B16]" title={l.zohoDescription || l.description}>
                  {l.zohoDescription || l.description}
                </td>
                <td className="px-3 py-2 text-[#8A8175]">{l.reference || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-[#1F1B16]">{aed2(l.amount)}</td>
                <td className="px-3 py-2 capitalize text-[#8A8175]">{l.direction}</td>
                <td className="px-3 py-2 text-[#8A8175]">{draft?.intent.entity ?? l.gatewayGuess ?? "—"}</td>
                <td className="px-3 py-2">
                  <PostingStatusBadge status={status} zohoStatus={(posting as any)?.zohoStatus} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}