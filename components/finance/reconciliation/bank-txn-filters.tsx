"use client";

import { Search, X } from "lucide-react";
import type { PostStatusFilter } from "@/lib/reconciliation/bank-line-filters";

export type Direction = "all" | "credit" | "debit";
export type PostStatusFilterValue = PostStatusFilter;

export function BankTxnFilters({
  query, onQuery, direction, onDirection, postStatus, onPostStatus,
  fromDate, toDate, onRange, resultCount, totalCount,
}: {
  query: string; onQuery: (v: string) => void;
  direction: Direction; onDirection: (v: Direction) => void;
  postStatus: PostStatusFilterValue; onPostStatus: (v: PostStatusFilterValue) => void;
  fromDate: string; toDate: string; onRange: (from: string, to: string) => void;
  resultCount: number; totalCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8175]" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search narration, ref, amount, date, Zoho account…"
          className="w-full rounded-lg border border-[#EAE3D6] bg-white py-2 pl-8 pr-8 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343]"
        />
        {query && (
          <button onClick={() => onQuery("")} title="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#8A8175] hover:text-[#1F1B16]">
            <X size={13} />
          </button>
        )}
      </div>
      <select
        value={direction}
        onChange={(e) => onDirection(e.target.value as Direction)}
        className="rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[13px] text-[#1F1B16]"
      >
        <option value="all">Credits + debits</option>
        <option value="credit">Credits only</option>
        <option value="debit">Debits only</option>
      </select>
      <select
        value={postStatus}
        onChange={(e) => onPostStatus(e.target.value as PostStatusFilterValue)}
        className="rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[13px] text-[#1F1B16]"
      >
        <option value="all">Any Zoho status</option>
        <option value="in_zoho">In Zoho</option>
        <option value="not_in_zoho">Not in Zoho</option>
        <option value="needs_review">Amount differs / unbooked</option>
        <option value="failed">Post failed</option>
        <option value="not_checked">Not checked yet</option>
      </select>
      <label className="inline-flex items-center gap-1.5 text-[12px] text-[#8A8175]">
        From
        <input
          type="date" value={fromDate} max={toDate || undefined}
          onChange={(e) => onRange(e.target.value, toDate)}
          className="rounded-lg border border-[#D6CCBA] bg-white px-2 py-1.5 text-[12.5px] text-[#1F1B16]"
        />
      </label>
      <label className="inline-flex items-center gap-1.5 text-[12px] text-[#8A8175]">
        To
        <input
          type="date" value={toDate} min={fromDate || undefined}
          onChange={(e) => onRange(fromDate, e.target.value)}
          className="rounded-lg border border-[#D6CCBA] bg-white px-2 py-1.5 text-[12.5px] text-[#1F1B16]"
        />
      </label>
      <span className="text-[12px] text-[#8A8175]">{resultCount} of {totalCount}</span>
    </div>
  );
}
