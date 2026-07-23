import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  accountMapFromEnvPartial,
  buildBankLinePosting,
  createBankTransaction,
  findBankTransactionByReference,
  mergeAccountMaps,
  type ZohoPosting,
} from "@/lib/integrations/zoho-banking";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { ZohoConfigRepository } from "@/lib/repositories/zoho-config.repository";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

export const maxDuration = 120;

type LineResult = {
  bankLineId: string;
  status: "posted" | "failed";
  error?: string;
  zohoTransactionId?: string;
  posting?: ZohoPosting;
};

// POST /api/integrations/zoho/post-bank-lines
//   body: { bankLineIds: string[], dryRun?: boolean, actor?: string }
//
// Posts each selected bank_lines row as its own categorized Zoho Bank
// Transaction (deposit for a credit, expense for a debit) — independent of
// the gateway-payout clearing-account flow. Each line is posted and recorded
// on its own: unlike a payout's net+fee pair, these are unrelated ledger
// lines, so one line's failure never blocks the rest of the batch.
export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const bankLineIds = Array.isArray(body.bankLineIds) ? body.bankLineIds.map(String) : [];
  const dryRun = Boolean(body.dryRun);
  const actor = String(body.actor ?? "founder");
  if (bankLineIds.length === 0) {
    return NextResponse.json({ error: "bankLineIds required" }, { status: 400 });
  }

  const lines = await BankRepository.getByIds(bankLineIds);
  const accounts = mergeAccountMaps(accountMapFromEnvPartial(), await ZohoConfigRepository.getAccountMap());
  const accessToken = dryRun ? "" : await getAccessToken();

  const results: LineResult[] = [];

  for (const line of lines) {
    try {
      // Local record first: cheaper than a Zoho round trip, and it lets a
      // re-click after a partial batch failure skip everything that already
      // succeeded instead of re-checking each one against Zoho. Mirrors the
      // fast-path check in /api/integrations/zoho/post-payout.
      if (!dryRun) {
        const existingPosting = await ZohoBankTxnRepository.getPosting(line.id);
        if (existingPosting && existingPosting.status === "posted") {
          results.push({
            bankLineId: line.id,
            status: "posted",
            zohoTransactionId: existingPosting.zoho_transaction_id ?? undefined,
          });
          continue;
        }
      }

      const posting = buildBankLinePosting(
        {
          bankLineId: line.id,
          direction: line.direction,
          amount: line.amount,
          date: (line.statement_date ?? new Date().toISOString()).slice(0, 10),
          kind: line.kind,
          description: line.zoho_description || line.description,
        },
        accounts,
      );

      if (dryRun) {
        results.push({ bankLineId: line.id, status: "posted", posting });
        continue;
      }

      const existing = await findBankTransactionByReference(posting.referenceNumber, accessToken);
      const zohoTransactionId = existing
        ? existing.transaction_id
        : (await createBankTransaction(posting, accessToken)).transaction_id;

      await ZohoBankTxnRepository.recordPosting({
        bank_line_id: line.id,
        direction: line.direction,
        transaction_type: posting.transaction_type,
        category_account_id: line.direction === "credit" ? posting.from_account_id : posting.to_account_id,
        reference_number: posting.referenceNumber,
        amount: posting.amount,
        zoho_transaction_id: zohoTransactionId,
        status: "posted",
        error: "",
        posted_by: actor,
      });

      results.push({ bankLineId: line.id, status: "posted", zohoTransactionId, posting });
    } catch (e) {
      const message = (e as Error).message;
      if (!dryRun) {
        await ZohoBankTxnRepository.recordPosting({
          bank_line_id: line.id,
          direction: line.direction,
          transaction_type: "",
          category_account_id: "",
          reference_number: "",
          amount: line.amount,
          zoho_transaction_id: null,
          status: "failed",
          error: message,
          posted_by: actor,
        }).catch(() => {});
      }
      results.push({ bankLineId: line.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({ dryRun, results });
}
