import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { buildInvoicePdf } from "@/lib/invoice";

// GET /api/orders/:uid/invoice — on-demand PDF invoice for one order.
export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const pdf = await buildInvoicePdf({
    order_number: order.order_number,
    store_id: order.store_id,
    order_date: order.order_date,
    currency: order.currency,
    gross_original: Number(order.gross_original || 0),
    gross_aed: Number(order.gross_aed || 0),
    gateway: order.gateway,
    customer_name: order.customer_name || "",
    customer_email: order.customer_email || "",
    customer_phone: order.customer_phone || "",
    city: order.city || "",
    country: order.country || "",
    courier: order.courier || "",
    tracking_number: order.tracking_number || "",
    line_items: order.line_items || [],
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="omnia-invoice-${order.order_number}.pdf"`,
    },
  });
}
