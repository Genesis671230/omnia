import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { loadDeliveryEntities, saveDeliveryEntityOverrides, type DeliveryPosting } from "@/lib/finance/delivery-entities.server";

export const dynamic = "force-dynamic";

// GET /api/payouts/:id/delivery-entities
//   → { voucherOrg, prepaidOrg, charges: [{ key, ref, amount, entity, reason, why, … }],
//       groups, orgs, postings }
//   Which company each courier delivery charge on a COD voucher belongs to.
// PUT /api/payouts/:id/delivery-entities  { overrides: { "<key>": "<org>" | null } }
//   Pick a company by hand (null = back to automatic). Refused (409) for a
//   charge already in a Zoho document — moving it would book it twice.

type Ctx = { params: Promise<{ id: string }> };

async function postingsOf(id: string): Promise<DeliveryPosting[]> {
  const { data, error } = await supabase.from("payouts").select("delivery_postings").eq("id", id).maybeSingle();
  if (error) throw new Error(`payouts read failed: ${error.message}`);
  return (data?.delivery_postings ?? []) as DeliveryPosting[];
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const state = await loadDeliveryEntities(id);
    if (!state) return NextResponse.json({ error: `No payout ${id}` }, { status: 404 });
    return NextResponse.json({ ...state, postings: await postingsOf(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { overrides?: Record<string, unknown> };
  if (!body.overrides || typeof body.overrides !== "object") {
    return NextResponse.json({ error: "overrides is required" }, { status: 400 });
  }
  try {
    const state = await loadDeliveryEntities(id);
    if (!state) return NextResponse.json({ error: `No payout ${id}` }, { status: 404 });

    const byKey = new Map(state.charges.map((c) => [c.key, c]));
    const orgs = new Set(state.orgs.map((o) => o.id));
    const postings = await postingsOf(id);
    const patch: Record<string, string | null> = {};
    for (const [key, raw] of Object.entries(body.overrides)) {
      const charge = byKey.get(key);
      if (!charge) return NextResponse.json({ error: `No delivery charge ${key} on ${id}` }, { status: 400 });
      const org = typeof raw === "string" && raw.trim() ? raw.trim() : null;
      if (org && !orgs.has(org)) return NextResponse.json({ error: `Unknown Zoho organisation "${org}"` }, { status: 400 });
      // Booked docs list order numbers; a charge on one stays where it is.
      const posted = postings.find((p) => p.org === charge.entity && p.refs.includes(charge.ref));
      if (posted && (org ?? "") !== charge.entity) {
        return NextResponse.json(
          { error: `#${charge.ref} is already booked (${posted.kind} ${posted.id}, ref ${posted.reference}) — void it in Zoho before moving the charge.` },
          { status: 409 },
        );
      }
      patch[key] = org;
    }
    await saveDeliveryEntityOverrides(id, patch);
    return NextResponse.json({ ...(await loadDeliveryEntities(id))!, postings });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
