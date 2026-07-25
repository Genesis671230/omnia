// "use client";

// import { useEffect, useState } from "react";
// import { AlertTriangle, Loader2, X } from "lucide-react";
// import { toast } from "sonner";
// import { aed2 } from "./types";

// export type PostPreviewLine = {
//   bankLineId: string;
//   status: "posted" | "failed";
//   error?: string;
//   posting?: { transaction_type: string; amount: number; description: string; date: string };
// };

// export function BankTxnPostDialog({
//   bankLineIds, onClose, onPosted,
// }: {
//   bankLineIds: string[];
//   onClose: () => void;
//   onPosted: () => void;
// }) {
//   const [preview, setPreview] = useState<PostPreviewLine[] | null>(null);
//   const [loading, setLoading] = useState(true);
//   const [posting, setPosting] = useState(false);

//   useEffect(() => {
//     (async () => {
//       try {
//         const res = await fetch("/api/integrations/zoho/post-bank-lines", {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({ bankLineIds, dryRun: true }),
//         });
//         const json = await res.json();
//         if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
//         setPreview(json.results);
//       } catch (e) {
//         toast.error((e as Error).message);
//         onClose();
//       } finally {
//         setLoading(false);
//       }
//     })();
//     // bankLineIds is a fixed snapshot for the lifetime of this dialog
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   const confirm = async () => {
//     setPosting(true);
//     try {
//       const res = await fetch("/api/integrations/zoho/post-bank-lines", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ bankLineIds, actor: "founder" }),
//       });
//       const json = await res.json();
//       if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
//       const results = json.results as PostPreviewLine[];
//       const failed = results.filter((r) => r.status === "failed").length;
//       const ok = results.length - failed;
//       toast.success(`${ok} posted to Zoho${failed ? `, ${failed} failed` : ""}`);
//       onPosted();
//       onClose();
//     } catch (e) {
//       toast.error((e as Error).message);
//     } finally {
//       setPosting(false);
//     }
//   };

//   return (
//     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
//       <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
//         <div className="mb-4 flex items-center justify-between">
//           <h3 className="text-[15px] font-semibold text-[#1F1B16]">Post {bankLineIds.length} to Zoho</h3>
//           <button onClick={onClose}><X size={16} className="text-[#8A8175]" /></button>
//         </div>

//         {loading ? (
//           <div className="flex items-center gap-2 py-8 text-[13px] text-[#8A8175]">
//             <Loader2 size={16} className="animate-spin" /> Building preview…
//           </div>
//         ) : (
//           <div className="space-y-2">
//             {(preview ?? []).map((r) => (
//               <div
//                 key={r.bankLineId}
//                 className={`rounded-lg border px-3 py-2 text-[12.5px] ${
//                   r.status === "failed" ? "border-[#A6472F]/30 bg-[#F9ECE7]" : "border-[#EAE3D6] bg-[#FBF8F1]"
//                 }`}
//               >
//                 {r.status === "failed" ? (
//                   <span className="inline-flex items-center gap-1.5 text-[#A6472F]"><AlertTriangle size={13} /> {r.error}</span>
//                 ) : (
//                   <span className="text-[#1F1B16]">
//                     {r.posting?.transaction_type} · {aed2(r.posting?.amount ?? 0)} · {r.posting?.description}
//                   </span>
//                 )}
//               </div>
//             ))}
//           </div>
//         )}

//         <div className="mt-5 flex justify-end gap-2">
//           <button onClick={onClose} className="rounded-lg border border-[#D6CCBA] bg-white px-4 py-2 text-[13px] text-[#1F1B16]">
//             Cancel
//           </button>
//           <button
//             onClick={confirm}
//             disabled={posting || loading || !preview?.some((r) => r.status === "posted")}
//             className="inline-flex items-center gap-2 rounded-lg bg-[#B08343] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
//           >
//             {posting ? <Loader2 size={15} className="animate-spin" /> : null} Confirm & post
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }





