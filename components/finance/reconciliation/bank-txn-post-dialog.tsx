"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Building2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { DraftPosting, ZohoTransactionType } from "@/lib/reconciliation/mapping-resolver";
import { guessAccountId } from "@/lib/reconciliation/mapping-resolver";
import type { ZohoAccountMap } from "@/lib/integrations/zoho-banking";
import { AccountCombobox } from "./account-combobox";
import { zohoDescriptionFor } from "@/lib/reconciliation/bank-line-description";
import { saveBankLineNote } from "./bank-line-note";
import { aed2 } from "./types";
import { inferTransactionType } from "@/lib/reconciliation/infer-transaction-type";

type ZohoAccount = { account_id: string; account_name: string; account_type: string };

const TRANSACTION_TYPES: ZohoTransactionType[] = [
  "deposit", "expense", "transfer_fund", "owner_contribution", "owner_drawings", "interest_income", "other_income",
];

const TYPE_LABEL: Record<ZohoTransactionType, string> = {
  deposit: "Deposit", expense: "Expense", transfer_fund: "Transfer between accounts", owner_contribution: "Owner contribution",
  owner_drawings: "Owner drawings", interest_income: "Interest income", other_income: "Other income",
};

function withAutoMatch(drafts: DraftPosting[], accounts: ZohoAccount[]): DraftPosting[] {
  return drafts.map((d) => {
    if (d.fromAccountId && d.toAccountId) return d;
    const guess = guessAccountId(d.intent.entity, accounts);
    if (!guess) return d;
    // Credit lines: money moves gateway → bank, so the guess fills toAccountId when it's blank.
    // Debit lines: bank → gateway/expense, so the guess fills fromAccountId when it's blank.
    if (!d.toAccountId && d.fromAccountId) return { ...d, toAccountId: guess };
    if (!d.fromAccountId && d.toAccountId) return { ...d, fromAccountId: guess };
    return d;
  });
}

