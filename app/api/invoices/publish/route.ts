import { NextRequest } from "next/server";
import {
  getAccessToken,
  getZohoInvoiceDetail,
  createZohoCustomerPayment,
} from "@/lib/integrations/zoho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublishBody = {
  invoiceIds: string[];
  accountId: string;
  date: string;
  paymentMode?: string; // defaults to "Credit Card"; caller can pass "Cash on Delivery" for COD batches
  referenceOverride?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PublishBody;
  const { invoiceIds, accountId, date, paymentMode = "Credit Card", referenceOverride } = body;

  if (!invoiceIds?.length || !accountId || !date) {
    return new Response(JSON.stringify({ error: "invoiceIds, accountId, date are required" }), { status: 400 });
  }

  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const accessToken = await getAccessToken();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (d: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`));

      send({ type: "start", total: invoiceIds.length });

      let ok = 0, failed = 0, skipped = 0;

      for (let i = 0; i < invoiceIds.length; i++) {
        const invoiceId = invoiceIds[i];
        try {
          // Re-fetch balance server-side — client value could be stale if
          // ops posted anything in Zoho UI since workbench loaded.
          const detail = await getZohoInvoiceDetail(invoiceId, accessToken, orgId);
          const balance = Number(detail.balance);
          
          if (balance <= 0) {
            skipped++;
            send({ type: "progress", index: i, invoiceId, status: "skipped", reason: "Already paid" });
          } else {
            // Workbench methodology: post the balance, close the invoice.
            // No bank_charges — this path is invoice-first, not settlement-driven.
            const result = await createZohoCustomerPayment({
                customerName:detail.customer_name,
                invoiceReferenceNumber: detail.order_number,
                date,
                accountId,
                description: "Settlement for order " + detail.order_number,
                bankCharges: 0,
                customFields: [],
                invoiceId:detail.invoice_id,
                amount: balance,
                paymentMode,
                referenceNumber: referenceOverride||"",
                invoice:detail,
              },
              accessToken,
              orgId,
            );

            // {
            //   },
            ok++;

            console.log("we are below",result)
            send({
              type: "progress",
              index: i,
              invoiceId,
              invoiceNumber: detail.invoice_number,
              status: "ok",
              paymentId: (result as any).paymentId,
            });
          }
        } catch (e) {
            console.log(e,"eror")
          failed++;
          send({ type: "progress", index: i, invoiceId, status: "failed", error: (e as Error).message });
        }

        // Zoho rate limit: ~2-3 req/sec safe. 400ms = 2.5/sec.
        await new Promise((r) => setTimeout(r, 400));
      }

      send({ type: "done", ok, failed, skipped });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}