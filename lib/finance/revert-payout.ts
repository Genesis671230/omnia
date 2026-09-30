// Revert a payout that was booked into Zoho from the WRONG file, so the
// correct file can be uploaded and booked fresh.
//
// Real case (Sept 2026): the 24 Sep Tamara KSA credit DSZ26266GMDKFHDK (AED
// 13,353.28, narration "P8498683SA260919") was matched to an uploaded statement
// of a different Tamara merchant account (P7365358SA260919). Nine orders were
// booked from it (payment + fee + FX journal each) before anyone noticed.
//
// Plan (read only): every Zoho document this credit created, re-read from Zoho
//   customer payments (incl. force payments), fee expenses, FX journals,
//   the wire-residual journal (<ref>/WIRE), COD delivery charges (<ref>/DLV),
//   refund charges, credit-note refunds, credit notes WE created,
//   and the clearing → bank transfer (zoho_postings).
// A document is only deleted when its reference carries this credit's bank
// reference (or it is an id we stored for this credit) — never by guesswork.
//
// Execute: delete in dependency order (transfer, journals, expenses, refunds,
// credit notes, payments), clearing each stored id right after its delete
// succeeds, so a re-run resumes instead of repeating. Only when every Zoho
// delete succeeded: remove this credit's settlement/refund/posting rows,
// un-confirm the credit, delete the payout file, log to payout_reverts.

import { supabase } from "@/lib/supabase";
import { markReconDirty } from "@/lib/reconciliation/snapshot";
import {
  deleteCreditNote, deleteCreditNoteRefund, deleteCustomerPayment, deleteExpense, deleteJournal,
  findDocumentByReference, getCreditNoteLive, getCustomerPayment, getExpenseOrJournal,
} from "@/lib/integrations/zoho-settlement-posting";
import { deleteBankTransaction } from "@/lib/integrations/zoho-banking";
import { wireResidualReference } from "@/lib/finance/settlement-posting";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

const real = (id: string | null | undefined): id is string => !!id && !/^(PENDING|CLAIMED|EXTERNAL|CLOSED):/.test(id);
const n2 = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

export type RevertKind =
  | "transfer" | "wire_journal" | "fx_journal" | "fee_expense" | "delivery_expense"
  | "refund_charge" | "creditnote_refund" | "credit_note" | "payment";

export type RevertDoc = {
  kind: RevertKind;
  zohoId: string;
  /** For credit-note refunds: the credit note it belongs to. */
  parentId?: string;
  order?: string;
  amount: number | null;
  reference: string;
  label: string;
  /** Where our stored id lives, cleared after the delete succeeds. */
  source?: { table: "settlement_records" | "refund_postings"; id: string; column: string };
  /** Present in Zoho right now. False = already gone (nothing to delete). */
  exists: boolean;
};

export type RevertPlan = {
  bankLineId: string;
  bankReference: string;
  bankAmount: number;
  bankDate: string | null;
  narration: string;
  payoutId: string;
  payoutSource: string | null;
  confirmed: boolean;
  docs: RevertDoc[];
  localRecords: { settlements: number; refunds: number; postings: number };
  /** Documents we found but will NOT delete, and why. */
  skipped: { label: string; reason: string }[];
  totals: { payments: number; fees: number; journals: number; other: number };
};

const ORDER: RevertKind[] = ["transfer", "wire_journal", "fx_journal", "fee_expense", "delivery_expense", "refund_charge", "creditnote_refund", "credit_note", "payment"];

