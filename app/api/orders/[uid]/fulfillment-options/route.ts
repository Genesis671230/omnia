// app/api/orders/[uid]/fulfillment-options/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const { data, error } = await supabase.rpc("order_fulfillment_options", { p_order_uid: uid });
  if (error) {
    console.error("[fulfillment-options]", error.message);
    return NextResponse.json({ options: [] });
  }
  return NextResponse.json({ options: data ?? [] });
}