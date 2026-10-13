import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/* Leads inbox feed (/leads). Behind the session check — NOT under the public
   /api/lead/* intake prefix. Newest first; ?status= and ?days= narrow it. */

export const dynamic = "force-dynamic";

const COLS = "id,created_at,name,whatsapp,email,company,store_url,situation,penalty_type,penalty_issued_on,checker,gateways,monthly_orders,accounting_tool,utm_source,utm_campaign,utm_content,landing_path,source,status,notes,contacted_at";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 90) || 90, 1), 730);
  let q = supabase.from("leads").select(COLS).gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(500);
  if (status && status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [] });
}
