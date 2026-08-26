

import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  createBankTransaction,
  findBankTransactionByReference,
  type ZohoPosting,
} from "@/lib/integrations/zoho-banking";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

export const maxDuration = 120;

type ZohoTransactionType =
  | "deposit"
  | "expense"
  | "transfer_fund"
  | "owner_contribution"
  | "owner_drawings"
  | "interest_income"
  | "other_income";

type DraftPosting = {
  bankLineId: string;
  transactionType: ZohoTransactionType;
  fromAccountId?: string;
  reference?:string;
  toAccountId?: string;
  date:string;
  amount: number;
  description: string;
};

type LineResult = {
  bankLineId: string;
  status: "posted" | "failed";
  error?: string;
  zohoTransactionId?: string;
  posting?: ZohoPosting;
};
function toDateOnly(value: string | undefined | null): string {
  if (!value) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : "";
}

function buildPostingFromDraft(draft: DraftPosting): ZohoPosting {
  const referenceNumber = draft.reference?.trim() || `BANKLINE-${draft.bankLineId}`;
  const date = toDateOnly(draft.date) || new Date().toISOString().slice(0, 10); // fallback should never trigger post-validation

  return {
    transaction_type: draft.transactionType,
    amount: draft.amount,
    description: draft.description,
    referenceNumber,
    from_account_id: draft.fromAccountId ?? "",
    to_account_id: draft.toAccountId ?? "",
    payment_mode: "Cash",
    exchange_rate: 1,
    date,
    bank_charges: 0,
  } as ZohoPosting;
}

function validateDraft(draft: DraftPosting) {
  if (!draft.bankLineId) return "bankLineId is required";
  if (!draft.transactionType) return "transactionType is required";
  if (!draft.amount || draft.amount <= 0) return "amount must be greater than 0";
  if (!draft.description) return "description is required";
  if (!toDateOnly(draft.date)) return "date is required (YYYY-MM  -DD)";

  if (draft.transactionType === "transfer_fund") {
    if (!draft.fromAccountId) return "fromAccountId is required for transfer_fund";
    if (!draft.toAccountId) return "toAccountId is required for transfer_fund";
  }

  if (draft.transactionType === "expense") {
    if (!draft.fromAccountId) return "fromAccountId is required for expense";
    if (!draft.toAccountId) return "toAccountId is required for expense";
  }

  if (draft.transactionType === "deposit") {
    if (!draft.fromAccountId) return "fromAccountId is required for deposit";
    if (!draft.toAccountId) return "toAccountId is required for deposit";
  }

  return null;
}

export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const drafts = Array.isArray(body.drafts) ? body.drafts : [];
  const dryRun = Boolean(body.dryRun);
  const actor = String(body.actor ?? "founder");

  if (drafts.length === 0) {
    return NextResponse.json({ error: "drafts required" }, { status: 400 });
  }

  const accessToken = dryRun ? "" : await getAccessToken();
  const results: LineResult[] = [];

  for (const raw of drafts) {
    try {
      const draft = raw as DraftPosting;

      const validationError = validateDraft(draft);
      if (validationError) {
        results.push({
          bankLineId: draft.bankLineId,
          status: "failed",
          error: validationError,
        });
        continue;
      }

      const posting = buildPostingFromDraft(draft);

      if (dryRun) {
        results.push({
          bankLineId: draft.bankLineId,
          status: "posted",
          posting,
        });
        continue;
      }

      const existingPosting = await ZohoBankTxnRepository.getPosting(draft.bankLineId);
      if (existingPosting && existingPosting.status === "posted") {
        results.push({
          bankLineId: draft.bankLineId,
          status: "posted",
          zohoTransactionId: existingPosting.zoho_transaction_id ?? undefined,
        });
        continue;
      }

      const existing = await findBankTransactionByReference(posting.referenceNumber, accessToken);
      const zohoTransactionId = existing
        ? existing.transaction_id
        : (await createBankTransaction(posting, accessToken)).transaction_id;

      await ZohoBankTxnRepository.recordPosting({
        bank_line_id: draft.bankLineId,
        direction: posting.transaction_type === "deposit" ? "credit" : "debit",
        transaction_type: posting.transaction_type,
        category_account_id: draft.transactionType === "deposit" ? draft.fromAccountId ?? "" : draft.toAccountId ?? "",
        reference_number: posting.referenceNumber,
        amount: posting.amount,
        zoho_transaction_id: zohoTransactionId,
        status: "posted",
        error: "",
        posted_by: actor,
      });

      results.push({
        bankLineId: draft.bankLineId,
        status: "posted",
        zohoTransactionId,
        posting,
      });
    } catch (e) {
      const message = (e as Error).message;
      results.push({
        bankLineId: (raw as DraftPosting).bankLineId ?? "",
        status: "failed",
        error: message,
      });
    }
  }

  return NextResponse.json({ dryRun, results });
}