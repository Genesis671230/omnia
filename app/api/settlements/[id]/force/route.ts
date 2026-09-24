import { NextResponse } from "next/server";
import { findZohoInvoiceCandidates, getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { ZohoQuotaExceededError } from "@/lib/integrations/zoho-throttle";
import { isUnsettledZohoId, SettlementsRepository, type ForceAllocation } from "@/lib/repositories/settlements.repository";
import { buildCustomerPaymentBody } from "@/lib/integrations/zoho";
import { createCustomerPayment, customerPaymentExists, ZohoRejection } from "@/lib/integrations/zoho-settlement-posting";

export const maxDuration = 60;

// Per-order force booking — for an order held for review because Zoho has
// several invoices under its order number, or none matches the gateway amount.
//
//   GET    → the order's Zoho invoices (one Zoho read, only when the panel opens)
//   POST   { allocations: [{ invoiceId, amount }], description, depositAccountId, date, referenceNumber? } → book it
//   DELETE → clear it (back to automatic invoice picking)
//
// POST books ONE customer payment in Zoho applied to exactly the chosen
// invoices and amounts, with the founder's Deposit To, date, reference and
// description. Fee / FX are not re-booked here; the booking bar's Record
// finishes them only if they were never booked.

type Ctx = { params: Promise<{ id: string }> };

const orgId = () => process.env.ZOHO_ORGANIZATION_ID!;

async function candidatesFor(orderNumber: string) {
  const rows = await findZohoInvoiceCandidates(orderNumber, await getAccessToken(), orgId());
  return rows.map((c) => ({
    invoiceId: c.invoice_id,
    invoiceNumber: c.invoice_number,
    date: c.date,
    status: String(c.status ?? ""),
    total: Number(c.total ?? 0),
    balance: Number(c.balance ?? 0),
    customerId: c.customer_id,
    customerName: c.customer_name,
  }));
}

const fail = (e: unknown) =>
  NextResponse.json({ error: (e as Error).message }, { status: e instanceof ZohoQuotaExceededError ? 429 : 500 });

export async function GET(_req: Request, { params }: Ctx) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const { id } = await params;
  try {
    const s = await SettlementsRepository.getById(id);
    if (!s) return NextResponse.json({ error: "No such settlement record" }, { status: 404 });
    return NextResponse.json({
      orderNumber: s.order_number,
      invoices: await candidatesFor(s.order_number),
      current: s.force_allocations ?? null,
      forcePaymentId: s.force_payment_id ?? null,
      settlementDate: (s.settlement_date ?? "").slice(0, 10) || null,
      bankReference: s.bank_reference ?? "",
      gateway: s.gateway,
      note: s.force_note ?? "",
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const raw: { invoiceId?: unknown; amount?: unknown }[] = Array.isArray(body.allocations) ? body.allocations : [];
  const description = str(body.description ?? body.note);
  const depositAccountId = str(body.depositAccountId);
  const date = str(body.date).slice(0, 10);
  const referenceNumber = str(body.referenceNumber);
  if (raw.length === 0) return NextResponse.json({ error: "Pick at least one invoice" }, { status: 400 });
  if (!description) return NextResponse.json({ error: "Write a description for the payment" }, { status: 400 });
  if (!depositAccountId) return NextResponse.json({ error: "Pick the Deposit To account" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Pick the payment date" }, { status: 400 });

  try {
    const s = await SettlementsRepository.getById(id);
    if (!s) return NextResponse.json({ error: "No such settlement record" }, { status: 404 });
    if (s.force_payment_id?.startsWith("PENDING:")) {
      return NextResponse.json({
        error: "An earlier force payment for this order may have reached Zoho without an answer. Check the customer's payments in Zoho, delete a duplicate if any, then press Clear override and try again.",
      }, { status: 409 });
    }

    // Validate against Zoho as it is now, not what the browser showed earlier.
    const live = await candidatesFor(s.order_number);
    const byId = new Map(live.map((c) => [c.invoiceId, c]));
    const allocations: ForceAllocation[] = [];
    for (const a of raw) {
      const inv = byId.get(String(a.invoiceId ?? ""));
      const amount = Math.round(Number(a.amount) * 100) / 100;
      if (!inv) return NextResponse.json({ error: `Invoice ${a.invoiceId} is not one of order ${s.order_number}'s Zoho invoices` }, { status: 400 });
      if (["void", "draft"].includes(inv.status.toLowerCase())) return NextResponse.json({ error: `Invoice ${inv.invoiceNumber} is ${inv.status}` }, { status: 400 });
      if (!(amount > 0)) return NextResponse.json({ error: `Enter an amount for ${inv.invoiceNumber}` }, { status: 400 });
      if (amount > inv.balance + 0.01) return NextResponse.json({ error: `${inv.invoiceNumber} has only AED ${inv.balance.toFixed(2)} open` }, { status: 400 });
      allocations.push({ invoice_id: inv.invoiceId, invoice_number: inv.invoiceNumber, amount });
    }
    const customers = new Set(allocations.map((a) => byId.get(a.invoice_id)!.customerId));
    if (customers.size > 1) {
      return NextResponse.json({ error: "These invoices belong to different Zoho customers — one payment can't close them" }, { status: 400 });
    }
    const first = byId.get(allocations[0].invoice_id)!;
    const total = Math.round(allocations.reduce((sum, a) => sum + a.amount, 0) * 100) / 100;
    const accessToken = await getAccessToken();

    // A stored payment id can be stale — deleted in Zoho after we booked it.
    // Then the order's payment slot is free again and this payment takes it.
    let orderPaymentLive = false;
    const stored = s.zoho_payment_id;
    if (stored && !isUnsettledZohoId(stored) && !stored.startsWith("EXTERNAL:")) {
      orderPaymentLive = await customerPaymentExists(stored, accessToken);
      if (!orderPaymentLive) await SettlementsRepository.updatePosting(id, { zoho_payment_id: null, zoho_published_at: null });
    }

    await SettlementsRepository.updatePosting(id, {
      force_allocations: allocations, force_note: description, force_by: str(body.actor) || "founder",
      force_at: new Date().toISOString(), force_payment_id: `PENDING:${crypto.randomUUID()}`, zoho_post_error: null,
    });

    let paymentId: string;
    try {
      paymentId = await createCustomerPayment(
        buildCustomerPaymentBody({
          customerName: first.customerName,
          invoiceReferenceNumber: s.order_number,
          amount: total,
          gateway: s.gateway,
          bankReference: s.bank_reference,
          referenceNumberOverride: referenceNumber || `${s.bank_reference || s.order_number}/${s.order_number}/F`.slice(0, 100),
          date,
          accountId: depositAccountId,
          description: description.slice(0, 500),
          customerId: first.customerId,
          invoiceId: first.invoiceId,
          allocations: allocations.map((a) => ({ invoiceId: a.invoice_id, amount: a.amount })),
        } as Parameters<typeof buildCustomerPaymentBody>[0]),
        accessToken,
      );
    } catch (e) {
      // Zoho answered "no" → nothing was written, the slot can be retried.
      // No answer at all → leave PENDING so a retry can't pay twice.
      if (e instanceof ZohoRejection) await SettlementsRepository.updatePosting(id, { force_payment_id: null });
      throw e;
    }

    await SettlementsRepository.updatePosting(id, {
      force_payment_id: paymentId,
      force_payment_amount: total,
      // The order had no live payment: this one is its payment now, so the
      // fee / FX steps (if never booked) can finish from the booking bar.
      ...(orderPaymentLive ? {} : {
        zoho_payment_id: paymentId, zoho_invoice_id: first.invoiceId, zoho_published_at: new Date().toISOString(),
      }),
    });

    return NextResponse.json({
      ok: true, paymentId, amount: total, allocations,
      replacedDeletedPayment: !!stored && !orderPaymentLive && !stored.startsWith("EXTERNAL:") && !isUnsettledZohoId(stored),
      feeBooked: !!s.zoho_fee_expense_id && !isUnsettledZohoId(s.zoho_fee_expense_id),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const s = await SettlementsRepository.getById(id);
    if (s?.force_payment_id && !s.force_payment_id.startsWith("PENDING:")) {
      return NextResponse.json({ error: `A force payment (${s.force_payment_id}) is already in Zoho — delete it in Zoho first.` }, { status: 409 });
    }
    await SettlementsRepository.setForceAllocations(id, null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
