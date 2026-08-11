// app/api/payments/confirm/route.ts
//
// External payment-confirmation entry point — for n8n (or anything else
// outside this app) to call once it has independently verified a payment,
// e.g. an n8n flow that parses a forwarded Tamara/Tabby/Checkout/OnTrack COD
// confirmation email and extracts an order ref + amount. This is the SAME
// pipeline the in-app Stripe/Telr schedulers use under the hood
// (lib/sync/payment-confirm-core.ts) — amount-tolerance check, dedup,
// financial_status flip, dispatch-sheet mark, Telegram notify — so an
// email-triggered confirmation gets exactly the same safety guarantees as a
// gateway-API one. This route does NOT parse emails itself; that's n8n's
// job. It only trusts a caller that already extracted order_number + amount.
//
// Auth: a static shared secret (PAYMENT_CONFIRM_WEBHOOK_SECRET), sent as
// `Authorization: Bearer <secret>` — simplest thing n8n's HTTP Request node
// can send as a static header. Deliberately NOT the AI chat's read-only tool
// path (lib/ai/tools.ts) — this is a genuine write endpoint, so it needs its
// own guard, matching the tool file's own comment that no AI tool is ever
// allowed to write.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { confirmOrderPayment } from "@/lib/sync/payment-confirm-core";

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authorized(req: Request): boolean {
  const secret = process.env.PAYMENT_CONFIRM_WEBHOOK_SECRET;
  if (!secret) return false; // fail closed — never accept writes with no secret configured
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(token) && timingSafeEqual(token, secret);
}

type ConfirmBody = {
  order_number?: string;
  store?: string; // optional disambiguator — order_number can collide across stores
  source?: string; // gateway name, e.g. "Tamara", "Tabby", "Checkout", "OnTrack"
  amount?: number;
  currency?: string;
  paid_at?: string; // ISO datetime, defaults to now
};

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as ConfirmBody | null;
  if (!body || !body.order_number || !body.source || typeof body.amount !== "number" || !body.currency) {
    return NextResponse.json(
      { ok: false, error: "required: order_number, source, amount (number), currency" },
      { status: 400 },
    );
  }

  let query = supabase
    .from("orders")
    .select("uid, order_number, store_id, country, customer_name, gross_original, financial_status")
    .eq("order_number", body.order_number);
  if (body.store) query = query.eq("store_id", body.store.toUpperCase());
  const { data: matches, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  if (!matches || matches.length === 0) {
    return NextResponse.json({ ok: false, error: `no order found for order_number "${body.order_number}"` }, { status: 404 });
  }
  if (matches.length > 1) {
    return NextResponse.json(
      {
        ok: false,
        error: `order_number "${body.order_number}" matches ${matches.length} orders across stores — pass "store" to disambiguate`,
        stores: matches.map((m) => m.store_id),
      },
      { status: 409 },
    );
  }

  const order = matches[0];
  if ((order.financial_status || "").toLowerCase() === "paid") {
    return NextResponse.json({ ok: true, status: "already-paid", order_number: order.order_number });
  }

  const outcome = await confirmOrderPayment({
    order,
    source: body.source,
    dedupProvider: `email-${body.source.toLowerCase()}-confirm`,
    amount: body.amount,
    currency: body.currency,
    paidAtIso: body.paid_at || new Date().toISOString(),
  });

  if (outcome.status === "amount-mismatch") {
    return NextResponse.json(
      { ok: false, status: "amount-mismatch", expected: outcome.expected, actual: outcome.actual },
      { status: 422 },
    );
  }
  if (outcome.status === "already-processed") {
    return NextResponse.json({ ok: true, status: "already-processed", order_number: order.order_number });
  }
  if (outcome.status === "financial-status-update-failed") {
    return NextResponse.json({ ok: false, status: "update-failed", error: outcome.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "confirmed", order_number: order.order_number, sheet: outcome.sheetResult });
}
