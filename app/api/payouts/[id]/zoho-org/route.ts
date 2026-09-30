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
  return {
    exists: !!p,
    zohoConnectionId: (p?.zoho_connection_id as string) || ENV_CONNECTION_ID,
    booked: bookedCount > 0,
    bookedCount,
    bookedOrders,
    deliveryDocs,
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
  if (s.booked) {
    const what = [s.bookedOrders && `${s.bookedOrders} order(s)`, s.deliveryDocs && `${s.deliveryDocs} delivery-charge document(s)`].filter(Boolean).join(" and ");
    return NextResponse.json({ error: `${what} on this payout are already in Zoho — it stays in its current books.` }, { status: 409 });
  }
  await PayoutsRepository.setZohoConnection([id], conn.id === ENV_CONNECTION_ID ? "" : conn.id);
  await markReconDirty(`payout-org:${id}`);
  return NextResponse.json({ ...(await state(id)), changed: true });
}
