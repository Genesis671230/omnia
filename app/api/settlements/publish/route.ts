import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { createZohoCustomerPayment, zohoConfigured } from "@/lib/integrations/zoho";

// POST /api/settlements/publish — manual, reviewed batch push to Zoho
// Books. Re-validates evidence_confirmed + not-already-published
// server-side (never trust the UI's filter for a real money-writing action).
export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const settlementIds = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  if (settlementIds.length === 0) {
    return NextResponse.json({ error: "settlementIds is required" }, { status: 400 });
  }

  const settlements = await SettlementsRepository.listByIds(settlementIds);
  const results: { id: string; ok: boolean; error?: string; paymentId?: string }[] = [];

  for (const s of settlements) {
    if (!s.evidence_confirmed) {
      results.push({ id: s.id, ok: false, error: "Not evidence-confirmed" });
      continue;
    }
    if (s.zoho_payment_id) {
      results.push({ id: s.id, ok: false, error: "Already published" });
      continue;
    }
    try {
      const { payment_id } = await createZohoCustomerPayment({
        invoiceReferenceNumber: s.order_number,
        amount: s.gross_aed,
        gateway: s.gateway,
        bankReference: s.bank_reference,
      });
      await SettlementsRepository.markPublished(s.id, payment_id);
      results.push({ id: s.id, ok: true, paymentId: payment_id });
    } catch (e) {
      results.push({ id: s.id, ok: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({ results });
}
