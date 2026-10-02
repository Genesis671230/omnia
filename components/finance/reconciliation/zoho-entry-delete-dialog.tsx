"use client";

/* Delete a bank line's booking from Zoho — or delete it and post it again
 * with a different mapping ("Edit"). Shows exactly what goes first: the Zoho
 * entries, their amounts, and any other bank lines booked in the same entry
 * (a charge + VAT booked as one 1.05). Route: /api/bank-lines/:id/zoho-entry. */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { DeletePlan, UndoAction } from "@/lib/finance/zoho-entry-delete";

const ACTION: Record<UndoAction, { label: string; note: string }> = {
  delete: { label: "Delete", note: "the entry is removed from Zoho" },
  uncategorize: { label: "Uncategorise", note: "categorised from the bank feed — the feed line goes back to uncategorised in Zoho" },
  unmatch: { label: "Unmatch", note: "matched to a document — the feed line is freed; the expense / payment it was matched to stays in Zoho" },
};
import type { BankTxnLine } from "./bank-txn-row";
import { aed2 } from "./types";

export function ZohoEntryDeleteDialog({ line, mode, onClose, onDeleted }: {
  line: BankTxnLine;
  /** "edit" deletes, then hands the line back to be posted again. */
  mode: "delete" | "edit";
  onClose: () => void;
  onDeleted: (clearedLineIds: string[]) => void;
}) {
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/bank-lines/${encodeURIComponent(line.id)}/zoho-entry`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j.plan as DeletePlan; })
      .then((p) => live && setPlan(p))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [line.id]);

  const siblings = plan?.targets.flatMap((t) => t.siblingLineIds) ?? [];

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/bank-lines/${encodeURIComponent(line.id)}/zoho-entry`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (j.failed?.length) toast.error(`Some entries weren't deleted: ${j.error}`);
      else toast.success(`Deleted from Zoho${j.clearedLineIds.length > 1 ? ` — ${j.clearedLineIds.length} lines are unbooked now` : ""}.`);
      onDeleted(j.clearedLineIds ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0F1B3D]/40 p-4" role="dialog" aria-modal aria-label="Delete from Zoho">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#E3E9F5] px-6 py-5">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[#0F1B3D]">{mode === "edit" ? "Edit this booking" : "Delete from Zoho"}</h3>
            <p className="mt-1 truncate text-[12.5px] text-[#5E6B85]" title={line.description}>
              {aed2(line.amount)} · {line.date?.slice(0, 10)} · {line.reference || line.description}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="rounded-full p-1.5 text-[#5E6B85] hover:bg-[#F3F6FC]"><X size={16} /></button>
        </header>

        <div className="space-y-3 px-6 py-5 text-[13px] text-[#0F1B3D]">
          {error && <p className="text-[#A6472F]">{error}</p>}
          {!plan && !error && <p className="flex items-center gap-2 text-[#5E6B85]"><Loader2 size={14} className="animate-spin" /> Looking up what&apos;s in Zoho…</p>}
          {plan?.refusal && <p className="rounded-xl bg-[#FFF7E8] px-3 py-3 text-[#7A4B00]">{plan.refusal}</p>}
          {plan && !plan.refusal && (
            <>
              <p>{mode === "edit"
                ? "Zoho has no edit for a posted bank entry, so this deletes it and opens the posting form again with the line ready to post the right way."
                : "This deletes the entry in Zoho. It can't be undone there — the line becomes unbooked here and can be posted again."}</p>
              <ul className="space-y-1.5">
                {plan.targets.map((t) => (
                  <li key={t.zohoId} className="rounded-xl border border-[#E3E9F5] bg-[#F7F9FE] px-3 py-2">
                    <div className="font-medium">
                      <span className="mr-1.5 rounded-full bg-[#F9ECE7] px-2 py-0.5 text-[11px] text-[#A6472F]">{ACTION[t.action].label}</span>
                      {t.amount != null ? aed2(t.amount) : "—"} · {t.kind === "banktransaction" ? "bank transaction" : t.kind === "vendorpayment" ? "vendor payment" : "expense"}
                    </div>
                    <div className="text-[11.5px] text-[#5E6B85]">{ACTION[t.action].note}</div>
                    <div className="text-[11.5px] text-[#5E6B85]">Zoho ref “{t.reference || "—"}” · id {t.zohoId} · {t.source === "posted_by_app" ? "posted from this app" : "found in the Zoho ledger by its bank ref"}</div>
                  </li>
                ))}
              </ul>
              {siblings.length > 0 && (
                <p className="flex items-start gap-2 rounded-xl bg-[#FFF7E8] px-3 py-2.5 text-[12.5px] text-[#7A4B00]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  The same Zoho entry also books {siblings.length} other line{siblings.length === 1 ? "" : "s"} (e.g. the charge and its VAT) — {siblings.length === 1 ? "it becomes" : "they become"} unbooked too.
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#E3E9F5] bg-[#F7F9FE] px-6 py-4">
          <button onClick={onClose} disabled={busy} className="rounded-full border border-[#C9D5EA] bg-white px-4 py-2 text-[13px] text-[#0F1B3D]">Cancel</button>
          <button onClick={run} disabled={busy || !plan || Boolean(plan.refusal)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#A6472F] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {mode === "edit" ? "Delete & post again" : "Delete from Zoho"}
          </button>
        </footer>
      </div>
    </div>
  );
}
