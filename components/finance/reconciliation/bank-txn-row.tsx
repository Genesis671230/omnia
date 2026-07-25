"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  const [draft, setDraft] = useState(line.zohoDescription ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/reconcile/bank-line/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zohoDescription: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onDescriptionSaved(line.id, draft);
      toast.success("Description saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

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
          <span className="flex-1 truncate text-[13px] text-[#1F1B16]">{line.description.slice(0,40)+"..."+line.description.slice(-40)}</span>
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
          <label className="mt-3 block text-[12px] font-medium text-[#1F1B16]">
            Description sent to Zoho
            <div className="mt-1 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 rounded-lg border border-[#D6CCBA] bg-white px-3 py-1.5 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343]"
              />
              <button
                onClick={save}
                disabled={saving || draft === (line.zohoDescription ?? "")}
                className="rounded-lg bg-[#B08343] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : "Save"}
              </button>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
