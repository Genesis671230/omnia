import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { publishRefunds, refundLinesOf } from "@/lib/finance/publish-refunds";
import { RefundPostingsRepository, refundPostingId } from "@/lib/repositories/refund-postings.repository";

export const maxDuration = 120;

// GET  /api/settlements/refunds?bankLineId=…  → refund lines on the payout + booking state (DB only)
// POST /api/settlements/refunds  { bankLineId, depositAccountId, refs?, dryRun? }
//      → credit note against the order's invoice + refund from the clearing account
export async function GET(request: Request) {
  const bankLineId = new URL(request.url).searchParams.get("bankLineId") ?? "";
  if (!bankLineId) return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line?.payout) return NextResponse.json({ refunds: [] });
  const rows = new Map((await RefundPostingsRepository.listByBankLine(bankLineId)).map((r) => [r.id, r]));
  return NextResponse.json({
    refunds: refundLinesOf(line).map((r) => {
      const row = r.orderNumber ? rows.get(refundPostingId(line.payout!.id, r.orderNumber)) : undefined;
      return {
        ...r,
        booked: !!row?.zoho_refund_id && !row.zoho_refund_id.startsWith("PENDING:"),
        creditNoteId: row?.zoho_creditnote_id ?? null,
        creditNoteReused: row?.creditnote_reused ?? false,
        refundId: row?.zoho_refund_id ?? null,
        error: row?.error ?? null,
      };
    }),
  });
}

export async function POST(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const bankLineId = String(body.bankLineId ?? "");
  const depositAccountId = String(body.depositAccountId ?? "");
  if (!bankLineId) return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });

  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line) return NextResponse.json({ error: `No reconciliation line ${bankLineId}` }, { status: 404 });
  if (!line.confirmedBy) return NextResponse.json({ error: "Confirm this settlement before booking its refunds." }, { status: 409 });
  if (!line.payout) return NextResponse.json({ error: "This bank credit has no matched payout file." }, { status: 409 });

  try {
    const results = await publishRefunds({
      line,
      depositAccountId,
      refs: Array.isArray(body.refs) ? body.refs.map(String) : undefined,
      dryRun: body.dryRun === true,
      accessToken: await getAccessToken(),
    });
    return NextResponse.json({ dryRun: body.dryRun === true, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
