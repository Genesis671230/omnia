import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { createBooksExpense, type ZohoBooksExpense } from "@/lib/integrations/zoho-expenses";
import { createBankTransaction, type ZohoPosting } from "@/lib/integrations/zoho-banking";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";
import type { GroupType, TaxTreatment, UAEEmirate } from "@/lib/reconciliation/group-classifier";

export const maxDuration = 120;

type IncomingGroup = {
  groupKey: string;
  mainBankLineId: string;
  reference: string;
  date: string;
  amount: number;
  description: string;
  payee: string;
  groupType: GroupType;
  paidThroughAccountId: string;
  placeOfSupply?: UAEEmirate;
  expenseAccountId?: string;
  taxTreatment?: TaxTreatment;
  taxId?: string;
  isInclusiveTax?: boolean;
  isReverseChargeApplied?: boolean;
  destinationAccountId?: string;
};

type Result = { groupKey: string; status: "posted" | "failed"; zohoId?: string; error?: string };

function validate(d: IncomingGroup): string | null {
  if (!d.mainBankLineId) return "mainBankLineId required";
  if (!d.amount || d.amount <= 0) return "amount must be > 0";
  if (!/^\d{4}-\d{2}-\d{2}/.test(d.date)) return "date must be YYYY-MM-DD";
  if (!d.paidThroughAccountId) return "paidThroughAccountId required";
  switch (d.groupType) {
    case "vendor_expense":
    case "intl_goods_rcm":
      if (!d.expenseAccountId) return "expenseAccountId required";
      if (!d.taxTreatment)     return "taxTreatment required";
      if (!d.placeOfSupply)    return "placeOfSupply required";
      if (d.isInclusiveTax && !d.taxId) return "taxId required when is_inclusive_tax=true";
      return null;
    case "profit_share":
    case "owner_drawing":
    case "inter_account":
      if (!d.destinationAccountId) return "destinationAccountId required";
      return null;
    default:
      return `groupType ${d.groupType} not postable`;
  }
}

async function postExpense(d: IncomingGroup, token: string): Promise<string> {
  const expense: ZohoBooksExpense = {
    account_id: d.expenseAccountId!,
    paid_through_account_id: d.paidThroughAccountId,
    date: d.date.slice(0, 10),
    amount: Math.round(d.amount * 100) / 100,
    tax_treatment: d.taxTreatment,
    place_of_supply: d.placeOfSupply,
    is_reverse_charge_applied: d.isReverseChargeApplied ?? false,
    is_inclusive_tax: d.isInclusiveTax ?? false,
    reference_number: (d.reference || `BANKLINE-${d.mainBankLineId}`).slice(0, 100),
    description: (d.description || `${d.groupType} · ${d.payee}`).slice(0, 500),
    // tax_id only when we actually have one; sending empty makes Zoho think "no tax"
    // which is what we want, but omitting is cleaner and matches the form behavior.
    ...(d.taxId ? { tax_id: d.taxId } : {}),
  };
  const { expense_id } = await createBooksExpense(expense, token);
  return expense_id;
}

async function postBankTransaction(d: IncomingGroup, token: string): Promise<string> {
  const zohoType = d.groupType === "inter_account" ? "transfer_fund" : "owner_drawings";
  const posting: ZohoPosting = {
    transaction_type: zohoType,
    amount: Math.round(d.amount * 100) / 100,
    description: (d.description || `${d.groupType} · ${d.payee}`).slice(0, 500),
    referenceNumber: (d.reference || `BANKLINE-${d.mainBankLineId}`).slice(0, 100),
    from_account_id: d.paidThroughAccountId,
    to_account_id: d.destinationAccountId!,
    payment_mode: "Cash",
    exchange_rate: 1,
    date: d.date.slice(0, 10),
    bank_charges: 0,
  } as ZohoPosting;
  const { transaction_id } = await createBankTransaction(posting, token);
  return transaction_id;
}

export async function POST(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const groups: IncomingGroup[] = Array.isArray(body.groups) ? body.groups : [];
  const dryRun = Boolean(body.dryRun);
  const actor = String(body.actor ?? "founder");
  if (!groups.length) return NextResponse.json({ error: "groups required" }, { status: 400 });

  const token = dryRun ? "" : await getAccessToken();
  const results: Result[] = [];

  for (const group of groups) {
    try {
      const err = validate(group);
      if (err) { results.push({ groupKey: group.groupKey, status: "failed", error: err }); continue; }

      // Idempotent per main line. Fee lines have their own posting rows written by /bank-charges/post.
      const existing = await ZohoBankTxnRepository.getPosting(group.mainBankLineId);
      if (existing?.status === "posted") {
        results.push({ groupKey: group.groupKey, status: "posted", zohoId: existing.zoho_transaction_id ?? undefined });
        continue;
      }

      if (dryRun) {
        results.push({ groupKey: group.groupKey, status: "posted", zohoId: "DRY-RUN" });
        continue;
      }

      const useExpenseApi = group.groupType === "vendor_expense" || group.groupType === "intl_goods_rcm";
      const zohoId = useExpenseApi ? await postExpense(group, token) : await postBankTransaction(group, token);

      await ZohoBankTxnRepository.recordPosting({
        bank_line_id: group.mainBankLineId,
        direction: "debit",
        transaction_type: useExpenseApi
          ? "expense"
          : (group.groupType === "inter_account" ? "transfer_fund" : "owner_drawings"),
        category_account_id: useExpenseApi ? group.expenseAccountId! : group.destinationAccountId!,
        reference_number: group.reference || "",
        amount: Math.round(group.amount * 100) / 100,
        zoho_transaction_id: zohoId,
        status: "posted",
        error: "",
        posted_by: actor,
      });

      results.push({ groupKey: group.groupKey, status: "posted", zohoId });
    } catch (e) {
      results.push({ groupKey: group.groupKey, status: "failed", error: (e as Error).message });
    }
  }

  return NextResponse.json({ dryRun, results });
}