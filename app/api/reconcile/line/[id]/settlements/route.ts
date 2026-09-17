import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";

// GET /api/reconcile/line/[id]/settlements — the settlement_records rows
// for one bank line. Doubles as the "preview" for the Record Payments
// dialog: evidence_confirmed and zoho_payment_id are already real, live
// state, so there's nothing a separate dry-run would show that this
// doesn't already have.
//
// claimedElsewhere: matched orders that have NO record here because another
// payout already holds the order's one settlement record (e.g. a Tamara order
// the Stripe API sync also claimed) — so the UI can say why, not just "missing".
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const settlements = await SettlementsRepository.listByBankLineId(id);

  const { data: line } = await supabase.from("recon_lines").select("resolved_orders").eq("bank_line_id", id).maybeSingle();
  const have = new Set(settlements.map((s) => s.order_number));
  const missing = ((line?.resolved_orders ?? []) as string[]).filter((o) => !have.has(o));
  const claimedElsewhere: Record<string, { payoutId: string | null; gateway: string; bankLineId: string; published: boolean }> = {};
  if (missing.length > 0) {
    const { data: other } = await supabase
      .from("settlement_records")
      .select("order_number, payout_id, gateway, bank_line_id, zoho_payment_id")
      .in("order_number", missing)
      .neq("bank_line_id", id);
    for (const o of other ?? []) {
      claimedElsewhere[o.order_number] = {
        payoutId: o.payout_id, gateway: o.gateway, bankLineId: o.bank_line_id,
        published: !!o.zoho_payment_id && !/^(CLAIMED|PENDING):/.test(o.zoho_payment_id),
      };
    }
  }
  return NextResponse.json({ settlements, claimedElsewhere });
}
