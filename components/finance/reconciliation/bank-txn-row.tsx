"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { defaultBankLineNote } from "@/lib/reconciliation/bank-line-description";
import type { LineZohoState } from "@/lib/reconciliation/bank-line-zoho-status";
import { PostingStatusBadge, type PostingStatus } from "./posting-status-badge";
import { BankLineNoteEditor } from "./bank-line-note";
import { gatewayColor } from "./colors";
import { aed2 } from "./types";

export type BankTxnLine = {
  id: string;
  date: string | null;
  description: string;
  zohoDescription: string | null;
  reference: string;
  amount: number;
  direction: "credit" | "debit";
  gatewayGuess: string | null;
  confidence: string | null;
  kind: string | null;
  batchId: string | null;
  /** The gateway payout reconciliation matched to this credit, if any. */
  payout?: { id: string; gateway: string; orders: string[] } | null;
};

export type BankTxnPostingState = LineZohoState | undefined;

export function BankTxnRow({
  line, posting, selected, onToggleSelect, onDescriptionSaved,
}: {
  line: BankTxnLine;
  posting: BankTxnPostingState;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDescriptionSaved: (id: string, zohoDescription: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const defaultNote = defaultBankLineNote({
    direction: line.direction, amount: line.amount, date: line.date, narration: line.description,
    reference: line.reference, entity: line.gatewayGuess, kind: line.kind, payout: line.payout ?? null,
  });

  return (
    <div className="rounded-xl border border-[#D8E1F1] bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(line.id)} className="h-4 w-4" />
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-3 text-left">
          <span className="w-24 flex-shrink-0 text-[12.5px] text-[#5E6B85]">{line.date ?? "—"}</span>
          <span className="flex-1 truncate text-[13px] text-[#0F1B3D]">{line.description}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              line.direction === "credit" ? "bg-[#EAF1FD] text-[#1E3A8A]" : "bg-[#EEF2FA] text-[#5E6B85]"
            }`}
          >
            {line.direction}
          </span>
          {line.gatewayGuess && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: gatewayColor(line.gatewayGuess) }}>
              <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(line.gatewayGuess) }} />
              {line.gatewayGuess}
            </span>
          )}
          {line.kind && <span className="text-[11px] capitalize text-[#5E6B85]">{line.kind}</span>}
          <span className="w-28 flex-shrink-0 text-right text-[13px] font-medium text-[#0F1B3D]">{aed2(line.amount)}</span>
          <PostingStatusBadge status={(posting?.status ?? "not_posted") as PostingStatus} zoho={posting?.zoho} error={posting?.error} />
          <ChevronDown size={14} className={`text-[#5E6B85] transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="border-t border-[#D8E1F1] px-4 py-3 text-[12.5px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-[#5E6B85]">Reference</span>
              <div className="font-mono text-[#0F1B3D]">{line.reference || "—"}</div>
            </div>
            <div>
              <span className="text-[#5E6B85]">Batch</span>
              <div className="text-[#0F1B3D]">{line.batchId || "—"}</div>
            </div>
          </div>
          {posting?.status === "failed" && (
            <div className="mt-2 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[#A6472F]">{posting.error}</div>
          )}
          <div className="mt-3 text-[12px] font-medium text-[#0F1B3D]">
            Description for Zoho ({line.direction})
            <div className="mt-1">
              <BankLineNoteEditor
                lineId={line.id}
                note={line.zohoDescription || defaultNote}
                defaultNote={defaultNote}
                narration={line.description}
                onSaved={onDescriptionSaved}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
