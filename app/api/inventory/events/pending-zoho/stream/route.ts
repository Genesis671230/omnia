import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

// app/api/inventory/pending-zoho/stream/route.ts
export async function GET() {
    const { data } = await supabase.from("pending_zoho_sync")
      .select("sku, origin_channel, expected_delta, order_ref, created_at")
      .is("cleared_at", null)
      .order("created_at", { ascending: true });
    return NextResponse.json({ pending: data ?? [] });
  }