"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { DraftPosting, ZohoTransactionType } from "@/lib/reconciliation/mapping-resolver";
import { guessAccountId } from "@/lib/reconciliation/mapping-resolver";
import type { ZohoAccountMap } from "@/lib/integrations/zoho-banking";
import { AccountCombobox } from "./account-combobox";
import { aed2 } from "./types";

type ZohoAccount = { account_id: string; account_name: string; account_type: string };

const TRANSACTION_TYPES: ZohoTransactionType[] = [
  "deposit", "expense", "transfer_fund", "owner_contribution", "owner_drawings", "interest_income", "other_income",
];

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
  drafts, settings, accounts, onClose, onPosted,
}: {
  drafts: DraftPosting[];
  settings: ZohoAccountMap;
  accounts: ZohoAccount[];
  onClose: () => void;
  onPosted: () => void;
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

  const canPost = useMemo(
    () => (items ?? []).length > 0 && (items ?? []).every((d) => Boolean(d.fromAccountId) && Boolean(d.toAccountId) && d.amount > 0),
    [items],
  );

  const updateDraft = (bankLineId: string, patch: Partial<DraftPosting>) => {
    setItems((prev) => prev.map((d) => (d.bankLineId === bankLineId ? { ...d, ...patch } : d)));
  };

  const confirm = async () => {
    setPosting(true);
    try {
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
            description: d.description,
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
            <h3 className="text-[15px] font-semibold text-[#1F1B16]">Review {items.length} Zoho posting{items.length === 1 ? "" : "s"}</h3>
            <p className="mt-1 text-[12px] text-[#8A8175]">Confirm or edit account mapping before posting.</p>
          </div>
          <button onClick={onClose}><X size={16} className="text-[#8A8175]" /></button>
        </div>

        <div className="space-y-3">
          {(items ?? []).map((d) => (
            <div key={d.bankLineId} className="rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-[#1F1B16]">{d.description}</div>
                  <div className="mt-1 text-[12px] text-[#8A8175]">
                    {aed2(d.amount)} · {d.date}{d.reference ? ` · Ref: ${d.reference}` : ""} · {d.reasons[0] || "Manual review"}
                  </div>
                </div>
                <div className={`rounded-full px-2.5 py-1 text-[11px] ${d.confidence === "ready" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {d.confidence}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-[12px] text-[#1F1B16]">
                  Transaction type
                  <select className="mt-1 w-full rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[13px]"
                    value={d.transactionType} onChange={(e) => updateDraft(d.bankLineId, { transactionType: e.target.value as ZohoTransactionType })}>
                    {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <div className="text-[12px] text-[#1F1B16]">
                  From account
                  <div className="mt-1">
                    <AccountCombobox accounts={accounts} value={d.fromAccountId}
                      defaultAccountId={settings.bankAccountId} suggestedAccountId={suggestedIds.get(d.bankLineId)}
                      onChange={(id) => updateDraft(d.bankLineId, { fromAccountId: id })} />
                  </div>
                </div>
                <div className="text-[12px] text-[#1F1B16]">
                  To account
                  <div className="mt-1">
                    <AccountCombobox accounts={accounts} value={d.toAccountId}
                      defaultAccountId={settings.bankAccountId} suggestedAccountId={suggestedIds.get(d.bankLineId)}
                      onChange={(id) => updateDraft(d.bankLineId, { toAccountId: id })} />
                  </div>
                </div>
              </div>

              {(!d.fromAccountId || !d.toAccountId) && (
                <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[#A6472F]"><AlertTriangle size={13} /> Missing account mapping</div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[#D6CCBA] bg-white px-4 py-2 text-[13px] text-[#1F1B16]">Cancel</button>
          <button onClick={confirm} disabled={posting || !canPost}
            className="inline-flex items-center gap-2 rounded-lg bg-[#B08343] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">
            {posting ? <Loader2 size={15} className="animate-spin" /> : null} Confirm & post
          </button>
        </div>
      </div>
    </div>
  );
}