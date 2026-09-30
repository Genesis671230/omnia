import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
// The SDK helper is built on zod v4; the project pins zod 3.25, which ships v4 at this path.
import { z } from "zod/v4";

export const runtime = "nodejs";
export const maxDuration = 120;

/* POST /api/zoho/ledger/advice — a prioritised month-end close plan.
 *
 * The client sends what the Ledger tab already computed (close flags +
 * per-gateway reconciliation, see lib/reconciliation/ledger-close.ts): figures
 * and account names only, never customer rows. Every number in the answer
 * comes from that input; the model orders the work and explains it. The
 * deterministic suggestion on each flag stays on screen whether or not this
 * call succeeds. */

const MODEL = "claude-opus-5";

const Flag = z.object({
  id: z.string(), severity: z.string(), title: z.string(),
  amount: z.number(), count: z.number(), suggestion: z.string(),
});
const Gateway = z.object({
  name: z.string(), moneyIn: z.number(), moneyOut: z.number(), reconciled: z.number(),
  pending: z.number(), balance: z.number().nullable(), pct: z.number(),
});
const Body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  flags: z.array(Flag).max(60),
  gateways: z.array(Gateway).max(40),
  totals: z.record(z.string(), z.number()),
});

const Plan = z.object({
  summary: z.string(),
  steps: z.array(z.object({
    title: z.string(),
    why: z.string(),
    flag_id: z.string().nullable(),
    impact_aed: z.number().nullable(),
  })),
});
export type ClosePlan = z.infer<typeof Plan>;

const SYSTEM = `You are a senior accountant helping close the month for a UAE e-commerce business (AED base currency) that takes payments through Tabby, Tamara, Stripe, Telr, Checkout.com, Shopify Payments and cash-on-delivery couriers, and books in Zoho Books. Each gateway has a clearing account: customer payments land there, the payout to the bank, gateway fees (with 5% UAE input VAT on AED payouts) and exchange differences leave it, and it should return to zero once everything is booked.

You receive the month's computed close flags and per-gateway reconciliation figures. Produce a short, prioritised plan for the accountant: what to do first, second, and so on to close the books cleanly. Order by what blocks the close and by money at stake. Use only the figures given; do not invent amounts, invoices or accounts. Where a step addresses a specific flag, set flag_id to that flag's id. Keep each title an imperative action under 12 words and each "why" to one or two sentences. Keep the summary to two sentences.`;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 503 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid close summary" }, { status: 400 });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Plan) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Month: ${parsed.data.month}\n\n${JSON.stringify(parsed.data)}` }],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The model declined to produce a plan for this input." }, { status: 422 });
    }
    if (!response.parsed_output) {
      return NextResponse.json({ error: `No plan returned (stop reason: ${response.stop_reason})` }, { status: 502 });
    }
    return NextResponse.json({ plan: response.parsed_output, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "AI is rate-limited right now — try again in a minute." }, { status: 429 });
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return NextResponse.json({ error: "Couldn't reach the AI service." }, { status: 502 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI error ${e.status ?? ""}: ${e.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
