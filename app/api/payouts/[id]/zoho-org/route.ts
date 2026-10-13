import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getZohoConnection } from "@/lib/integrations/zoho-org";
import { ENV_CONNECTION_ID } from "@/lib/integrations/zoho-context";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { markReconDirty } from "@/lib/reconciliation/snapshot";
import { BOOKED_ID_COLUMNS, isBookedInZoho } from "@/lib/finance/payout-booked";

export const dynamic = "force-dynamic";

// GET /api/payouts/:id/zoho-org
//   → { zohoConnectionId, booked }   which books this payout closes invoices in
// PUT /api/payouts/:id/zoho-org  { zohoConnectionId }   ("env" / "" = main)
//   Refused (409) once anything on it is in Zoho (an order's payment / fee /
//   FX, or a delivery-charge document): moving a booked payout would let the
//   same money be booked again in the other org.

type Ctx = { params: Promise<{ id: string }> };

async function state(id: string) {
  const [{ data: p, error: pErr }, { data: rows, error: sErr }] = await Promise.all([
    supabase.from("payouts").select("zoho_connection_id, delivery_postings").eq("id", id).maybeSingle(),
    supabase.from("settlement_records").select(BOOKED_ID_COLUMNS.join(", ")).eq("payout_id", id),
  ]);
  if (pErr) throw new Error(`payouts read failed: ${pErr.message}`);
  if (sErr) throw new Error(`settlement_records read failed: ${sErr.message}`);
  const bookedOrders = ((rows ?? []) as unknown as Record<string, string | null>[]).filter(isBookedInZoho).length;
  const deliveryDocs = ((p?.delivery_postings ?? []) as unknown[]).length;
  const bookedCount = bookedOrders + deliveryDocs;
  // Orders that close in a different org than the payout (picked per order,
  // or pinned when booked before a switch).
  const { data: own } = await supabase.from("settlement_records").select("id, zoho_connection_id").eq("payout_id", id).not("zoho_connection_id", "is", null);
  const payoutOrg = (p?.zoho_connection_id as string) || ENV_CONNECTION_ID;
  const ordersInOtherOrgs = (own ?? []).filter((r) => r.zoho_connection_id && r.zoho_connection_id !== payoutOrg).length;
  return {
    exists: !!p,
    zohoConnectionId: payoutOrg,
    booked: bookedCount > 0,
    bookedCount,
    bookedOrders,
    deliveryDocs,
    // Only delivery documents still lock the payout-level switch.
    locked: deliveryDocs > 0,
    ordersInOtherOrgs,
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = await state(id);
  if (!s.exists) return NextResponse.json({ error: `No payout ${id}` }, { status: 404 });
  return NextResponse.json(s);
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { zohoConnectionId?: string };
  const target = String(body.zohoConnectionId ?? "").trim() || ENV_CONNECTION_ID;
  const conn = await getZohoConnection(target);
  if (!conn) return NextResponse.json({ error: `Unknown Zoho organisation "${target}"` }, { status: 400 });
  if (conn.status === "disabled") return NextResponse.json({ error: `${conn.label} is disabled` }, { status: 400 });

  const s = await state(id);
  if (!s.exists) return NextResponse.json({ error: `No payout ${id}` }, { status: 404 });
  if (s.zohoConnectionId === conn.id) return NextResponse.json({ ...s, changed: false });
  // The payout-level delivery documents (COD voucher charges) live in the
  // payout's books and can't follow a switch.
  if (s.deliveryDocs) {
    return NextResponse.json({ error: `${s.deliveryDocs} delivery-charge document(s) on this payout are already in Zoho — it stays in its current books. Pick a different organisation per order instead.` }, { status: 409 });
  }
  // Orders already in Zoho stay where they were booked: pin them to the
  // current org before the payout moves, so nothing is booked twice.
  if (s.bookedOrders) {
    const { data: rows, error } = await supabase.from("settlement_records").select(["id", "zoho_connection_id", ...BOOKED_ID_COLUMNS].join(", ")).eq("payout_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const pin = ((rows ?? []) as unknown as Record<string, string | null>[]).filter((r) => isBookedInZoho(r) && !r.zoho_connection_id).map((r) => r.id as string);
    if (pin.length) {
      const { error: pErr } = await supabase.from("settlement_records").update({ zoho_connection_id: s.zohoConnectionId }).in("id", pin);
      if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    }
  }
  await PayoutsRepository.setZohoConnection([id], conn.id === ENV_CONNECTION_ID ? "" : conn.id);
  // Orders explicitly picked into the new org now simply follow the payout.
  await supabase.from("settlement_records").update({ zoho_connection_id: null }).eq("payout_id", id).eq("zoho_connection_id", conn.id);
  await markReconDirty(`payout-org:${id}`);
  return NextResponse.json({ ...(await state(id)), changed: true });
}
