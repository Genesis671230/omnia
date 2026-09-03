// import { NextResponse } from "next/server";
// import { BankRepository } from "@/lib/repositories/bank.repository";
// import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

// export const maxDuration = 60;

// // GET /api/reconcile/bank-lines?from=&to=
// //
// // Every parsed bank line (credit and debit), independent of gateway-payout
// // reconciliation state — the data source for the Bank Transactions tab.
// // Search/direction/post-status filtering happens client-side (see
// // lib/reconciliation/bank-line-filters.ts); only the date range is
// // server-side, matching the existing /api/reconcile convention.
// export async function GET(request: Request) {
//   const { searchParams } = new URL(request.url);
//   const from = searchParams.get("from") || undefined;
//   const to = searchParams.get("to") || undefined;

//   try {
//     const [lines, postings] = await Promise.all([
//       BankRepository.listAll({ from, to }),
//       ZohoBankTxnRepository.listPostings(),
//     ]);

//     const postingsByLine: Record<string, {verifiedAt:string, status: string; zohoTransactionId: string | null; error: string; postedAt: string,zohoStatus:string }> = {};
//     for (const p of postings) {
//       postingsByLine[p.bank_line_id] = {
//         status: p.status,
//         zohoTransactionId: p.zoho_transaction_id,
//         zohoStatus: p.zoho_status,
//         error: p.error,
//         postedAt: p.posted_at,
//         verifiedAt: p.verified_at,
//       };
//     }

//     return NextResponse.json({
//       lines: lines.map((l) => ({
//         id: l.id,
//         date: l.statement_date,
//         description: l.description,
//         zohoDescription: l.zoho_description,
//         reference: l.reference,
//         amount: l.amount,
//         direction: l.direction,
//         gatewayGuess: l.gateway_guess,
//         confidence: l.confidence,
//         kind: l.kind,
//         batchId: l.batch_id,
//       })),
//       postings: postingsByLine,
//     });
//   } catch (e) {
//     return NextResponse.json({ error: (e as Error).message }, { status: 500 });
//   }
// }

import { NextResponse } from "next/server";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { listZohoBankTransactions } from "@/lib/integrations/zoho-books-banking";

export const maxDuration = 60;

const norm = (s?: string | null) => (s ?? "").trim().toUpperCase();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const accountId = searchParams.get("accountId") || undefined;

  try {
    const lines = await BankRepository.listAll({ from, to });

    const postingsByLine: Record<string, { status: string; zohoTransactionId: string | null; zohoStatus?: string }> = {};

    if (zohoConfigured()) {
      const accessToken = await getAccessToken();
      // same window as `lines` — no mismatch possible
      const zohoTxns = await listZohoBankTransactions({ accountId, dateStart: from, dateEnd: to }, accessToken);
      const byReference = new Map(zohoTxns.filter((t) => t.reference_number).map((t) => [norm(t.reference_number), t]));

      for (const l of lines) {
        const match = byReference.get(norm(l.reference));
        postingsByLine[l.id] = match
          ? { status: "verified", zohoTransactionId: match.transaction_id, zohoStatus: match.status }
          : { status: "missing_in_zoho", zohoTransactionId: null };
      }
    }

    return NextResponse.json({
      lines: lines.map((l) => ({
        id: l.id,
        date: l.statement_date,
        description: l.description,
        zohoDescription: l.zoho_description,
        reference: l.reference,
        amount: l.amount,
        direction: l.direction,
        gatewayGuess: l.gateway_guess,
        confidence: l.confidence,
        kind: l.kind,
        batchId: l.batch_id,
      })),
      postings: postingsByLine,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}