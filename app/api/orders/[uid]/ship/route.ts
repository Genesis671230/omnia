import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { addShipment, getSmsaCities, smsaConfigured } from "@/lib/integrations/smsa";
import { sendTelegramMessage, telegramConfigured } from "@/lib/integrations/telegram";
import { sendEmail, shipmentEmailHtml, emailConfigured } from "@/lib/integrations/email";

// Coarse SLA estimate for the customer email — not a per-shipment figure
// from SMSA (getTrack gives status, not an ETA promise). KSA-domestic vs
// everything else SMSA also serves from this account (GCC).
function etaFor(countryCode: string): string {
  return (countryCode || "").trim().toUpperCase() === "SA" ? "1–2 business days" : "3–5 business days";
}

// Best-effort ops + customer notifications — a failure here must never fail
// the shipment response, since the AWB already exists in SMSA's system by
// this point. Each channel no-ops quietly if unconfigured.
async function notifyShipment(order: { order_number: string; customer_name: string; customer_email: string; country: string }, awb: string) {
  if (telegramConfigured()) {
    const r = await sendTelegramMessage(`📦 <b>AWB issued</b>\nOrder #${order.order_number} — ${order.customer_name || "—"}\nAWB: <code>${awb}</code>`);
    if (!r.ok) console.error(`[notify/telegram] ${order.order_number}: ${r.error}`);
  }
  if (emailConfigured() && order.customer_email) {
    const r = await sendEmail({
      to: order.customer_email,
      subject: `Your Omnia order #${order.order_number} is on the way`,
      html: shipmentEmailHtml({
        customerName: order.customer_name, orderNumber: order.order_number,
        awb, courier: "SMSA", etaDays: etaFor(order.country),
      }),
    });
    if (!r.ok) console.error(`[notify/email] ${order.order_number}: ${r.error}`);
  }
}

// POST /api/orders/:uid/ship — issues a real SMSA AWB. Server-side only: the
// SMSA credential never reaches the browser, and SOAP/XML has no CORS story
// for browser origins anyway. Body: { weight, packageCount, codAmount?, city,
// address1, address2 }. refNo is always the order's own uid — not accepted
// from the request, so nothing client-supplied can spoof it.
export async function POST(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;

  if (!smsaConfigured()) {
    return NextResponse.json({ success: false, error: "SMSA is not configured (SMSA_API_KEY missing)" }, { status: 400 });
  }

  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });

  // Guards the double-submit race described in the spec: a second click (or
  // a second tab) arriving after the first request already stamped an AWB
  // must not issue a duplicate shipment.
  if (order.awb_number) {
    return NextResponse.json({ success: false, error: `Already shipped — AWB ${order.awb_number}` }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const { weight, packageCount = 1, codAmount, city, address1, address2 } = body ?? {};

  if (!weight || Number(weight) <= 0) {
    return NextResponse.json({ success: false, error: "Package weight is required and must be greater than 0" }, { status: 400 });
  }
  if (!city) {
    return NextResponse.json({ success: false, error: "City is required" }, { status: 400 });
  }

  // Never trust free-text city — validate against SMSA's own list rather
  // than assume the client sent a value from the dropdown.
  const cities = await getSmsaCities();
  const cityMatch = cities.find((c) => c.city.toLowerCase() === String(city).toLowerCase());
  if (!cityMatch) {
    return NextResponse.json({ success: false, error: `"${city}" is not a city SMSA recognizes. Pick one from the list.` }, { status: 400 });
  }

  const result = await addShipment({
    refNo: order.uid,
    customerName: order.customer_name || "",
    countryCode: order.country || "SA",
    city: cityMatch.city,
    mobile: order.customer_phone || "",
    address1: address1 || "",
    address2: address2 || [order.city, order.country].filter(Boolean).join(", "),
    pieces: Number(packageCount) || 1,
    weightKg: Number(weight),
    codAmount: order.gateway === "COD" ? Number(codAmount || order.gross_aed || 0) : undefined,
    currency: order.currency || "SAR",
    itemDesc: `Order #${order.order_number}`,
  });

  if (!result.ok) {
    // Log the raw error server-side (this response already carries it, but
    // the spec calls out logging separately for when the client-visible
    // message alone isn't enough to debug a rejected shipment later).
    console.error(`[smsa/ship] ${order.uid} failed: ${result.error}`);
    await OrdersRepository.recordShipmentError(uid, result.error);
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  const labelUrl = `/api/orders/${uid}/label`;
  const updated = await OrdersRepository.recordShipmentSuccess(uid, result.awb, "SMSA", labelUrl);

  // Fire-and-forget: the AWB is already issued, so a notification failure
  // is logged, not surfaced as a shipment failure.
  notifyShipment(
    { order_number: order.order_number, customer_name: order.customer_name, customer_email: order.customer_email, country: order.country },
    result.awb,
  ).catch((e) => console.error(`[notify] ${order.uid}: ${(e as Error).message}`));

  return NextResponse.json({ success: true, awb: result.awb, labelUrl, order: updated });
}