export async function planPayoutRevert(bankLineId: string, accessToken: string): Promise<RevertPlan> {
  const { data: rl } = await supabase.from("recon_lines").select("payout_id, confirmed_by").eq("bank_line_id", bankLineId).maybeSingle();
  if (!rl?.payout_id) throw new Error("This bank credit has no payout file to revert.");
  const [{ data: bl }, { data: payout }] = await Promise.all([
    supabase.from("bank_lines").select("reference, amount, statement_date, description").eq("id", bankLineId).maybeSingle(),
    supabase.from("payouts").select("id, source").eq("id", rl.payout_id).maybeSingle(),
  ]);
  const ref = String(bl?.reference || bankLineId).trim();
  const carriesRef = (r: string | null | undefined) => String(r ?? "").includes(ref);

  const docs: RevertDoc[] = [];
  const skipped: RevertPlan["skipped"] = [];

  // 1. per-order bookings
  const { data: recs } = await supabase.from("settlement_records").select("*").eq("bank_line_id", bankLineId);
  for (const s of recs ?? []) {
    const o = s.order_number as string;
    for (const [col, kind] of [["zoho_payment_id", "payment"], ["force_payment_id", "payment"]] as const) {
      const id = s[col] as string | null;
      if (!real(id) || docs.some((d) => d.kind === "payment" && d.zohoId === id)) continue;
      const p = await getCustomerPayment(id, accessToken);
      if (p && !carriesRef(p.reference_number)) {
        skipped.push({ label: `Payment ${p.payment_number} for ${o}`, reason: `its reference "${p.reference_number}" is not this credit's (${ref}); left untouched` });
        continue;
      }
      docs.push({
        kind: "payment", zohoId: id, order: o, amount: p ? n2(p.amount) : null, reference: p?.reference_number ?? "",
        label: p ? `Payment ${p.payment_number} · ${o} → ${(p.invoices ?? []).map((i) => i.invoice_number).join(", ")}` : `Payment for ${o} (already deleted)`,
        source: { table: "settlement_records", id: s.id, column: col }, exists: !!p,
      });
    }
    for (const [col, kind, zkind] of [["zoho_fee_expense_id", "fee_expense", "expenses"], ["zoho_fx_journal_id", "fx_journal", "journals"]] as const) {
      const id = s[col] as string | null;
      if (!real(id)) continue;
      const d = await getExpenseOrJournal(zkind, id, accessToken);
      const reference = String(d?.reference_number ?? "");
      if (d && !carriesRef(reference)) { skipped.push({ label: `${kind} for ${o}`, reason: `reference "${reference}" is not this credit's; left untouched` }); continue; }
      docs.push({
        kind, zohoId: id, order: o, amount: d ? n2(d.total ?? d.amount) : null, reference,
        label: `${kind === "fee_expense" ? "Fee expense" : "Exchange journal"} · ${o}${d ? "" : " (already deleted)"}`,
        source: { table: "settlement_records", id: s.id, column: col }, exists: !!d,
      });
    }
  }

  // 2. payout-level documents found by their deterministic references
  for (const [zkind, reference, kind, label] of [
    ["journals", wireResidualReference(ref), "wire_journal", "Bank charge / surplus journal"],
    ["expenses", `${ref}/DLV`.slice(0, 100), "delivery_expense", "COD delivery charges"],
  ] as const) {
    const id = await findDocumentByReference(zkind, reference, accessToken);
    if (!id) continue;
    const d = await getExpenseOrJournal(zkind, id, accessToken);
    docs.push({ kind, zohoId: id, amount: d ? n2(d.total ?? d.amount) : null, reference, label, exists: !!d });
  }

  // 3. refunds booked from this credit
  const { data: refunds } = await supabase.from("refund_postings").select("*").eq("bank_line_id", bankLineId);
  for (const r of refunds ?? []) {
    const o = r.order_number as string;
    if (real(r.zoho_charge_id)) {
      const zkind = r.charge_kind === "expense" ? "expenses" : "journals";
      const d = await getExpenseOrJournal(zkind, r.zoho_charge_id, accessToken);
      docs.push({
        kind: "refund_charge", zohoId: r.zoho_charge_id, order: o, amount: d ? n2(d.total ?? d.amount) : null,
        reference: String(d?.reference_number ?? ""), label: `Refund charge (${zkind === "expenses" ? "expense" : "journal"}) · ${o}`,
        source: { table: "refund_postings", id: r.id, column: "zoho_charge_id" }, exists: !!d,
      });
    }
    if (real(r.zoho_creditnote_id)) {
      let cn: Awaited<ReturnType<typeof getCreditNoteLive>> | null = null;
      try { cn = await getCreditNoteLive(r.zoho_creditnote_id, accessToken); } catch { cn = null; }
      for (const f of cn?.refunds ?? []) {
        if (!carriesRef(f.reference)) continue; // someone else's refund on a reused note
        docs.push({
          kind: "creditnote_refund", zohoId: f.id, parentId: r.zoho_creditnote_id, order: o, amount: n2(f.amount), reference: f.reference,
          label: `Credit note refund · ${cn!.number} · ${o}`, source: { table: "refund_postings", id: r.id, column: "zoho_refund_id" }, exists: true,
        });
      }
      if (cn && !r.creditnote_reused) {
        docs.push({
          kind: "credit_note", zohoId: r.zoho_creditnote_id, order: o, amount: n2(cn.total), reference: "",
          label: `Credit note ${cn.number} (raised by the app for ${o})`, source: { table: "refund_postings", id: r.id, column: "zoho_creditnote_id" }, exists: true,
        });
      }
    }
  }

  // 4. clearing → bank transfer
  const { data: posting } = await supabase.from("zoho_postings").select("zoho_result, status").eq("bank_line_id", bankLineId).maybeSingle();
  for (const t of ((posting?.zoho_result ?? []) as { transactionId?: string; referenceNumber?: string; amount?: number }[])) {
    if (!t.transactionId) continue;
    docs.push({ kind: "transfer", zohoId: t.transactionId, amount: t.amount != null ? n2(t.amount) : null, reference: t.referenceNumber ?? "", label: `Clearing → bank transfer ${t.referenceNumber ?? ""}`, exists: true });
  }

  docs.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const sum = (ks: RevertKind[]) => n2(docs.filter((d) => d.exists && ks.includes(d.kind)).reduce((s, d) => s + (d.amount ?? 0), 0));
  return {
    bankLineId, bankReference: ref, bankAmount: n2(bl?.amount), bankDate: bl?.statement_date ? String(bl.statement_date).slice(0, 10) : null,
    narration: String(bl?.description ?? ""), payoutId: rl.payout_id, payoutSource: payout?.source ?? null, confirmed: !!rl.confirmed_by,
    docs, skipped,
    localRecords: { settlements: (recs ?? []).length, refunds: (refunds ?? []).length, postings: posting ? 1 : 0 },
    totals: { payments: sum(["payment"]), fees: sum(["fee_expense", "delivery_expense", "refund_charge"]), journals: sum(["fx_journal", "wire_journal"]), other: sum(["creditnote_refund", "credit_note", "transfer"]) },
  };
}

