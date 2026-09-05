import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

// DELETE /api/payouts/:id — undoes a wrongly-uploaded payout file (removes
// the payouts row + its payout_transactions, so the bank credit reverts to
// AWAITING_PAYOUT and can be re-uploaded correctly). Refuses if any
// recon_lines row referencing this payout has already been founder-
// confirmed — that settlement may already be posted to Zoho, and deleting
// its payout data out from under it would desync the books with no trace.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: confirmedLines, error: checkErr } = await supabase
    .from("recon_lines")
    .select("bank_line_id")
    .eq("payout_id", id)
    .not("confirmed_by", "is", null);
  if (checkErr) {
    return NextResponse.json({ error: `Could not verify settlement status: ${checkErr.message}` }, { status: 500 });
  }
  if ((confirmedLines ?? []).length > 0) {
    return NextResponse.json(
      { error: "This payout backs a founder-confirmed settlement and can't be deleted. Unconfirm it first if it was confirmed by mistake." },
      { status: 409 },
    );
  }

  try {
    await PayoutsRepository.deletePayout(id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
