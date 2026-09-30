import { runInZohoOrgOr400, zohoOrgForBankLine, zohoOrgForSettlement, zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { publishRefunds, refundLineState, refundLinesOf } from "@/lib/finance/publish-refunds";
import { RefundPostingsRepository, refundPostingId } from "@/lib/repositories/refund-postings.repository";

export const maxDuration = 120;

// GET  /api/settlements/refunds?bankLineId=…  → refund lines on the payout + booking state (DB only)
// POST /api/settlements/refunds  { bankLineId, depositAccountId, feeAccountId?, vatTaxId?, inputVatAccountId?, refs?, dryRun? }
//      → credit note for the full refund + refund of it from clearing (closes it),
//        and the gateway's charge on the refund (fee handed back / extra charge)
async function handleGET(request: Request) {
  const bankLineId = new URL(request.url).searchParams.get("bankLineId") ?? "";
  if (!bankLineId) return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line?.payout) return NextResponse.json({ refunds: [] });
  const rows = new Map((await RefundPostingsRepository.listByBankLine(bankLineId)).map((r) => [r.id, r]));
  return NextResponse.json({
    refunds: refundLinesOf(line).map((r) => {
      const row = rows.get(refundPostingId(line.payout!.id, r.orderNumber ?? r.ref));
      const st = refundLineState(r, row);
      return {
        ...r,
        booked: st.booked,
        refundBooked: st.refundDone,
        chargeBooked: st.chargeDone,
        chargeLegacy: st.legacy,
        chargeId: row?.zoho_charge_id ?? null,
        creditNoteId: row?.zoho_creditnote_id ?? null,
        creditNoteReused: row?.creditnote_reused ?? false,
        refundId: row?.zoho_refund_id ?? null,
        error: row?.error ?? null,
      };
    }),
  });
}

async function handlePOST(request: Request) {
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
      feeAccountId: String(body.feeAccountId ?? "") || null,
      vatTaxId: String(body.vatTaxId ?? "") || null,
      inputVatAccountId: String(body.inputVatAccountId ?? "") || null,
      feeRefundAccountId: String(body.feeRefundAccountId ?? "") || null,
      refs: Array.isArray(body.refs) ? body.refs.map(String) : undefined,
      dryRun: body.dryRun === true,
      accessToken: await getAccessToken(),
    });
    return NextResponse.json({ dryRun: body.dryRun === true, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Multi-org: every Zoho call below runs in the organisation of the bankLineId's payout — lib/integrations/zoho-org.ts.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return runInZohoOrgOr400(await zohoOrgForBankLine(new URL(req.url).searchParams.get("bankLineId")), () => (handleGET as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return runInZohoOrgOr400(await zohoOrgForBankLine(String(((await req.clone().json().catch(() => ({}))) as { bankLineId?: unknown }).bankLineId ?? "")), () => (handlePOST as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
}
