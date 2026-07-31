// app/api/orders/[uid]/events/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const { data, error } = await supabase
    .from("order_events")
    .select("*").eq("order_uid", uid)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ events: [] });
  return NextResponse.json({ events: data ?? [] });
}