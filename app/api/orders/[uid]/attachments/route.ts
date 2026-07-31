// app/api/orders/[uid]/attachments/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const { data, error } = await supabase
    .from("order_attachments")
    .select("*").eq("order_uid", uid)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ attachments: [] });  // never break the UI on missing table
  return NextResponse.json({ attachments: data ?? [] });
}