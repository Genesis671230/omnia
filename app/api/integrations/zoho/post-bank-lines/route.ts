// import { NextResponse } from "next/server";
// import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
// import {
//   accountMapFromEnvPartial,
//   buildBankLinePosting,
//   createBankTransaction,
//   findBankTransactionByReference,
//   mergeAccountMaps,
//   type ZohoPosting,
// } from "@/lib/integrations/zoho-banking";
// import { BankRepository } from "@/lib/repositories/bank.repository";
// import { ZohoConfigRepository } from "@/lib/repositories/zoho-config.repository";
// import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

// export const maxDuration = 120;

// type LineResult = {
//   bankLineId: string;
//   status: "posted" | "failed";
//   error?: string;
//   zohoTransactionId?: string;
//   posting?: ZohoPosting;
// };

// // POST /api/integrations/zoho/post-bank-lines
// //   body: { bankLineIds: string[], dryRun?: boolean, actor?: string }
// //
// // Posts each selected bank_lines row as its own categorized Zoho Bank
// // Transaction (deposit for a credit, expense for a debit) — independent of
// // the gateway-payout clearing-account flow. Each line is posted and recorded
// // on its own: unlike a payout's net+fee pair, these are unrelated ledger
// // lines, so one line's failure never blocks the rest of the batch.
// export async function POST(request: Request) {
//   if (!zohoConfigured()) {
//     return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
//   }

//   const body = await request.json().catch(() => ({}));
//   const bankLineIds = Array.isArray(body.bankLineIds) ? body.bankLineIds.map(String) : [];
//   const dryRun = Boolean(body.dryRun);
//   const actor = String(body.actor ?? "founder");
//   if (bankLineIds.length === 0) {
//     return NextResponse.json({ error: "bankLineIds required" }, { status: 400 });
//   }

//   const lines = await BankRepository.getByIds(bankLineIds);
//   const accounts = mergeAccountMaps(accountMapFromEnvPartial(), await ZohoConfigRepository.getAccountMap());
//   const accessToken = dryRun ? "" : await getAccessToken();

//   const results: LineResult[] = [];

//   for (const line of lines) {
//     try {
//       // Local record first: cheaper than a Zoho round trip, and it lets a
//       // re-click after a partial batch failure skip everything that already
//       // succeeded instead of re-checking each one against Zoho. Mirrors the
//       // fast-path check in /api/integrations/zoho/post-payout.
//       if (!dryRun) {
//         const existingPosting = await ZohoBankTxnRepository.getPosting(line.id);
//         if (existingPosting && existingPosting.status === "posted") {
//           results.push({
//             bankLineId: line.id,
//             status: "posted",
//             zohoTransactionId: existingPosting.zoho_transaction_id ?? undefined,
//           });
//           continue;
//         }
//       }

//           console.log(  {
//             bankLineId: line.id,
//             direction: line.direction,
//             amount: line.amount,
//             date: (line.statement_date ?? new Date().toISOString()).slice(0, 10),
//             kind: line.kind,
//             description: line.zoho_description || line.description,
//           },
//           accounts,"thi is what we want")
//       const posting = buildBankLinePosting(
//         {
//           bankLineId: line.id,
//           direction: line.direction,
//           amount: line.amount,
//           date: (line.statement_date ?? new Date().toISOString()).slice(0, 10),
//           kind: line.kind,
//           description: line.zoho_description || line.description,
//         },
//         accounts,
//       );

//       if (dryRun) {
//         results.push({ bankLineId: line.id, status: "posted", posting });
//         continue;
//       }

//       const existing = await findBankTransactionByReference(posting.referenceNumber, accessToken);
//       const zohoTransactionId = existing
//         ? existing.transaction_id
//         : (await createBankTransaction(posting, accessToken)).transaction_id;

//       await ZohoBankTxnRepository.recordPosting({
//         bank_line_id: line.id,
//         direction: line.direction,
//         transaction_type: posting.transaction_type,
//         category_account_id: line.direction === "credit" ? posting.from_account_id : posting.to_account_id,
//         reference_number: posting.referenceNumber,
//         amount: posting.amount,
//         zoho_transaction_id: zohoTransactionId,
//         status: "posted",
//         error: "",
//         posted_by: actor,
//       });

//       results.push({ bankLineId: line.id, status: "posted", zohoTransactionId, posting });
//     } catch (e) {
//       const message = (e as Error).message;
//       if (!dryRun) {
//         await ZohoBankTxnRepository.recordPosting({
//           bank_line_id: line.id,
//           direction: line.direction,
//           transaction_type: "",
//           category_account_id: "",
//           reference_number: "",
//           amount: line.amount,
//           zoho_transaction_id: null,
//           status: "failed",
//           error: message,
//           posted_by: actor,
//         }).catch(() => {});
//       }
//       results.push({ bankLineId: line.id, status: "failed", error: message });
//     }
//   }

//   return NextResponse.json({ dryRun, results });
// }



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