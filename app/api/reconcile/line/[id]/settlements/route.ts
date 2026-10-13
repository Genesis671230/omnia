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
  // Split payments: the same orders paid (partly) through ANOTHER payout —
  // e.g. Tabby paid the order, a Stripe top-up paid the exchange difference.
  // One settlement record per order per payout, so each shows the other.
  const orders = [...new Set([...settlements.map((s) => s.order_number), ...((line?.resolved_orders ?? []) as string[])])];
  const otherGateways: Record<string, { gateway: string; payoutId: string; grossAed: number | null; booked: boolean }[]> = {};
  if (orders.length > 0) {
    const thisPayouts = new Set(settlements.map((s) => s.payout_id).filter(Boolean));
    const { data: others } = await supabase.from("settlement_records")
      .select("order_number, payout_id, gateway, bank_line_id, zoho_payment_id, force_payment_id")
      .in("order_number", orders).neq("bank_line_id", id);
    const rows = (others ?? []).filter((o) => o.payout_id && !thisPayouts.has(o.payout_id));
    const { data: tx } = rows.length
      ? await supabase.from("payout_transactions").select("payout_id, order_ref, gross_aed, is_refund")
          .in("payout_id", [...new Set(rows.map((r) => r.payout_id as string))]).in("order_ref", orders)
      : { data: [] as { payout_id: string; order_ref: string; gross_aed: number; is_refund: boolean }[] };
    for (const o of rows) {
      const gross = (tx ?? []).filter((t) => t.payout_id === o.payout_id && t.order_ref === o.order_number && !t.is_refund)
        .reduce((sum, t) => sum + Number(t.gross_aed || 0), 0);
      const isBooked = (v: string | null) => !!v && !/^(CLAIMED|PENDING):/.test(v);
      (otherGateways[o.order_number] ??= []).push({
        gateway: o.gateway, payoutId: o.payout_id as string, grossAed: gross ? Math.round(gross * 100) / 100 : null,
        booked: isBooked(o.zoho_payment_id) || isBooked(o.force_payment_id),
      });
    }
  }
  return NextResponse.json({ settlements, claimedElsewhere, otherGateways });
}
