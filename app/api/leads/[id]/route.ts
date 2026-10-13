import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/* Update a lead's follow-up state from the /leads inbox. */

export const dynamic = "force-dynamic";

const LEAD_STATUSES = ["new", "contacted", "qualified", "call-booked", "won", "lost"] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { status?: string; notes?: string } | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.status != null) {
    if (!(LEAD_STATUSES as readonly string[]).includes(body.status)) return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    patch.status = body.status;
    if (body.status !== "new") patch.contacted_at = new Date().toISOString();
  }
  if (body.notes != null) patch.notes = String(body.notes).slice(0, 4000);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const { data, error } = await supabase.from("leads").update(patch).eq("id", id).select("id,status,notes,contacted_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lead: data });
}
