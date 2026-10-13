import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getZohoConnection } from "@/lib/integrations/zoho-org";
import { ENV_CONNECTION_ID } from "@/lib/integrations/zoho-context";
import { BOOKED_ID_COLUMNS, isBookedInZoho } from "@/lib/finance/payout-booked";
import { markReconDirty } from "@/lib/reconciliation/snapshot";

export const dynamic = "force-dynamic";

// PUT /api/settlements/:id/zoho-org  { zohoConnectionId }
//   Which Zoho organisation THIS order's invoice closes in — for payouts that
//   carry orders of two companies (House of Omnia + Omniastores). "" = follow
//   the payout. Refused (409) once the order itself is in Zoho: moving it
//   would let the same money be booked again in the other org.

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { zohoConnectionId?: string };
  const target = String(body.zohoConnectionId ?? "").trim();

  const { data: row, error } = await supabase.from("settlement_records")
    .select(["id", "order_number", "payout_id", "zoho_connection_id", ...BOOKED_ID_COLUMNS].join(", ")).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: `No settlement ${id}` }, { status: 404 });
  const r = row as unknown as Record<string, string | null>;
  if (isBookedInZoho(r)) {
    return NextResponse.json({ error: `${r.order_number} is already booked in Zoho — it stays in its current books.` }, { status: 409 });
  }

  let value: string | null = null;
  if (target) {
    const conn = await getZohoConnection(target);
    if (!conn) return NextResponse.json({ error: `Unknown Zoho organisation "${target}"` }, { status: 400 });
    if (conn.status === "disabled") return NextResponse.json({ error: `${conn.label} is disabled` }, { status: 400 });
    // Same as the payout's → store nothing, so it keeps following the payout.
    const { data: p } = r.payout_id ? await supabase.from("payouts").select("zoho_connection_id").eq("id", r.payout_id).maybeSingle() : { data: null };
    const payoutOrg = (p?.zoho_connection_id as string | undefined) || ENV_CONNECTION_ID;
    value = conn.id === payoutOrg ? null : conn.id;
  }
  const { error: uErr } = await supabase.from("settlement_records").update({ zoho_connection_id: value }).eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  await markReconDirty(`settlement-org:${id}`);
  return NextResponse.json({ id, zohoConnectionId: value });
}
