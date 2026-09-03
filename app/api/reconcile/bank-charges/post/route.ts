import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { createBooksExpense, type ZohoBooksExpense } from "@/lib/integrations/zoho-expenses";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

export const maxDuration = 120;

type IncomingDraft = {
  bankLineIds: string[];
  reference: string;
  date: string;
  amount: number;
  isInclusiveTax: boolean;
  taxId: string | null;
  categoryAccountId: string;
  paidThroughAccountId: string;
  description: string;
  placeOfSupply: string;
  taxTreatment: string;
};

type Result = {
  bankLineIds: string[];
  status: "posted" | "failed";
  zohoExpenseId?: string;
  error?: string;
};

function validate(d: IncomingDraft): string | null {
  if (!d.bankLineIds?.length) return "bankLineIds required";
  if (!d.amount || d.amount <= 0) return "amount must be > 0";
  if (!/^\d{4}-\d{2}-\d{2}/.test(d.date)) return "date must be YYYY-MM-DD";
  if (!d.categoryAccountId) return "categoryAccountId (Bank Fees & Charges) required";
  if (!d.paidThroughAccountId) return "paidThroughAccountId (bank) required";
  if (d.isInclusiveTax && !d.taxId) return "taxId required when isInclusiveTax=true";
  return null;
}

export async function POST(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const drafts: IncomingDraft[] = Array.isArray(body.drafts) ? body.drafts : [];
  const dryRun = Boolean(body.dryRun);
  const actor = String(body.actor ?? "founder");
  if (drafts.length === 0) return NextResponse.json({ error: "drafts required" }, { status: 400 });


  const accessToken = dryRun ? "" : await getAccessToken();
  const results: Result[] = [];

  for (const draft of drafts) {
    try {
      const err = validate(draft);
      if (err) { results.push({ bankLineIds: draft.bankLineIds, status: "failed", error: err }); continue; }

      // Idempotency: if we've already posted the first line, skip the whole draft.
      // (All sibling lines are marked together on first success, so checking one is enough.)
      const existing = await ZohoBankTxnRepository.getPosting(draft.bankLineIds[0]);
      if (existing?.status === "posted" && existing.zoho_transaction_id) {
        results.push({
          bankLineIds: draft.bankLineIds,
          status: "failed",
          error: `Already posted as Zoho expense ${existing.zoho_transaction_id}`,
        });
        continue;
      }
      const expense: ZohoBooksExpense = {
        account_id: draft.categoryAccountId,
        paid_through_account_id: draft.paidThroughAccountId,
        date: draft.date.slice(0, 10),
        amount: Math.round(draft.amount * 100) / 100,
        is_inclusive_tax: draft.isInclusiveTax,
        tax_treatment: draft.taxTreatment || "vat_registered",
        place_of_supply: draft.placeOfSupply || "DU",
        is_reverse_charge_applied: false,
        reference_number: (draft.reference || `BANKLINE-${draft.bankLineIds.join("-")}`).slice(0, 100),
        description: (draft.reference || `Bank charges · ${draft.reference}`).slice(0, 500),
        ...(draft.isInclusiveTax && draft.taxId ? { tax_id: draft.taxId } : {}),
      };

      if (dryRun) {
        results.push({ bankLineIds: draft.bankLineIds, status: "posted", zohoExpenseId: "DRY-RUN" });
        continue;
      }

      const { expense_id } = await createBooksExpense(expense, accessToken);
      if(!expense_id){
        throw new Error("failed to get expense id ")
      }
      // Mark EVERY source bank line as posted so they can't be double-posted via the
      // main "Post to Zoho" flow, and so the Status column reflects reality.
      for (const bankLineId of draft.bankLineIds) {
        await ZohoBankTxnRepository.recordPosting({
          bank_line_id: bankLineId,
          direction: "debit",
          transaction_type: "expense",
          category_account_id: draft.categoryAccountId,
          reference_number: expense.reference_number ?? "",
          amount: expense.amount,
          zoho_transaction_id: expense_id,
          status: "posted",
          error: "",
          posted_by: actor,
        });
      }

      results.push({ bankLineIds: draft.bankLineIds, status: "posted", zohoExpenseId: expense_id });
    } catch (e) {
      results.push({ bankLineIds: draft.bankLineIds, status: "failed", error: (e as Error).message });
    }
  }

  return NextResponse.json({ dryRun, results });
}