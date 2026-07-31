// app/api/orders/[uid]/mark-paid/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";

// Manual payment authorization for non-Stripe gateways (Tabby, Tamara,
// Checkout, COD confirmations) where we've verified receipt out-of-band
// — gateway email, dashboard check, or bank confirmation. Sets
// financial_status='paid' (money in) or 'authorized' (captured but not
// yet settled). Both unblock the Confirm step downstream.
//
// Body: { status: 'paid' | 'authorized', note?: string, method?: string }
export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body?.status;
  if (status !== "paid" && status !== "authorized") {
    return NextResponse.json({ ok: false, error: "status must be 'paid' or 'authorized'" }, { status: 400 });
  }

  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const actor = "hamza";  // TODO: session

  const { error } = await supabase.from("orders")
    .update({ financial_status: status })
    .eq("uid", uid);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await OrderEventsRepository.log(uid, actor, "payment.authorized", order.financial_status, status, {
    method: body?.method || "manual",
    note: body?.note || "",
    gateway: order.gateway,
    amount_aed: order.gross_aed,
  });

  return NextResponse.json({ ok: true, status });
}