"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { matchesBankTxnQuery, matchesPostStatus, type PostStatusFilter } from "@/lib/reconciliation/bank-line-filters";
import { BankTxnFilters, type Direction, type PostStatusFilterValue } from "./bank-txn-filters";
import { BankTxnRow, type BankTxnLine, type BankTxnPostingState } from "./bank-txn-row";
import { BankTxnPostDialog } from "./bank-txn-post-dialog";

export function BankTransactionsTab({
  fromDate, toDate, onRange,
}: {
  fromDate: string; toDate: string; onRange: (from: string, to: string) => void;
}) {
  const [lines, setLines] = useState<BankTxnLine[]>([]);
  const [postings, setPostings] = useState<Record<string, BankTxnPostingState>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [postStatus, setPostStatus] = useState<PostStatusFilterValue>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const r = await fetch(`/api/reconcile/bank-lines?${params}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setLines(r.lines);
      setPostings(r.postings);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () =>
      lines
        .filter((l) => direction === "all" || l.direction === direction)
        .filter((l) => matchesBankTxnQuery(l, query))
        .filter((l) => matchesPostStatus(l.id, postings, postStatus as PostStatusFilter)),
    [lines, direction, query, postings, postStatus],
  );

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const onDescriptionSaved = (id: string, zohoDescription: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, zohoDescription } : l)));
  };

  return (
    <>
      <BankTxnFilters
        query={query} onQuery={setQuery}
        direction={direction} onDirection={setDirection}
        postStatus={postStatus} onPostStatus={setPostStatus}
        fromDate={fromDate} toDate={toDate} onRange={onRange}
        resultCount={visible.length} totalCount={lines.length}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-[14px] text-[#8A8175]">
          <Loader2 size={18} className="animate-spin" /> Loading bank transactions…
        </div>
      ) : lines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#8A8175]">
          No bank lines imported yet. Upload a statement (PDF, CSV, or XLS/XLSX) above.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#8A8175]">
          No lines match the current filters. {lines.length} line{lines.length === 1 ? " is" : "s are"} loaded.
        </div>
      ) : (
        <div className="space-y-2 pb-16">
          {visible.map((l) => (
            <BankTxnRow
              key={l.id}
              line={l}
              posting={postings[l.id]}
              selected={selected.has(l.id)}
              onToggleSelect={toggleSelect}
              onDescriptionSaved={onDescriptionSaved}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#D6CCBA] bg-white px-5 py-3 shadow-lg">
          <span className="text-[13px] text-[#1F1B16]">{selected.size} selected</span>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded-full bg-[#B08343] px-4 py-1.5 text-[13px] font-medium text-white"
          >
            Post to Zoho
          </button>
        </div>
      )}

      {dialogOpen && (
        <BankTxnPostDialog
          bankLineIds={[...selected]}
          onClose={() => setDialogOpen(false)}
          onPosted={() => { setSelected(new Set()); load(); }}
        />
      )}
    </>
  );
}
