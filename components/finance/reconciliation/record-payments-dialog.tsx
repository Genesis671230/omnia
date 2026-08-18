"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { aed2, type ReconLine } from "./types";
import type { SettlementRecord } from "@/lib/repositories/settlements.repository";
import type { InvoiceStatus } from "@/app/api/reconcile/line/[id]/invoices/route";
/* Record customer payments for every order in a settled, confirmed payout —
 * batch-marks the underlying Zoho invoices paid. Distinct from ReconRow's
 * "Preview & post to Zoho" button, which posts a journal TRANSFER (clearing
 * account -> bank + fee); this posts a CUSTOMER PAYMENT against each order's
 * invoice. Both are real Zoho operations, both are needed, neither implies
 * the other.
 *
 * Renders through a shadcn Dialog, which portals to document.body — outside
 * the .wrap element carrying this workspace's --gold/--ink/--cream custom
 * properties (see zoho-post-dialog.tsx for the original discovery of this
 * trap). Every accent color below is therefore a literal hex Tailwind class,
 * never var(--token).
 */

export type PaymentRowStatus =
  | { status: "ready" }
  | { status: "posted"; paymentId: string }
  | { status: "failed"; error: string; needsManualReview: boolean }
  | { status: "review"; reason: string }
  | { status: "paid_external"; invoiceId: string; invoiceStatus: "paid" | "partially_paid" }
  | { status: "overdue"; invoiceId: string }
  | { status: "not_in_zoho" };

  const map = {
    ready:          { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "ready" },
    posted:         { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "posted" },
    failed:         { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "failed" },
    review:         { cls: "bg-[#FBF0DB] text-[#946E1F]", text: "needs review" },
    paid_external:  { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "already paid" },
    not_in_zoho:    { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "no invoice" },
  } as const;

  
type ZohoAccount = { account_id: string; account_name: string; account_type: string; is_active: boolean };

type PublishResult = { settlementId: string; ok: boolean; error?: string; paymentId?: string; needsManualReview?: boolean };

