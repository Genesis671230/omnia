// AI close advisor for ONE batch (a bank credit and the payout behind it).
//
// It is handed the deterministic tally (lib/finance/batch-tally.ts) and may
// look things up in Zoho through read-only tools: the invoices, payments and
// credit notes of any order on the batch. It explains what keeps the batch
// from tallying and proposes fixes with an AED estimate each. It cannot write
// anything — every fix still goes through the booking screens.
//
// Privacy: tools return money, statuses, numbers and references only — never
// a customer's name, email or address.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
// The SDK helpers are built on zod v4; the project pins zod 3.25, which ships v4 at this path.
import { z } from "zod/v4";
import { findZohoInvoiceCandidates } from "@/lib/integrations/zoho";
import { zohoOrgId } from "@/lib/integrations/zoho-context";
import { getCreditNoteLive, getInvoiceMoneySummary, listCustomerCreditNotes } from "@/lib/integrations/zoho-settlement-posting";
import type { BatchTally } from "@/lib/finance/batch-tally";

const MODEL = "claude-opus-5";
/** Zoho reads one advice may spend — the daily quota is shared with booking. */
const MAX_ZOHO_LOOKUPS = 24;

export const BatchAdvice = z.object({
  summary: z.string().describe("Two or three sentences: does this batch tally, and what stands in the way."),
  tallied: z.boolean().describe("True only when nothing is pending and nothing is unexplained."),
  findings: z.array(z.object({
    title: z.string(),
    orders: z.array(z.string()),
    amount_aed: z.number().nullable(),
    cause: z.string().describe("What the numbers and Zoho documents show."),
    fix: z.string().describe("The concrete action in this app or in Zoho."),
    estimate_aed: z.number().nullable().describe("AED this fix would book or clear, from the tally or a Zoho document."),
    confidence: z.enum(["high", "medium", "low"]),
    evidence: z.array(z.string()).describe("Zoho document numbers or tally figures relied on."),
  })),
  next_steps: z.array(z.object({ action: z.string(), orders: z.array(z.string()), impact_aed: z.number().nullable() })),
});
export type BatchAdvice = z.infer<typeof BatchAdvice>;

const SYSTEM = `You are a senior accountant closing the books of a UAE e-commerce business (base currency AED) in Zoho Books. Payments arrive through gateways (Tabby, Tamara, Stripe, Telr, Checkout.com, Shopify Payments) and a cash-on-delivery courier. Each gateway has a clearing account: the customer payment lands there at the invoice's full amount, and the payout to the bank, the gateway fee (5% UAE input VAT on AED payouts), refunds (credit notes refunded from clearing) and exchange differences leave it. When everything on a payout is booked, clearing returns to zero.

You are given one batch: one bank credit, the payout file behind it, and a tally the system computed (booked, pending, unexplained, needs-decision; per-order invoice figures and booking state). The tally is authoritative. Never change or recompute its figures.

Your job: explain what keeps this batch from tallying, and give the fix for each problem with an AED estimate. Use the tools to read invoices, payments and credit notes in Zoho when an order has no invoice, a gap to its invoice, an error, a refund, or a status that doesn't fit. Typical causes: the invoice was already paid by hand; duplicate invoices; a partial payment; an exchange with a credit note; a refund whose credit note is still open; a missing per-order breakdown; the bank keeping part of a cross-border wire.

Rules:
- Every amount you state must come from the tally or a tool result. If you can't support an amount, use null.
- Look up only what a finding needs. You have a limited number of lookups, so spend them on the largest gaps first.
- Fixes name the action (e.g. "record the order in the payout drawer", "force-allocate to INV-… with the gap to Exchange Gain or Loss", "void duplicate INV-…", "reduce credit note CN-… to …"). You cannot book anything yourself.
- Order findings by money at stake. When the batch already tallies, say so and return no findings.`;

type ToolCtx = { accessToken: string; lookups: number };

