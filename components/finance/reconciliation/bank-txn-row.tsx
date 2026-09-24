"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { defaultBankLineNote } from "@/lib/reconciliation/bank-line-description";
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

export type BankTxnPostingState = { status: string; zohoTransactionId: string | null; error: string; postedAt: string } | undefined;

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

  const statusTone =
    posting?.status === "posted" ? "bg-[#F0F5EF] text-[#4B7A54]" :
    posting?.status === "failed" ? "bg-[#F9ECE7] text-[#A6472F]" :
    "bg-[#F3EFE7] text-[#8A8175]";
  const statusLabel = posting?.status === "posted" ? "Posted ✓" : posting?.status === "failed" ? "Failed" : "Not posted";

  return (
    <div className="rounded-xl border border-[#EAE3D6] bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(line.id)} className="h-4 w-4" />
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-3 text-left">
          <span className="w-24 flex-shrink-0 text-[12.5px] text-[#8A8175]">{line.date ?? "—"}</span>
          <span className="flex-1 truncate text-[13px] text-[#1F1B16]">{line.description}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              line.direction === "credit" ? "bg-[#FBF3E6] text-[#6F5325]" : "bg-[#F3EFE7] text-[#8A8175]"
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
          {line.kind && <span className="text-[11px] capitalize text-[#8A8175]">{line.kind}</span>}
          <span className="w-28 flex-shrink-0 text-right text-[13px] font-medium text-[#1F1B16]">{aed2(line.amount)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone}`}>{statusLabel}</span>
          <ChevronDown size={14} className={`text-[#8A8175] transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="border-t border-[#EAE3D6] px-4 py-3 text-[12.5px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-[#8A8175]">Reference</span>
              <div className="font-mono text-[#1F1B16]">{line.reference || "—"}</div>
            </div>
            <div>
              <span className="text-[#8A8175]">Batch</span>
              <div className="text-[#1F1B16]">{line.batchId || "—"}</div>
            </div>
          </div>
          {posting?.status === "failed" && (
            <div className="mt-2 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[#A6472F]">{posting.error}</div>
          )}
          <div className="mt-3 text-[12px] font-medium text-[#1F1B16]">
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
