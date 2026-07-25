import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { createBankTransaction, findBankTransactionByReference, type ZohoPosting } from "@/lib/integrations/zoho-banking";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";
import type { PostingBatch } from "@/lib/reconciliation/posting-batch-builder";

export const maxDuration = 120;

type BatchResult = {
  batchId: string;
  status: "posted" | "failed";
  error?: string;
  zohoTransactionId?: string;
  bankLineIds: string[];
};

function validateBatch(batch: PostingBatch) {
  if (!batch.fromAccountId) return "fromAccountId is required";
  if (!batch.toAccountId) return "toAccountId is required";
  if (!batch.totalAmount || batch.totalAmount <= 0) return "totalAmount must be greater than 0";
  if (!batch.items.length) return "batch has no items";
  return null;
}

function buildPostingFromBatch(batch: PostingBatch): ZohoPosting {
  return {
    transaction_type: batch.transactionType,
    amount: batch.totalAmount,
    description: `${batch.entity ?? batch.transactionType} · ${batch.count} line(s)`,
    referenceNumber: `BATCH-${batch.id}`,
    from_account_id: batch.fromAccountId ?? "",
    to_account_id: batch.toAccountId ?? "",
    payment_mode: "Cash",
    exchange_rate: 1,
    date: new Date().toISOString().slice(0, 10),
    bank_charges: 0,
  } as ZohoPosting;
}

export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const batches: PostingBatch[] = Array.isArray(body.batches) ? body.batches : [];
  const dryRun = Boolean(body.dryRun);
  const actor = String(body.actor ?? "founder");

  if (batches.length === 0) {
    return NextResponse.json({ error: "batches required" }, { status: 400 });
  }

  const accessToken = dryRun ? "" : await getAccessToken();
  const results: BatchResult[] = [];

  for (const batch of batches) {
    const bankLineIds = batch.items.map((i) => i.bankLineId);
    try {
      const validationError = validateBatch(batch);
      if (validationError) {
        results.push({ batchId: batch.id, status: "failed", error: validationError, bankLineIds });
        continue;
      }

      const posting = buildPostingFromBatch(batch);

      if (dryRun) {
        results.push({ batchId: batch.id, status: "posted", bankLineIds });
        continue;
      }

      const existingPosting = await ZohoBankTxnRepository.getPosting(bankLineIds[0]);
      if (existingPosting?.status === "posted" && existingPosting.reference_number === posting.referenceNumber) {
        results.push({ batchId: batch.id, status: "posted", zohoTransactionId: existingPosting.zoho_transaction_id ?? undefined, bankLineIds });
        continue;
      }

      const existing = await findBankTransactionByReference(posting.referenceNumber, accessToken);
      const zohoTransactionId = existing ? existing.transaction_id : (await createBankTransaction(posting, accessToken)).transaction_id;

      await Promise.all(bankLineIds.map((bankLineId) =>
        ZohoBankTxnRepository.recordPosting({
          bank_line_id: bankLineId,
          direction: posting.transaction_type === "deposit" ? "credit" : "debit",
          transaction_type: posting.transaction_type,
          category_account_id: batch.toAccountId ?? "",
          reference_number: posting.referenceNumber,
          amount: batch.items.find((i) => i.bankLineId === bankLineId)?.amount ?? 0,
          zoho_transaction_id: zohoTransactionId,
          status: "posted",
          error: "",
          posted_by: actor,
        }),
      ));

      results.push({ batchId: batch.id, status: "posted", zohoTransactionId, bankLineIds });
    } catch (e) {
      results.push({ batchId: batch.id, status: "failed", error: (e as Error).message, bankLineIds });
    }
  }

  return NextResponse.json({ dryRun, results });
}