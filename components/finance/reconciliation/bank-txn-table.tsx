// bank-txn-table.tsx
"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowUpDown, Pencil } from "lucide-react";
import { BankLineNoteEditor } from "./bank-line-note";
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
  lines, postings, draftsByLineId, selected, onToggleSelect, onDescriptionSaved, onPaySupplier,
}: {
  lines: BankTxnLine[];
  postings: Record<string, BankTxnPostingState>;
  draftsByLineId: Map<string, DraftPosting>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onDescriptionSaved: (id: string, zohoDescription: string) => void;
  /** Debits not yet in Zoho: book as a supplier payment or to an account. */
  onPaySupplier?: (line: BankTxnLine) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
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
    <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#5E6B85]">
      {sortableKey ? (
        <button onClick={() => toggleSort(sortableKey)} className="inline-flex items-center gap-1">
          {label} <ArrowUpDown size={11} className="opacity-50" />
        </button>
      ) : label}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-[#D8E1F1]">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-[#F3F6FC]">
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
            const note = draft?.note ?? "";
            return (
              <Fragment key={l.id}>
              <tr className="border-t border-[#D8E1F1] hover:bg-[#F3F6FC]">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => onToggleSelect(l.id)}
                    disabled={status === "verified" && !selected.has(l.id)}
                    title={status === "verified" ? "Already in Zoho — nothing to post" : undefined} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[#0F1B3D]">{l.date}</td>
                <td className="max-w-md px-3 py-2">
                  <div className="truncate text-[#0F1B3D]" title={l.description}>{l.description}</div>
                  <button
                    onClick={() => setEditing(editing === l.id ? null : l.id)}
                    className="group mt-0.5 flex w-full items-start gap-1 text-left text-[12px] text-[#1E3A8A]"
                    title="Edit the description sent to Zoho"
                  >
                    <Pencil size={11} className="mt-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100" />
                    <span className={`truncate ${l.zohoDescription ? "font-medium" : "italic"}`}>{note || "Add a description"}</span>
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-[12px] text-[#5E6B85]">{l.reference || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-[#0F1B3D]">{aed2(l.amount)}</td>
                <td className="px-3 py-2 capitalize text-[#5E6B85]">{l.direction}</td>
                <td className="px-3 py-2 text-[#5E6B85]">{draft?.intent.entity ?? l.gatewayGuess ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <PostingStatusBadge status={status} zoho={posting?.zoho} error={posting?.error} />
                    {onPaySupplier && l.direction === "debit" && (status === "not_posted" || status === "failed") && (
                      <button onClick={(e) => { e.stopPropagation(); onPaySupplier(l); }} className="whitespace-nowrap rounded-full border border-[#C9D5EA] bg-white px-2.5 py-0.5 text-[11.5px] text-[#0F1B3D] hover:border-[#1D4ED8]">
                        Pay supplier
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {editing === l.id && (
                <tr className="bg-[#F3F6FC]">
                  <td />
                  <td colSpan={7} className="px-3 pb-3 pt-1">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#5E6B85]">
                      Description for Zoho ({l.direction})
                    </div>
                    <BankLineNoteEditor
                      lineId={l.id}
                      note={note}
                      defaultNote={draft?.defaultNote ?? ""}
                      narration={l.description}
                      autoFocus
                      onSaved={(id, saved) => { onDescriptionSaved(id, saved); setEditing(null); }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}