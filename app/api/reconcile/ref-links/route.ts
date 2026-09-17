import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

// Manual links for payout lines whose reference isn't an order number —
// Tamara payment links often carry the customer's phone ("0655572535").
//
// GET    ?payoutId=…&ref=…[&q=…]  → suggested orders for that line
// POST   { payoutId, ref, orderNumber, actor? }
// DELETE { payoutId, ref }
//
// The reconciliation engine applies links on its next pass, so the line
// resolves to the order and gets a settlement record like any other.

type OrderRow = {
  order_number: string; store_id: string; customer_name: string; customer_phone: string;
  gross_aed: number; order_date: string | null; gateway: string; payout_status: string | null;
};

const digits = (s: string) => (s || "").replace(/\D/g, "");
const last9 = (s: string) => digits(s).slice(-9);

async function lineFor(payoutId: string, ref: string) {
  const { data: tx } = await supabase
    .from("payout_transactions")
    .select("order_ref, gross_aed, net_aed, is_refund")
    .eq("payout_id", payoutId)
    .eq("order_ref", ref)
    .maybeSingle();
  return tx as { order_ref: string; gross_aed: number; net_aed: number; is_refund: boolean } | null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payoutId = url.searchParams.get("payoutId") ?? "";
  const ref = url.searchParams.get("ref") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!payoutId || !ref) return NextResponse.json({ error: "payoutId and ref are required" }, { status: 400 });

  const tx = await lineFor(payoutId, ref);
  if (!tx) return NextResponse.json({ error: `Line ${ref} is not on payout ${payoutId}` }, { status: 404 });
  const amount = Math.abs(Number(tx.gross_aed));

  // Window: an order paid out on this credit was placed before the credit
  // landed — and Tamara/Tabby settle weekly, so within ~45 days of it.
  const { data: payout } = await supabase.from("payouts").select("gateway").eq("id", payoutId).maybeSingle();
  const { data: recon } = await supabase.from("recon_lines").select("bank_line_id").eq("payout_id", payoutId).maybeSingle();
  const { data: bank } = recon
    ? await supabase.from("bank_lines").select("statement_date").eq("id", recon.bank_line_id).maybeSingle()
    : { data: null };
  const until = bank?.statement_date ? new Date(bank.statement_date) : new Date();
  until.setDate(until.getDate() + 1);
  const since = new Date(until);
  since.setDate(since.getDate() - 46);
  const gateway = String(payout?.gateway ?? "");

  const cols = "order_number, store_id, customer_name, customer_phone, gross_aed, order_date, gateway, payout_status";
  const byId = new Map<string, OrderRow & { reasons: string[] }>();
  const add = (rows: OrderRow[] | null, reason: string) => {
    for (const r of rows ?? []) {
      const cur = byId.get(r.order_number) ?? { ...r, reasons: [] };
      if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
      byId.set(r.order_number, cur);
    }
  };

  const phone = last9(ref);
  if (phone.length === 9) {
    const { data } = await supabase.from("orders").select(cols).ilike("customer_phone", `%${phone}%`).limit(20);
    add(data as OrderRow[], "phone matches");
  }
  if (amount > 0) {
    const tol = Math.max(1, amount * 0.01);
    const { data } = await supabase
      .from("orders")
      .select(cols)
      .gte("gross_aed", amount - tol)
      .lte("gross_aed", amount + tol)
      .gte("order_date", since.toISOString())
      .lte("order_date", until.toISOString())
      .order("order_date", { ascending: false })
      .limit(40);
    add(data as OrderRow[], "amount matches");
  }
  if (q) {
    const safe = q.replace(/[%,()]/g, "");
    const { data } = await supabase
      .from("orders")
      .select(cols)
      .or(`order_number.ilike.%${safe}%,customer_name.ilike.%${safe}%,customer_phone.ilike.%${safe}%`)
      .order("order_date", { ascending: false })
      .limit(20);
    add(data as OrderRow[], "search");
  }

  const { data: existing } = await supabase
    .from("payout_ref_links")
    .select("order_number")
    .eq("payout_id", payoutId)
    .eq("order_ref", ref)
    .maybeSingle();

  const inWindow = (o: OrderRow) => !!o.order_date && new Date(o.order_date) >= since && new Date(o.order_date) <= until;
  const score = (o: OrderRow & { reasons: string[] }) =>
    (o.reasons.includes("phone matches") ? 5 : 0) +
    (o.reasons.includes("amount matches") ? 2 : 0) +
    (Math.abs(Number(o.gross_aed) - amount) < 0.01 ? 1 : 0) +
    (gateway && o.gateway?.toLowerCase() === gateway.toLowerCase() ? 3 : 0) +
    (inWindow(o) ? 1 : -2) +
    (o.payout_status === "settled" ? -3 : 0);
  for (const o of byId.values()) if (gateway && o.gateway?.toLowerCase() === gateway.toLowerCase()) o.reasons.push(`${gateway} order`);

  // Orders this payout already pays for (directly or via another link) can't be this line too.
  const [{ data: siblings }, { data: siblingLinks }] = await Promise.all([
    supabase.from("payout_transactions").select("order_ref").eq("payout_id", payoutId),
    supabase.from("payout_ref_links").select("order_ref, order_number").eq("payout_id", payoutId),
  ]);
  const onThisPayout = new Set<string>();
  for (const r of siblings ?? []) if (r.order_ref !== ref) { onThisPayout.add(r.order_ref); onThisPayout.add(r.order_ref.replace(/^(WA|UAE|KSA|WOO|SA)/i, "")); }
  for (const l of siblingLinks ?? []) if (l.order_ref !== ref) onThisPayout.add(l.order_number);

  const suggestions = [...byId.values()]
    .filter((o) => !onThisPayout.has(o.order_number))
    .sort((a, b) => score(b) - score(a) || String(b.order_date ?? "").localeCompare(String(a.order_date ?? "")))
    .slice(0, 12)
    .map((o) => ({
      orderNumber: o.order_number,
      store: o.store_id,
      customer: o.customer_name,
      phone: o.customer_phone,
      amount: Number(o.gross_aed),
      date: o.order_date,
      gateway: o.gateway,
      alreadySettled: o.payout_status === "settled",
      reasons: o.reasons,
    }));

  return NextResponse.json({ ref, amount, linkedTo: existing?.order_number ?? null, suggestions });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const payoutId = String(body.payoutId ?? "").trim();
  const ref = String(body.ref ?? "").trim();
  const orderNumber = String(body.orderNumber ?? "").trim().replace(/^#/, "");
  if (!payoutId || !ref || !orderNumber) {
    return NextResponse.json({ error: "payoutId, ref and orderNumber are required" }, { status: 400 });
  }
  if (!(await lineFor(payoutId, ref))) {
    return NextResponse.json({ error: `Line ${ref} is not on payout ${payoutId}` }, { status: 404 });
  }
  const { data: order } = await supabase.from("orders").select("order_number").eq("order_number", orderNumber).maybeSingle();
  if (!order) return NextResponse.json({ error: `Order ${orderNumber} isn't in the synced orders — run a sync first.` }, { status: 404 });

  const { data: clash } = await supabase
    .from("payout_ref_links")
    .select("order_ref")
    .eq("payout_id", payoutId)
    .eq("order_number", orderNumber)
    .neq("order_ref", ref)
    .maybeSingle();
  if (clash) {
    return NextResponse.json({ error: `Order ${orderNumber} is already linked to line ${clash.order_ref} on this payout.` }, { status: 409 });
  }

  const { error } = await supabase.from("payout_ref_links").upsert(
    { payout_id: payoutId, order_ref: ref, order_number: orderNumber, tenant_id: TENANT, linked_by: String(body.actor ?? "founder"), linked_at: new Date().toISOString() },
    { onConflict: "payout_id,order_ref" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, payoutId, ref, orderNumber });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const payoutId = String(body.payoutId ?? "").trim();
  const ref = String(body.ref ?? "").trim();
  if (!payoutId || !ref) return NextResponse.json({ error: "payoutId and ref are required" }, { status: 400 });

  const { data: link } = await supabase
    .from("payout_ref_links")
    .select("order_number")
    .eq("payout_id", payoutId)
    .eq("order_ref", ref)
    .maybeSingle();
  if (!link) return NextResponse.json({ ok: true });

  // Once Zoho holds a payment for the linked order, unlinking would orphan it.
  const { data: booked } = await supabase
    .from("settlement_records")
    .select("zoho_payment_id")
    .eq("payout_id", payoutId)
    .eq("order_number", link.order_number);
  const real = (booked ?? []).find((b) => b.zoho_payment_id && !/^(CLAIMED|PENDING):/.test(b.zoho_payment_id));
  if (real) {
    return NextResponse.json(
      { error: `Order ${link.order_number} is already booked in Zoho from this line — reverse that in Zoho before unlinking.` },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("payout_ref_links").delete().eq("payout_id", payoutId).eq("order_ref", ref);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The engine only ever adds settlement records; drop the one this link
  // created so the order doesn't linger as bookable from this payout.
  await supabase.from("settlement_records").delete().eq("payout_id", payoutId).eq("order_number", link.order_number);
  return NextResponse.json({ ok: true });
}
