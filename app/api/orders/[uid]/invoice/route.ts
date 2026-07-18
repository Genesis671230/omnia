import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { buildInvoicePdf, type InvoiceFields } from "@/lib/invoice";
import { buildIntlInvoicePdf, type IntlInvoiceFields } from "@/lib/invoice-intl";
import { ontrackPrefill, intlPrefill, selectInvoiceTemplate, type InvoiceTemplate } from "@/lib/invoice-fields";

type OrderRow = NonNullable<Awaited<ReturnType<typeof OrdersRepository.getByUid>>>;

function resolveTemplate(order: OrderRow, requested?: unknown): InvoiceTemplate {
  return requested === "ontrack" || requested === "intl"
    ? requested
    : selectInvoiceTemplate(order.country || "");
}

async function renderPdf(order: OrderRow, template: InvoiceTemplate, edits: Record<string, unknown>): Promise<Uint8Array> {
  if (template === "intl") {
    // Line items come from the order (read server-side) so the client can't
    // forge item totals; the caller may still override presentational fields
    // (addresses, terms, descriptions, shipping) via `edits`.
    const base = intlPrefill(order, order.line_items || []);
    const fields: IntlInvoiceFields = { ...base, ...(edits as Partial<IntlInvoiceFields>) };
    return buildIntlInvoicePdf(fields);
  }
  const base = ontrackPrefill(order);
  const fields: InvoiceFields = { ...base, ...(edits as Partial<InvoiceFields>) };
  return buildInvoicePdf(fields);
}

function pdfResponse(pdf: Uint8Array, orderNumber: string) {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="omnia-invoice-${orderNumber}.pdf"`,
    },
  });
}

// GET /api/orders/:uid/invoice — quick-download PDF, auto-filled from the order
// with no editing step. `?template=ontrack|intl` overrides the destination
// default.
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const template = resolveTemplate(order, new URL(req.url).searchParams.get("template"));
  const pdf = await renderPdf(order, template, {});
  return pdfResponse(pdf, order.order_number);
}

// POST /api/orders/:uid/invoice — same PDF, built from founder-edited fields.
// Body: { template?, ...templateFields }. Address lines, customer id, HS/origin
// notes and the like aren't in synced order data, so the modal collects them
// here before generating.
export async function POST(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { template: requested, ...edits } = body;
  const template = resolveTemplate(order, requested);

  const pdf = await renderPdf(order, template, edits);
  return pdfResponse(pdf, order.order_number);
}
