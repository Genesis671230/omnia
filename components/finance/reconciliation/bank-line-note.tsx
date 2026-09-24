"use client";

/* The extra description on a bank line (credit or debit). Pre-filled with what
 * the app knows — gateway, payout, orders, counterparty, references — and
 * editable. Saved to bank_lines.zoho_description (a DB write, no Zoho call);
 * Zoho receives "<note> | Bank: <narration>" when the line is posted.
 * Clearing the note and saving goes back to the pre-filled text. */

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { zohoDescriptionFor } from "@/lib/reconciliation/bank-line-description";

export async function saveBankLineNote(lineId: string, note: string): Promise<void> {
  const res = await fetch(`/api/reconcile/bank-line/${lineId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zohoDescription: note }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
}

export function BankLineNoteEditor({
  lineId, note, defaultNote, narration, onSaved, autoFocus,
}: {
  lineId: string;
  /** The note in effect: the saved one, or the pre-filled default. */
  note: string;
  defaultNote: string;
  narration: string;
  onSaved: (lineId: string, saved: string) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(note), [note]);

  const save = async (value: string) => {
    setSaving(true);
    try {
      // Saving the default verbatim stores nothing: the line keeps following
      // the default as the payout/orders behind it change.
      const stored = value.trim() === defaultNote.trim() ? "" : value.trim();
      await saveBankLineNote(lineId, stored);
      onSaved(lineId, stored);
      toast.success(stored ? "Description saved" : "Using the pre-filled description");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <textarea
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-[#D6CCBA] bg-white px-3 py-1.5 text-[12.5px] leading-relaxed text-[#1F1B16] outline-none focus:border-[#B08343]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => save(draft)}
          disabled={saving || draft.trim() === note.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-[#B08343] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null} Save
        </button>
        {draft.trim() !== defaultNote.trim() && (
          <button
            onClick={() => { setDraft(defaultNote); save(defaultNote); }}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg border border-[#D6CCBA] bg-white px-2.5 py-1 text-[12px] text-[#6F5325]"
          >
            <RotateCcw size={11} /> Pre-filled
          </button>
        )}
        <span className="text-[11px] text-[#8A8175]">Saving doesn&apos;t call Zoho</span>
      </div>
      <div className="rounded-md bg-[#F3EFE7] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#6F6457]">
        <span className="font-semibold">Zoho will get:</span> {zohoDescriptionFor(draft, narration)}
      </div>
    </div>
  );
}