function spend(ctx: ToolCtx) {
  if (ctx.lookups >= MAX_ZOHO_LOOKUPS) throw new Error(`Lookup limit (${MAX_ZOHO_LOOKUPS}) reached — conclude with what you have.`);
  ctx.lookups += 1;
}

function tools(ctx: ToolCtx) {
  const invoicesFor = async (order: string) => {
    spend(ctx);
    return findZohoInvoiceCandidates(order, ctx.accessToken, zohoOrgId());
  };
  return [
    betaZodTool({
      name: "find_invoices",
      description: "All Zoho invoices for an order number in this batch's organisation: number, date, status, total, balance, currency.",
      inputSchema: z.object({ order_number: z.string() }),
      run: async ({ order_number }) => JSON.stringify(
        (await invoicesFor(order_number)).map((i) => ({
          invoice_id: i.invoice_id, invoice_number: i.invoice_number, date: i.date, status: i.status,
          total: Number(i.total), balance: Number(i.balance), currency: i.currency_code,
        })),
      ),
    }),
    betaZodTool({
      name: "get_invoice",
      description: "One invoice's payments (date, amount, reference, mode) and the credit notes applied to it.",
      inputSchema: z.object({ invoice_id: z.string() }),
      run: async ({ invoice_id }) => {
        spend(ctx);
        const { customer_id: _customer, ...money } = await getInvoiceMoneySummary(invoice_id, ctx.accessToken);
        return JSON.stringify(money);
      },
    }),
    betaZodTool({
      name: "find_credit_notes",
      description: "Credit notes of the customer on an order's invoice: number, date, status, total, balance still unrefunded/unapplied, reference.",
      inputSchema: z.object({ order_number: z.string() }),
      run: async ({ order_number }) => {
        const invoices = await invoicesFor(order_number);
        if (invoices.length === 0) return "No invoice for this order, so no customer to look up.";
        spend(ctx);
        const inv = await getInvoiceMoneySummary(invoices[0].invoice_id, ctx.accessToken);
        if (!inv.customer_id) return "The invoice has no customer.";
        spend(ctx);
        const notes = await listCustomerCreditNotes(inv.customer_id, ctx.accessToken);
        return JSON.stringify(notes.map((n) => ({
          creditnote_id: n.creditnote_id, number: n.creditnote_number, date: n.date, status: n.status,
          total: n.total, balance: n.balance, reference: n.reference_number ?? "",
        })));
      },
    }),
    betaZodTool({
      name: "get_credit_note",
      description: "A credit note as Zoho holds it now, with every refund made against it.",
      inputSchema: z.object({ creditnote_id: z.string() }),
      run: async ({ creditnote_id }) => {
        spend(ctx);
        return JSON.stringify(await getCreditNoteLive(creditnote_id, ctx.accessToken));
      },
    }),
  ];
}

export type BatchAdviceResult = { advice: BatchAdvice; model: string; lookups: number };

/** Runs inside the batch's Zoho organisation (the caller's withZohoOrg scope). */
export async function adviseOnBatch(tally: BatchTally, accessToken: string): Promise<BatchAdviceResult> {
  const client = new Anthropic();
  const ctx: ToolCtx = { accessToken, lookups: 0 };
  const format = betaZodOutputFormat(BatchAdvice);

  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 10,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format },
    system: SYSTEM,
    tools: tools(ctx),
    messages: [{ role: "user", content: `Batch tally:\n${JSON.stringify(tally)}` }],
  });

  if (final.stop_reason === "refusal") throw new AdviceError("The model declined to review this batch.", 422);
  if (final.stop_reason === "max_tokens") throw new AdviceError("The review ran out of room — try again.", 502);
  const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AdviceError(`No review returned (stop reason: ${final.stop_reason}).`, 502);
  }
  const advice = BatchAdvice.safeParse(parsed);
  if (!advice.success) throw new AdviceError("The review came back in an unexpected shape.", 502);
  return { advice: advice.data, model: final.model, lookups: ctx.lookups };
}

export class AdviceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
