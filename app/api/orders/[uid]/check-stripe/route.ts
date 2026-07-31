// app/api/orders/[uid]/check-stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";

// One-click Stripe status check for a gateway=='Stripe' order.
// Reads live from Stripe, updates local financial_status if changed,
// logs the reconciliation event. Requires order to have a stripe
// payment_intent stored somewhere — using telr_tranref as a stand-in
// since your schema uses it as a gateway ref field; adjust if you
// have a dedicated column.
export async function POST(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  if ((order.gateway || "").toLowerCase() !== "stripe") {
    return NextResponse.json({ ok: false, error: "not a Stripe order" }, { status: 400 });
  }

  const paymentRef = order.telr_tranref;  // or wherever you store the PI id
  if (!paymentRef) {
    return NextResponse.json({ ok: false, error: "no Stripe payment reference on order" }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-11-20.acacia" });
  const pi = await stripe.paymentIntents.retrieve(paymentRef);

  // Map Stripe statuses → your financial_status vocabulary
  const map: Record<string, string> = {
    succeeded: "paid",
    requires_capture: "authorized",
    processing: "pending",
    canceled: "voided",
    requires_payment_method: "unpaid",
  };
  const newStatus = map[pi.status] ?? pi.status;

  if (newStatus !== order.financial_status) {
    await supabase.from("orders").update({ financial_status: newStatus }).eq("uid", uid);
    await OrderEventsRepository.log(uid, "stripe-check", "payment.reconciled",
      order.financial_status, newStatus,
      { stripe_status: pi.status, amount: pi.amount, currency: pi.currency });
  }

  return NextResponse.json({ ok: true, status: newStatus, stripeStatus: pi.status });
}