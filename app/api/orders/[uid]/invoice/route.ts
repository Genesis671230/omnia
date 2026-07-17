import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { buildInvoicePdf, type InvoiceFields } from "@/lib/invoice";
import { defaultCourier } from "@/lib/courier";

function prefill(order: NonNullable<Awaited<ReturnType<typeof OrdersRepository.getByUid>>>): InvoiceFields {
  const total = Number(order.gross_aed || 0);
  return {
    orderNumber: order.order_number,
    invoiceNo: order.order_number,
    customerId: "",
    date: order.order_date ? new Date(order.order_date).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB"),
    customerName: order.customer_name || "",
    address1: "",
    address2: [order.city, order.country].filter(Boolean).join(", "),
    mobile: order.customer_phone || "",
    additionalNotes: "",
    remarks: "",
    orderValue: total,
    shipping: 0,
    total,
    paid: order.gateway === "COD" ? "COD" : "Yes",
    courier: order.courier || defaultCourier(order.country || ""),
    currency: order.currency || "AED",
  };
}

// GET /api/orders/:uid/invoice — quick-download PDF, auto-filled from the
// order with no editing step.
export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const pdf = await buildInvoicePdf(prefill(order));
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="omnia-invoice-${order.order_number}.pdf"`,
    },
  });
}

// POST /api/orders/:uid/invoice — same PDF, built from founder-edited fields
// (address lines and a customer ID aren't captured in synced order data, so
// the UI collects them here before generating rather than leaving them blank).
export async function POST(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const edits = await request.json().catch(() => ({}));
  const fields: InvoiceFields = { ...prefill(order), ...edits };

  const pdf = await buildInvoicePdf(fields);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="omnia-invoice-${order.order_number}.pdf"`,
    },
  });
}
