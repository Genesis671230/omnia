import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderAttachmentsRepository } from "@/lib/repositories/order-attachments.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";
import { buildInvoicePdf, type InvoiceFields } from "@/lib/invoice";
import { buildIntlInvoicePdf, type IntlInvoiceFields } from "@/lib/invoice-intl";
import { ontrackPrefill, intlPrefill, selectInvoiceTemplate, type InvoiceTemplate } from "@/lib/invoice-fields";
import { createClient } from "@supabase/supabase-js";

type OrderRow = NonNullable<Awaited<ReturnType<typeof OrdersRepository.getByUid>>>;

function resolveTemplate(order: OrderRow, requested?: unknown): InvoiceTemplate {
  return requested === "ontrack" || requested === "intl" ? requested : selectInvoiceTemplate(order.country || "");
}

async function renderPdf(order: OrderRow, template: InvoiceTemplate, edits: Record<string, unknown>): Promise<Uint8Array> {
  if (template === "intl") {
    const base = intlPrefill(order, order.line_items || []);
    const fields: IntlInvoiceFields = { ...base, ...(edits as Partial<IntlInvoiceFields>) };
    return buildIntlInvoicePdf(fields);
  }
  console.log(order,"the order ")
  const base = ontrackPrefill(order);
  const fields: InvoiceFields = { ...base, ...(edits as Partial<InvoiceFields>) };
  return buildInvoicePdf(fields);
}

// Server-side Supabase client with service role — needed to upload to Storage.
// The anon client used elsewhere doesn't have Storage write permission unless
// you've set up RLS policies for it.
function storageClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// Uploads the generated PDF to Supabase Storage bucket "invoices" and returns
// a permanent public URL. Bucket needs to exist and be set public (one-time
// setup in Supabase dashboard: Storage → New bucket → "invoices" → public ✓).
async function persistInvoicePdf(orderUid: string, orderNumber: string, template: InvoiceTemplate, pdf: Uint8Array): Promise<string> {
  const supa = storageClient();
  const ts = Date.now();
  const path = `${orderUid}/invoice-${template}-${orderNumber}-${ts}.pdf`;

  const { error } = await supa.storage.from("invoices").upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw new Error(`invoice upload failed: ${error.message}`);

  const { data } = supa.storage.from("invoices").getPublicUrl(path);
  return data.publicUrl;
}

function pdfResponse(pdf: Uint8Array, orderNumber: string, extraHeaders: Record<string, string> = {}) {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="omnia-invoice-${orderNumber}.pdf"`,
      ...extraHeaders,
    },
  });
}

// GET — unchanged behavior for quick download without a record. Doesn't
// persist or log. This is the "preview" path. If you want every download
// tracked, copy the persist+log logic from POST into here too.
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const template = resolveTemplate(order, new URL(req.url).searchParams.get("template"));
  const pdf = await renderPdf(order, template, {});
  return pdfResponse(pdf, order.order_number);
}

// POST — generates, persists, records attachment, logs event, advances stage.
// Body: { template?, ...fieldEdits }. Response: pdf bytes as before, plus
// X-Attachment-Url header so the client can update the UI without another fetch.
export async function POST(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const actor = "hamza";                              // TODO: wire your auth session
  const prev = order.fulfillment_stage || "new";      // ← the missing piece

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { template: requested, ...edits } = body;
  const template = resolveTemplate(order, requested);

  const pdf = await renderPdf(order, template, edits);

  // Persist + record + log. Wrap in try/catch so a storage/log failure doesn't
  // block the PDF returning to the browser — the user still gets what they
  // asked for; we just note the tracking break server-side.
  let attachmentUrl: string | null = null;
  let attachmentId: string | null = null;
  try {
    attachmentUrl = await persistInvoicePdf(uid, order.order_number, template, pdf);
    const attachment = await OrderAttachmentsRepository.attach(uid, "invoice_pdf", attachmentUrl, {
      provider: "internal",
      externalRef: order.order_number,
      createdBy: actor,
      metadata: { template },
    });
    attachmentId = attachment.id;

    await OrderEventsRepository.log(uid, actor, "invoice.generated", prev, "invoiced", {
      template,
      invoice_number: order.order_number,
      attachment_id: attachmentId,
      url: attachmentUrl,
    });

    // Only advance stage if we're moving forward — don't regress a labeled/
    // shipped order back to invoiced because someone re-downloaded the PDF.
    const stageOrder = ["new", "processing", "confirmed", "reserved", "invoiced", "labeled", "shipped"];
    if (stageOrder.indexOf(prev) < stageOrder.indexOf("invoiced")) {
      await OrdersRepository.setFulfillmentStage(uid, "invoiced", actor);
    }
  } catch (e) {
    console.error(`[invoice/persist] ${uid}: ${(e as Error).message}`);
    // Keep going — return the PDF anyway
  }

  return pdfResponse(pdf, order.order_number, attachmentUrl ? { "X-Attachment-Url": attachmentUrl } : {});
}