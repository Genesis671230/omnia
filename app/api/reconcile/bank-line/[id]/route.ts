import { NextResponse } from "next/server";
import { BankRepository } from "@/lib/repositories/bank.repository";

// PATCH /api/reconcile/bank-line/:id — body: { zohoDescription: string }
//
// The only per-line override this feature allows: what description reaches
// Zoho, without touching the original parsed bank narration (`description`),
// which other reconciliation UI and dedupe/matching logic depend on.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (typeof body.zohoDescription !== "string") {
    return NextResponse.json({ error: "zohoDescription must be a string" }, { status: 400 });
  }
  const zohoDescription = body.zohoDescription;

  try {
    await BankRepository.updateZohoDescription(id, zohoDescription);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
