"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { matchesBankTxnQuery, matchesPostStatus, type PostStatusFilter } from "@/lib/reconciliation/bank-line-filters";
import { BankTxnFilters, type Direction, type PostStatusFilterValue } from "./bank-txn-filters";
import { BankTxnRow, type BankTxnLine, type BankTxnPostingState } from "./bank-txn-row";
import { BankTxnPostDialog } from "./bank-txn-post-dialog";
import { resolveDraftPosting, normalizeAccountMap, type DraftPosting } from "@/lib/reconciliation/mapping-resolver";
import type { ZohoAccountMap } from "@/lib/integrations/zoho-banking";
import { AccountCombobox } from "./account-combobox";

export type ZohoAccount = { account_id: string; account_name: string; account_type: string };

export function BankTransactionsTab({
  fromDate, toDate, onRange, zohoSettings, zohoAccounts,
}: {
  fromDate: string; toDate: string; onRange: (from: string, to: string) => void;
  zohoSettings: ZohoAccountMap; zohoAccounts: ZohoAccount[];
}) {
  const settings = normalizeAccountMap(zohoSettings);
  const [lines, setLines] = useState<BankTxnLine[]>([]);
  const [postings, setPostings] = useState<Record<string, BankTxnPostingState>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [postStatus, setPostStatus] = useState<PostStatusFilterValue>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  // Sticky defaults: set once, apply automatically to every draft that
  // doesn't already have a real gateway match — not a one-off bulk-apply
  // to whatever's checked right now. From-account defaults to Omnia
  // Stores LLC's own bank account as soon as settings load.
  const [defaultFromAccountId, setDefaultFromAccountId] = useState(settings.bankAccountId || "");
  const [defaultToAccountId, setDefaultToAccountId] = useState("");

  useEffect(() => {
    if (!defaultFromAccountId && settings.bankAccountId) setDefaultFromAccountId(settings.bankAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.bankAccountId]);

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
    () => lines
      .filter((l) => direction === "all" || l.direction === direction)
      .filter((l) => matchesBankTxnQuery(l, query))
      .filter((l) => matchesPostStatus(l.id, postings, postStatus as PostStatusFilter)),
    [lines, direction, query, postings, postStatus],
  );

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const onDescriptionSaved = (id: string, zohoDescription: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, zohoDescription } : l)));
  };

  const draftsByLineId = useMemo(() => {
    const map = new Map<string, DraftPosting>();
    for (const line of lines) {
      let draft = resolveDraftPosting(
        {
          id: line.id,
          date: line.date ?? null,
          narration: line.zohoDescription || line.description,
          reference: line.reference ?? null,
          amount: line.direction === "debit" ? -Math.abs(line.amount) : Math.abs(line.amount),
        },
        settings,
      );

      // Fill gaps with the sticky default — never overwrite a real gateway match.
      const usedFromDefault = !draft.fromAccountId && Boolean(defaultFromAccountId);
      const usedToDefault = !draft.toAccountId && Boolean(defaultToAccountId);
      if (usedFromDefault || usedToDefault) {
        draft = {
          ...draft,
          fromAccountId: (draft.fromAccountId ?? defaultFromAccountId) || undefined,
          toAccountId: (draft.toAccountId ?? defaultToAccountId) || undefined,
          reasons: [
            ...draft.reasons,
            ...(usedFromDefault ? ["using default from-account"] : []),
            ...(usedToDefault ? ["using default to-account"] : []),
          ],
        };
        if (draft.fromAccountId && draft.toAccountId) draft = { ...draft, confidence: "ready" };
      }

      map.set(line.id, draft);
    }
    return map;
  }, [lines, settings, defaultFromAccountId, defaultToAccountId]);

  const selectedDrafts = useMemo(
    () => Array.from(selected).map((id) => draftsByLineId.get(id)).filter((d): d is DraftPosting => Boolean(d)),
    [selected, draftsByLineId],
  );

  const readyIds = useMemo(
    () => visible.filter((l) => draftsByLineId.get(l.id)?.confidence === "ready").map((l) => l.id),
    [visible, draftsByLineId],
  );

  const selectAllReady = () => setSelected(new Set(readyIds));

  return (
    <>
      <BankTxnFilters query={query} onQuery={setQuery} direction={direction} onDirection={setDirection}
        postStatus={postStatus} onPostStatus={setPostStatus} fromDate={fromDate} toDate={toDate}
        onRange={onRange} resultCount={visible.length} totalCount={lines.length} />

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3">
        <div className="w-56">
          <div className="mb-1 text-[11px] text-[#8A8175]">Default from-account (fallback)</div>
          <AccountCombobox accounts={zohoAccounts} value={defaultFromAccountId}
            defaultAccountId={settings.bankAccountId} placeholder="None set"
            onChange={setDefaultFromAccountId} />
        </div>
        <div className="w-56">
          <div className="mb-1 text-[11px] text-[#8A8175]">Default to-account (fallback)</div>
          <AccountCombobox accounts={zohoAccounts} value={defaultToAccountId}
            defaultAccountId={settings.bankAccountId} placeholder="None set"
            onChange={setDefaultToAccountId} />
        </div>
        <div className="text-[11px] text-[#8A8175]">
          Applied only when a line has no real gateway match — matched lines always keep their own mapping.
        </div>
      </div>

      {readyIds.length > 0 && (
        <button onClick={selectAllReady}
          className="mb-3 rounded-full border border-[#D6CCBA] bg-white px-3 py-1.5 text-[12px] text-[#1F1B16]">
          Select all ready ({readyIds.length})
        </button>
      )}

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
            <BankTxnRow key={l.id} line={l} posting={postings[l.id]} draft={draftsByLineId.get(l.id)}
              selected={selected.has(l.id)} onToggleSelect={toggleSelect} onDescriptionSaved={onDescriptionSaved} />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#D6CCBA] bg-white px-5 py-3 shadow-lg">
          <span className="text-[13px] text-[#1F1B16]">{selected.size} selected</span>
          <button onClick={() => setDialogOpen(true)} className="rounded-full bg-[#B08343] px-4 py-1.5 text-[13px] font-medium text-white">
            Post to Zoho
          </button>
        </div>
      )}

      {dialogOpen && (
        <BankTxnPostDialog
          drafts={selectedDrafts}
          settings={settings}
          accounts={zohoAccounts}
          onClose={() => setDialogOpen(false)}
          onPosted={() => { setSelected(new Set()); load(); }}
        />
      )}
    </>
  );
}