export function RecordPaymentsBar({
  line,
  onResult,
}: {
  line: ReconLine;
  onResult: (byOrderNumber: Map<string, PaymentRowStatus>) => void;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = !!line.confirmedBy;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!canOpen}
        title={!canOpen ? "A founder must confirm this settlement before invoices can be marked paid" : undefined}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors ${
          canOpen
            ? "border-[#D6CCBA] bg-white text-[#1F1B16] hover:border-[#B08343] hover:text-[#6F5325]"
            : "cursor-not-allowed border-[#EAE3D6] bg-[#F3EFE7] text-[#B8B0A0]"
        }`}
      >
        <BadgeCheck size={12} /> Record payments
      </button>

      {open && <RecordPaymentsDialog line={line} onClose={() => setOpen(false)} onResult={onResult} />}
    </>
  );
}

function RecordPaymentsDialog({
  line,
  onClose,
  onResult,
}: {
  line: ReconLine;
  onClose: () => void;
  onResult: (byOrderNumber: Map<string, PaymentRowStatus>) => void;
}) {
  const [settlements, setSettlements] = useState<SettlementRecord[] | null>(null);
  const [rowStatus, setRowStatus] = useState<Map<string, PaymentRowStatus>>(new Map());
  const [accounts, setAccounts] = useState<ZohoAccount[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [useCustomRef, setUseCustomRef] = useState(false);
  const [customRef, setCustomRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/reconcile/line/${encodeURIComponent(line.id)}/settlements`).then(r => r.json()),
      fetch("/api/integrations/zoho/account-config").then(r => r.json()),
      fetch(`/api/reconcile/line/${encodeURIComponent(line.id)}/invoices`).then(r => r.json()),
    ])
      .then(([settlementsJson, configJson, invoicesJson]) => {
        if (!alive) return;
        const rows: SettlementRecord[] = settlementsJson.settlements ?? [];
        console.log(invoicesJson,"we have all invoices")
        const statuses: Record<string, InvoiceStatus> = invoicesJson.statuses ?? {};
        setSettlements(rows);
    
        // Status comes ONLY from Zoho — has the invoice got a recorded
        // payment against it or not? Local zoho_payment_id is not consulted;
        // if we posted it last time, Zoho reflects that now and this returns
        // paid_external. If someone manually paid it in Zoho, same thing.
        setRowStatus(new Map(rows.map((s) => {
          const iv = statuses[s.order_number];
          if (iv?.status === "paid" || iv?.status === "partially_paid") {
            return [s.order_number, { status: "paid_external", invoiceId: iv.invoiceId, invoiceStatus: iv.status }];
          }
          if (iv?.status === "overdue") {
            return [s.order_number, { status: "overdue", invoiceId: iv.invoiceId }];
          }
          return [s.order_number, { status: "ready" as const }];
        })));
    
        setAccounts(configJson.bankAccounts ?? []);
        const def = configJson.effective?.bankAccountId ?? "";
        setDefaultAccountId(def);
        setAccountId(def);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [line.id]);

  const postable = (settlements ?? []).filter((s) => {
    const st = rowStatus.get(s.order_number)?.status;
    return st === "ready" || st === "overdue";
  });
  const modeSummary = (() => {
    const cod = postable.filter((s) => s.gateway.toUpperCase() === "COD").length;
    const card = postable.length - cod;
    const parts: string[] = [];
    if (card > 0) parts.push(`Credit Card × ${card}`);
    if (cod > 0) parts.push(`Cash on Delivery × ${cod}`);
    return parts.join(", ");
  })();

  const submit = async () => {
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/settlements/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankLineId: line.id,
          accountId: accountId || undefined,
          referenceNumberOverride: useCustomRef && customRef.trim() ? customRef.trim() : undefined,
        }),
      });
      const json = (await res.json()) as { results?: PublishResult[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const orderNumberBySettlementId = new Map((settlements ?? []).map((s) => [s.id, s.order_number]));
      const next = new Map(rowStatus);
      for (const r of json.results ?? []) {
        const orderNumber = orderNumberBySettlementId.get(r.settlementId);
        if (!orderNumber) continue;
        if (!r.ok && r.error === "Already published" && next.get(orderNumber)?.status === "posted") {
          // Harmless, expected result of resubmitting a partially-posted
          // payout — don't clobber a row that already shows "posted".
          continue;
        }
        next.set(
          orderNumber,
          r.ok
            ? { status: "posted", paymentId: r.paymentId! }
            : { status: "failed", error: r.error ?? "Unknown error", needsManualReview: !!r.needsManualReview },
        );
      }
      setRowStatus(next);
      onResult(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto bg-white text-[#1F1B16]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[20px] text-[#1F1B16]">Record payments</DialogTitle>
          <DialogDescription className="text-[#8A8175]">
            {line.provider} · {line.payout?.id ?? line.reference} · bank credit {line.date?.slice(0, 10) ?? "—"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-[#8A8175]">
            <Loader2 size={15} className="animate-spin" /> Loading the orders in this payout…
          </div>
        ) : error && !settlements ? (
          <div className="flex items-start gap-2 rounded-xl bg-[#F9ECE7] px-4 py-3 text-[13px] leading-relaxed text-[#A6472F]">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        ) : (
          <>
            <div className="space-y-1.5 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3">
              {(settlements ?? []).map((s) => {
                const st = rowStatus.get(s.order_number) ?? ({ status: "ready" } as const);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[#1F1B16]">#{s.order_number}</span>
                      <span className="truncate text-[#8A8175]">{s.customer_name}</span>
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      <span className="font-mono tabular-nums text-[#1F1B16]">{aed2(s.gross_aed)}</span>
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={st.status}
                          initial={{ opacity: 0, y: -2 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <PaymentRowPill s={st} />
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  </div>
                );
              })}
              {(settlements ?? []).length === 0 && (
                <p className="px-1 py-2 text-[12.5px] text-[#8A8175]">No settlement records for this payout yet.</p>
              )}
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#1F1B16]">Deposit account</label>
                {accounts.length === 0 ? (
                  <p className="rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
                    No deposit account configured — set one in Zoho Settings before recording payments.
                  </p>
                ) : (
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="w-full border-[#D6CCBA] text-[13px]">
                      <SelectValue placeholder="Select an account…" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.account_id} value={a.account_id}>
                          {a.account_name}
                          {a.account_id === defaultAccountId ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <p className="text-[12.5px] text-[#8A8175]">
                Payment mode: <b className="text-[#1F1B16]">{modeSummary || "—"}</b>
              </p>

              <div>
                <label className="flex items-center gap-2 text-[12.5px] text-[#1F1B16]">
                  <Checkbox checked={useCustomRef} onCheckedChange={(v) => setUseCustomRef(v === true)} />
                  Use a custom reference number instead of the bank reference
                </label>
                <AnimatePresence>
                  {useCustomRef && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <Input
                        value={customRef}
                        onChange={(e) => setCustomRef(e.target.value)}
                        placeholder="e.g. Batch 42"
                        className="mt-1.5 border-[#D6CCBA] text-[13px]"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}

            <DialogFooter className="mt-4">
              <button
                onClick={onClose}
                className="rounded-lg border border-[#D6CCBA] bg-white px-4 py-2 text-[13px] font-medium text-[#1F1B16] hover:border-[#B08343]"
              >
                Close
              </button>
              <button
                onClick={submit}
                disabled={posting || postable.length === 0 || accounts.length === 0 || !accountId}
                className="inline-flex items-center gap-2 rounded-lg bg-[#6F5325] px-4 py-2 text-[13px] font-medium text-[#FBF8F1] hover:bg-[#5A4320] disabled:cursor-not-allowed disabled:bg-[#B8B0A0]"
              >
                {posting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Record {postable.length} payment{postable.length === 1 ? "" : "s"}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PaymentRowPill({ s }: { s: PaymentRowStatus }) {
  const map = {
    ready:          { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "unpaid" },       // was "ready" — meaningless on main panel
    posted:         { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "posted" },
    failed:         { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "failed" },
    review:         { cls: "bg-[#FBF0DB] text-[#946E1F]", text: "needs review" },
    paid_external:  { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "paid" },         // green — Zoho says paid, not by us
    overdue:        { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "overdue" },      // red — past due date
    not_in_zoho:    { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "no invoice" },   // red — sync problem
  } as const;


  const cfg = map[s.status];
    const title =
      s.status === "posted"        ? `payment ${s.paymentId}` :
      s.status === "failed"        ? s.error :
      s.status === "review"        ? s.reason :
      s.status === "paid_external" ? `Zoho invoice ${s.invoiceId} — ${s.invoiceStatus}` :
      s.status === "overdue"       ? `Zoho invoice ${s.invoiceId} — past due` :
      s.status === "not_in_zoho"   ? "No matching Zoho invoice — run a sync" :
      undefined;

  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cfg.cls}`}>
      {s.status === "posted" && <ExternalLink size={9} />}
      {cfg.text}
    </span>
  );
}
