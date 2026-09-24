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
import { BankLineZohoStatusRepository, ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";
import { mergeLineZohoStatus } from "@/lib/reconciliation/bank-line-zoho-status";
import { supabase } from "@/lib/supabase";

/** The payout reconciliation matched to each credit — a DB read, no Zoho call —
 *  so the pre-filled Zoho description can name the payout and its orders. */
async function reconPayouts(ids: string[]) {
  const out = new Map<string, { id: string; gateway: string; orders: string[] }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("recon_lines")
      .select("bank_line_id, payout_id, gateway, resolved_orders")
      .in("bank_line_id", ids.slice(i, i + 200))
      .not("payout_id", "is", null);
    if (error) throw new Error(`recon_lines lookup failed: ${error.message}`);
    for (const r of data ?? []) {
      out.set(r.bank_line_id, { id: r.payout_id, gateway: r.gateway ?? "", orders: (r.resolved_orders as string[] | null) ?? [] });
    }
  }
  return out;
}

export const maxDuration = 60;

// GET /api/reconcile/bank-lines?from=&to=
//
// Never calls Zoho. The Zoho status column comes from bank_line_zoho_status,
// which only the Refresh button (POST ./zoho-status) writes — so an edit made
// in Zoho shows up here on the next Refresh, and opening the tab costs no
// API quota.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  try {
    const lines = await BankRepository.listAll({ from, to });
    const ids = lines.map((l) => l.id);
    const [ledger, postings, payoutByLine] = await Promise.all([
      BankLineZohoStatusRepository.list(ids),
      ZohoBankTxnRepository.listPostingsFor(ids),
      reconPayouts(ids).catch(() => new Map()),
    ]);
    const ledgerById = new Map(ledger.map((r) => [r.bank_line_id, r]));
    const postingById = new Map(postings.map((p) => [p.bank_line_id, p]));

    const postingsByLine: Record<string, ReturnType<typeof mergeLineZohoStatus>> = {};
    let checkedAt: string | null = null;
    for (const l of lines) {
      const led = ledgerById.get(l.id);
      if (led && (!checkedAt || Date.parse(led.checked_at) > Date.parse(checkedAt))) checkedAt = led.checked_at;
      const merged = mergeLineZohoStatus(led, postingById.get(l.id));
      if (merged) postingsByLine[l.id] = merged;
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
        payout: payoutByLine.get(l.id) ?? null,
      })),
      postings: postingsByLine,
      zohoCheckedAt: checkedAt,
      zohoError: null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
