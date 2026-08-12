import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";

// GET /api/reconcile/line/[id]/settlements — the settlement_records rows
// for one bank line. Doubles as the "preview" for the Record Payments
// dialog: evidence_confirmed and zoho_payment_id are already real, live
// state, so there's nothing a separate dry-run would show that this
// doesn't already have.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const settlements = await SettlementsRepository.listByBankLineId(id);
  return NextResponse.json({ settlements });
}