export type RevertOutcome = {
  plan: RevertPlan;
  deleted: RevertDoc[];
  failed: { doc: RevertDoc; error: string }[];
  /** True when every Zoho document is gone and the payout file was removed. */
  completed: boolean;
};

export async function executePayoutRevert(opts: { bankLineId: string; actor: string; reason: string; accessToken: string }): Promise<RevertOutcome> {
  const plan = await planPayoutRevert(opts.bankLineId, opts.accessToken);
  const deleted: RevertDoc[] = [];
  const failed: RevertOutcome["failed"] = [];

  for (const d of plan.docs) {
    try {
      if (d.exists) {
        switch (d.kind) {
          case "transfer": await deleteBankTransaction(d.zohoId, opts.accessToken); break;
          case "wire_journal": case "fx_journal": await deleteJournal(d.zohoId, opts.accessToken); break;
          case "fee_expense": case "delivery_expense": await deleteExpense(d.zohoId, opts.accessToken); break;
          case "refund_charge":
            if (d.label.includes("(expense)")) await deleteExpense(d.zohoId, opts.accessToken); else await deleteJournal(d.zohoId, opts.accessToken);
            break;
          case "creditnote_refund": await deleteCreditNoteRefund(d.parentId!, d.zohoId, opts.accessToken); break;
          case "credit_note": await deleteCreditNote(d.zohoId, opts.accessToken); break;
          case "payment": await deleteCustomerPayment(d.zohoId, opts.accessToken); break;
        }
      }
      if (d.source) await supabase.from(d.source.table).update({ [d.source.column]: null }).eq("id", d.source.id);
      deleted.push(d);
    } catch (e) {
      failed.push({ doc: d, error: (e as Error).message });
      // Payments go last and depend on nothing after them; anything else failing
      // means later documents may still reference it — stop here.
      break;
    }
  }

  const completed = failed.length === 0;
  if (completed) {
    await supabase.from("settlement_records").delete().eq("bank_line_id", plan.bankLineId);
    await supabase.from("refund_postings").delete().eq("bank_line_id", plan.bankLineId);
    await supabase.from("zoho_postings").delete().eq("bank_line_id", plan.bankLineId);
    await supabase.from("payout_ref_links").delete().eq("payout_id", plan.payoutId);
    await supabase.from("recon_lines").update({
      confirmed_by: null, confirmed_at: null, force_booked_by: null, force_booked_at: null, force_note: null,
      force_residual_account_id: null, force_residual_account_name: null,
    }).eq("bank_line_id", plan.bankLineId);
    await PayoutsRepository.deletePayout(plan.payoutId);
  }
  await supabase.from("payout_reverts").insert({
    bank_line_id: plan.bankLineId, payout_id: plan.payoutId, payout_source: plan.payoutSource, reason: opts.reason,
    deleted_docs: deleted, failed_docs: failed, reverted_by: opts.actor,
  });
  await markReconDirty(`revert payout ${plan.payoutId}`);
  return { plan, deleted, failed, completed };
}
