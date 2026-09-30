"use client";

/* "Revert & replace payout": a payout file matched to the wrong statement was
 * already booked into Zoho. Shows exactly which Zoho documents will be deleted
 * (read live), asks for a reason and the word REVERT, runs it, then offers the
 * upload for the correct file on this same credit. Portalled with plain hex
 * colors like the other dialogs here. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { aed2 } from "./types";
import type { RevertDoc, RevertOutcome, RevertPlan } from "@/lib/finance/revert-payout";

const KIND_LABEL: Record<RevertDoc["kind"], string> = {
  transfer: "Clearing → bank transfer", wire_journal: "Bank charge / surplus journal", fx_journal: "Exchange journals",
  fee_expense: "Gateway fee expenses", delivery_expense: "COD delivery charges", refund_charge: "Refund charges",
  creditnote_refund: "Credit note refunds", credit_note: "Credit notes raised by the app", payment: "Customer payments (invoices reopen)",
};

export function RevertPayoutDialog({ bankLineId, onClose, onDone, uploadSlot }: {
  bankLineId: string;
  onClose: () => void;
  onDone: () => void;
  uploadSlot: React.ReactNode;
}) {
  const [plan, setPlan] = useState<RevertPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RevertOutcome | null>(null);

  useEffect(() => {
    fetch(`/api/reconcile/line/${encodeURIComponent(bankLineId)}/revert-payout`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setPlan(j); })
      .catch((e) => setError((e as Error).message));
  }, [bankLineId]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/reconcile/line/${encodeURIComponent(bankLineId)}/revert-payout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm, reason }),
      });
      const j = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(j.error || `HTTP ${res.status}`);
      setOutcome(j);
      if (j.completed) toast.success(`Reverted: ${j.deleted.length} Zoho entries deleted. Upload the correct payout file.`);
      else toast.error(`Stopped after ${j.deleted.length} deletions: ${j.failed[0]?.error ?? "unknown error"}. Run again to continue.`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const live = plan?.docs.filter((d) => d.exists) ?? [];
  const groups = Object.entries(
    live.reduce<Record<string, RevertDoc[]>>((acc, d) => { (acc[d.kind] ??= []).push(d); return acc; }, {}),
  ) as [RevertDoc["kind"], RevertDoc[]][];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: "rgba(15,27,61,0.45)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-auto w-full max-w-2xl rounded-2xl p-6 shadow-2xl" style={{ background: "#FFFFFF", color: "#0F1B3D" }}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[16px] font-semibold"><RotateCcw size={16} className="text-[#9B3A24]" /> Revert &amp; replace payout</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[#46546F]">
              Deletes every Zoho entry booked from this payout file, clears our records, un-confirms the credit and removes the file, so the correct file can be uploaded and booked fresh.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[#5E6B85] hover:bg-[#EEF2FA]"><X size={18} /></button>
        </div>

        {error && <div className="rounded-lg bg-[#FBECE8] px-3 py-2 text-[12.5px] text-[#9B3A24]">{error}</div>}
        {!plan && !error && <div className="flex items-center gap-2 py-8 text-[13px] text-[#5E6B85]"><Loader2 size={15} className="animate-spin" /> Reading what this payout booked in Zoho…</div>}

        {plan && !outcome && (
          <div className="space-y-4 text-[13px]">
            <div className="rounded-xl bg-[#F3F6FC] px-3.5 py-3 text-[12.5px] leading-relaxed">
              <div><span className="text-[#5E6B85]">Bank credit</span> <b>{aed2(plan.bankAmount)}</b> · {plan.bankDate} · <span className="font-mono">{plan.bankReference}</span></div>
              <div><span className="text-[#5E6B85]">Payout file</span> <span className="font-mono">{plan.payoutId}</span></div>
              {plan.payoutSource && <div className="truncate text-[#5E6B85]">{plan.payoutSource}</div>}
              <div className="mt-1 line-clamp-2 text-[11.5px] text-[#5E6B85]">Bank narration: {plan.narration}</div>
            </div>

            {live.length === 0 ? (
              <p className="text-[#46546F]">Nothing from this payout is in Zoho. Reverting only clears our records and removes the file.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-[#D8E1F1]">
                {groups.map(([kind, ds]) => (
                  <details key={kind} className="border-b border-[#EEF2FA] last:border-0">
                    <summary className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[#F3F6FC]">
                      <span className="font-medium">{KIND_LABEL[kind]} <span className="text-[#5E6B85]">· {ds.length}</span></span>
                      <span className="font-mono tabular-nums">{aed2(ds.reduce((s, d) => s + (d.amount ?? 0), 0))}</span>
                    </summary>
                    <ul className="bg-[#FFFDF9] px-3.5 pb-2 text-[12px]">
                      {ds.map((d) => (
                        <li key={d.zohoId} className="flex justify-between gap-3 py-1">
                          <span className="truncate">{d.label}</span>
                          <span className="shrink-0 font-mono tabular-nums text-[#46546F]">{d.amount != null ? aed2(d.amount) : "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}
            {plan.skipped.length > 0 && (
              <div className="rounded-lg bg-[#FDF4E4] px-3 py-2 text-[12px] text-[#8A5A12]">
                <b>Left untouched:</b> {plan.skipped.map((s) => `${s.label} (${s.reason})`).join("; ")}
              </div>
            )}
            <p className="text-[12px] text-[#5E6B85]">
              Also cleared here: {plan.localRecords.settlements} settlement record{plan.localRecords.settlements === 1 ? "" : "s"}, {plan.localRecords.refunds} refund posting{plan.localRecords.refunds === 1 ? "" : "s"}. The revert is logged with your reason.
            </p>

            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5E6B85]">Why</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong Tamara statement (other merchant) uploaded" className="mt-1 h-9 w-full rounded-lg border-0 px-3 text-[13px] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5E6B85]">Type REVERT to confirm</span>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 h-9 w-full rounded-lg border-0 px-3 font-mono text-[13px] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#9B3A24]" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[#46546F] hover:bg-[#EEF2FA]">Cancel</button>
              <button
                onClick={run}
                disabled={running || confirm !== "REVERT" || !reason.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#9B3A24] px-3.5 py-2 text-[13px] font-medium text-white hover:bg-[#82301D] disabled:opacity-50"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {running ? "Deleting in Zoho…" : `Delete ${live.length} Zoho entr${live.length === 1 ? "y" : "ies"} and revert`}
              </button>
            </div>
          </div>
        )}

        {outcome && (
          <div className="space-y-4 text-[13px]">
            {outcome.completed ? (
              <div className="flex items-start gap-2 rounded-xl bg-[#EEF6EF] px-3.5 py-3 text-[#2F6B3B]">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                <div>Reverted. {outcome.deleted.filter((d) => d.exists).length} Zoho entries deleted, the invoices are open again, and the credit is back to Awaiting payout. Upload the correct file below; it books like any new payout.</div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl bg-[#FBECE8] px-3.5 py-3 text-[#9B3A24]">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>Stopped after {outcome.deleted.length} of {outcome.plan.docs.length}: {outcome.failed[0]?.doc.label}: {outcome.failed[0]?.error}. Nothing after it was touched. Fix that entry in Zoho (or retry), then run the revert again; it resumes where it stopped.</div>
              </div>
            )}
            {outcome.completed && <div>{uploadSlot}</div>}
            <div className="flex justify-end"><button onClick={onClose} className="rounded-full bg-[#0F1B3D] px-3.5 py-2 text-[13px] font-medium text-[#F3F6FC]">Done</button></div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