export function BankTxnPostDialog({
  drafts, settings, accounts, onClose, onPosted, onDescriptionSaved, onPaySupplier,
}: {
  drafts: DraftPosting[];
  settings: ZohoAccountMap;
  accounts: ZohoAccount[];
  onClose: () => void;
  onPosted: () => void;
  onDescriptionSaved?: (id: string, zohoDescription: string) => void;
  /** A debit that paid a supplier: book it as a vendor payment against their bills instead. */
  onPaySupplier?: (bankLineId: string) => void;
}) {
  const suggestedIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of drafts) {
      const guess = guessAccountId(d.intent.entity, accounts);
      if (guess) map.set(d.bankLineId, guess);
    }
    return map;
  }, [drafts, accounts]);

  const [items, setItems] = useState<DraftPosting[]>(() => withAutoMatch(drafts ?? [], accounts));
  const [posting, setPosting] = useState(false);
  // Lines whose type someone picked by hand — account changes stop re-deriving it.
  const [typeOverride, setTypeOverride] = useState<Set<string>>(new Set());
  const [showType, setShowType] = useState<Set<string>>(new Set());

  const canPost = useMemo(
    () => (items ?? []).length > 0 && (items ?? []).every((d) => Boolean(d.fromAccountId) && Boolean(d.toAccountId) && d.amount > 0),
    [items],
  );

  const updateDraft = (bankLineId: string, patch: Partial<DraftPosting>) => {
    setItems((prev) => prev.map((d) => {
      if (d.bankLineId !== bankLineId) return d;
      const next = { ...d, ...patch };
      // The account that isn't this statement's own decides the type.
      if (!typeOverride.has(bankLineId) && (patch.fromAccountId !== undefined || patch.toAccountId !== undefined)) {
        const otherId = d.direction === "credit" ? next.fromAccountId : next.toAccountId;
        const inferred = inferTransactionType(d.direction, accounts.find((a) => a.account_id === otherId));
        if (inferred) next.transactionType = inferred;
      }
      return next;
    }));
  };
  

  const narrationOf = (d: DraftPosting) => d.bankNarration ?? d.description;
  const descriptionOf = (d: DraftPosting) => zohoDescriptionFor(d.note, narrationOf(d));
  const original = useMemo(() => new Map((drafts ?? []).map((d) => [d.bankLineId, d.note ?? ""])), [drafts]);

  const confirm = async () => {
    setPosting(true);
    try {
      // Keep edited descriptions on the line (DB only — no Zoho call), so the
      // table and any re-post show the same text.
      for (const d of items) {
        const note = (d.note ?? "").trim();
        if (note === (original.get(d.bankLineId) ?? "").trim()) continue;
        const stored = note === (d.defaultNote ?? "").trim() ? "" : note;
        await saveBankLineNote(d.bankLineId, stored);
        onDescriptionSaved?.(d.bankLineId, stored);
      }
      const res = await fetch("/api/integrations/zoho/post-bank-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drafts: items.map((d) => ({
            bankLineId: d.bankLineId,
            transactionType: d.transactionType,
            fromAccountId: d.fromAccountId,
            toAccountId: d.toAccountId,
            amount: d.amount,
            date: d.date,
            description: descriptionOf(d),
            reference: d.reference,
          })),
          actor: "founder",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const failed = json.results.filter((r: { status: string }) => r.status === "failed").length;
      const ok = json.results.length - failed;
      toast.success(`${ok} posted to Zoho${failed ? `, ${failed} failed` : ""}`);
      onPosted();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[#0F1B3D]">Review {items.length} Zoho posting{items.length === 1 ? "" : "s"}</h3>
            <p className="mt-1 text-[12px] text-[#5E6B85]">Confirm or edit account mapping before posting.</p>
          </div>
          <button onClick={onClose}><X size={16} className="text-[#5E6B85]" /></button>
        </div>

        <div className="space-y-3">
          {(items ?? []).map((d) => (
            <div key={d.bankLineId} className="rounded-xl border border-[#D8E1F1] bg-[#F3F6FC] p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#0F1B3D]">
                    {d.amount > 0 ? aed2(d.amount) : ""} · {d.date?.slice(0, 10)}{d.reference ? ` · Ref: ${d.reference}` : ""}
                  </div>
                  <div className="mt-1 break-words text-[11.5px] leading-relaxed text-[#5E6B85]">
                    <span className="font-semibold">Bank narration:</span> {narrationOf(d)}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#5E6B85]">{d.reasons[0] || "Manual review"}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {onPaySupplier && d.direction === "debit" && (
                    <button onClick={() => onPaySupplier(d.bankLineId)}
                      title="Apply this payment to the supplier's open bills in Zoho, or leave it on the supplier as an advance"
                      className="inline-flex items-center gap-1 rounded-full border border-[#1D4ED8]/30 bg-white px-2.5 py-1 text-[11px] font-medium text-[#1D4ED8] hover:bg-[#EEF2FA]">
                      <Building2 size={12} /> Pay supplier / apply to bills
                    </button>
                  )}
                  <div className={`rounded-full px-2.5 py-1 text-[11px] ${d.confidence === "ready" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {d.confidence}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="text-[12px] text-[#0F1B3D]">
                  From account
                  <div className="mt-1">
                    <AccountCombobox accounts={accounts} value={d.fromAccountId}
                      defaultAccountId={settings.bankAccountId} suggestedAccountId={suggestedIds.get(d.bankLineId)}
                      onChange={(id) => updateDraft(d.bankLineId, { fromAccountId: id })} />
                  </div>
                </div>
                <div className="text-[12px] text-[#0F1B3D]">
                  To account
                  <div className="mt-1">
                    <AccountCombobox accounts={accounts} value={d.toAccountId}
                      defaultAccountId={settings.bankAccountId} suggestedAccountId={suggestedIds.get(d.bankLineId)}
                      onChange={(id) => updateDraft(d.bankLineId, { toAccountId: id })} />
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[#5E6B85]">
                Books in Zoho as <span className="rounded-full bg-white px-2 py-0.5 font-medium text-[#0F1B3D]">{TYPE_LABEL[d.transactionType] ?? d.transactionType}</span>
                {typeOverride.has(d.bankLineId) ? "(set by hand)" : "(from the account picked)"}
                {showType.has(d.bankLineId) ? (
                  <select className="rounded-lg border border-[#C9D5EA] bg-white px-2 py-1 text-[12px]" value={d.transactionType} autoFocus
                    onChange={(e) => {
                      setTypeOverride((s) => new Set(s).add(d.bankLineId));
                      updateDraft(d.bankLineId, { transactionType: e.target.value as ZohoTransactionType });
                    }}>
                    {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                ) : (
                  <button className="text-[#1D4ED8] hover:underline" onClick={() => setShowType((s) => new Set(s).add(d.bankLineId))}>change</button>
                )}
              </div>

              <label className="mt-3 block text-[12px] text-[#0F1B3D]">
                Description (pre-filled, edit freely)
                <textarea
                  value={d.note ?? ""}
                  onChange={(e) => updateDraft(d.bankLineId, { note: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-[#C9D5EA] bg-white px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-[#1D4ED8]"
                />
              </label>
              <div className="mt-1 rounded-md bg-[#EEF2FA] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#46546F]">
                <span className="font-semibold">Zoho will get:</span> {descriptionOf(d)}
              </div>

              {(!d.fromAccountId || !d.toAccountId) && (
                <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[#A6472F]"><AlertTriangle size={13} /> Missing account mapping</div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[#C9D5EA] bg-white px-4 py-2 text-[13px] text-[#0F1B3D]">Cancel</button>
          <button onClick={confirm} disabled={posting || !canPost}
            className="inline-flex items-center gap-2 rounded-full bg-[#0F1B3D] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">
            {posting ? <Loader2 size={15} className="animate-spin" /> : null} Confirm & post
          </button>
        </div>
      </div>
    </div>
  );
}