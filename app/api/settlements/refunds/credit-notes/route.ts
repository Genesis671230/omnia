import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { getCreditNoteLive, type LiveCreditNote } from "@/lib/integrations/zoho-settlement-posting";
import { ZohoQuotaExceededError } from "@/lib/integrations/zoho-throttle";
import { refundLinesOf } from "@/lib/finance/publish-refunds";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { RefundPostingsRepository, refundPostingId } from "@/lib/repositories/refund-postings.repository";

export const maxDuration = 60;

// GET /api/settlements/refunds/credit-notes?bankLineId=…
//
// Every refund's credit note as Zoho holds it NOW — total, open balance and
// each refund against it. Two Zoho reads per credit note, only when asked
// (the booking bar's "Re-check invoices", or the refunds panel's refresh).
//
// Our table can be stale: a refund we recorded can be deleted in Zoho
// (803120: stored refund gone, credit note fully open). Such ids are cleared
// here so the refund can be booked again instead of reading "booked" forever.
const isReal = (v: string | null | undefined) => !!v && !/^(PENDING|CLAIMED|CLOSED):/.test(v);

export async function GET(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const bankLineId = new URL(request.url).searchParams.get("bankLineId") ?? "";
  if (!bankLineId) return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
  try {
    const line = (await runReconciliation()).find((l) => l.id === bankLineId);
    if (!line?.payout) return NextResponse.json({ creditNotes: {} });
    const rows = new Map((await RefundPostingsRepository.listByBankLine(bankLineId)).map((r) => [r.id, r]));
    const accessToken = await getAccessToken();

    const out: Record<string, (LiveCreditNote & { staleRefundCleared: boolean }) | { error: string } | null> = {};
    for (const r of refundLinesOf(line)) {
      const row = rows.get(refundPostingId(line.payout.id, r.orderNumber ?? r.ref));
      const cnId = row?.zoho_creditnote_id;
      if (!row || !cnId || !isReal(cnId)) { out[r.ref] = null; continue; }
      try {
        const live = await getCreditNoteLive(cnId, accessToken);
        const ids = new Set(live.refunds.map((x) => x.id));
        let staleRefundCleared = false;
        const patch: Record<string, string | null> = {};
        if (isReal(row.zoho_refund_id) && !ids.has(row.zoho_refund_id!)) {
          patch.zoho_refund_id = null;
          patch.error = `Refund ${row.zoho_refund_id} no longer exists in Zoho (deleted) — credit note ${live.number} has AED ${live.balance.toFixed(2)} open.`;
          staleRefundCleared = true;
        }
        if (row.charge_kind === "cn_refund" && isReal(row.zoho_charge_id) && !ids.has(row.zoho_charge_id!)) {
          patch.zoho_charge_id = null;
          staleRefundCleared = true;
        }
        if (Object.keys(patch).length) await RefundPostingsRepository.update(row.id, patch);
        out[r.ref] = { ...live, staleRefundCleared };
      } catch (e) {
        if (e instanceof ZohoQuotaExceededError) throw e;
        out[r.ref] = { error: (e as Error).message };
      }
    }
    return NextResponse.json({ creditNotes: out, checkedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof ZohoQuotaExceededError ? 429 : 500 });
  }
}
