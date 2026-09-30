// AI storefront roast. Reads one storefront page as a shopper gets it (the
// PageAudit facts + visible copy + the real product photos), the store's own
// session funnel and its leakiest product pages, and writes a blunt teardown:
// where people leave, why (from the page), and what to change first.
//
// Every figure it may use is in the input; it recommends, it never edits the
// store. Each roast is stored (site_roasts) so the next one can say what changed.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
// The SDK helper is built on zod v4; the project pins zod 3.25, which ships v4 at this path.
import { z } from "zod/v4";
import { supabase } from "@/lib/supabase";
import type { PageAudit } from "@/lib/storefront/page-audit";
import type { FunnelStep, ProductLeak } from "@/lib/storefront/funnel-leaks";

const MODEL = "claude-opus-5-5";
const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

const Fix = z.object({
  title: z.string().describe("The change, in a few words."),
  where: z.enum(["above_the_fold", "buy_box", "images", "trust", "checkout", "speed", "mobile", "copy", "navigation", "other"]),
  impact: z.enum(["high", "medium", "low"]),
  effort: z.enum(["quick", "days", "project"]),
  evidence: z.string().describe("What in the input shows the problem — a fact from the audit, a funnel figure, or the copy."),
  action: z.string().describe("Exactly what to change on the page or in Shopify."),
});

export const SiteRoast = z.object({
  verdict: z.string().describe("One or two punchy sentences a founder would screenshot."),
  score: z.number().describe("0-100: how well this page turns a visitor into a buyer."),
  roast: z.array(z.string()).describe("3-6 blunt, specific, funny-but-fair lines about what a shopper actually experiences. Each tied to a fact."),
  leaks: z.array(z.object({
    step: z.string().describe("Funnel step or page element where people leave."),
    why: z.string(),
    evidence: z.string(),
  })).describe("Where visitors leak and why, most costly first."),
  fixes: z.array(Fix).describe("Prioritised fixes, highest impact first."),
  keep: z.array(z.string()).describe("What already works and must not be broken."),
  unknowns: z.array(z.string()).describe("What the input can't show (e.g. JS-loaded widgets, real load speed) and how to check it."),
});
export type SiteRoast = z.infer<typeof SiteRoast>;

const SYSTEM = `You are a senior e-commerce conversion (CRO) specialist roasting a Gulf jewellery storefront (Omnia Stores — UAE/KSA, AED/SAR, Arabic + English shoppers, mostly mobile, paid Meta traffic).

Be blunt and specific, like a paid teardown — but every claim must rest on the input: the page audit (read from the server HTML), the visible copy, the product photos attached, and the store's Shopify session funnel. Never invent figures. Quote the numbers you use.

What you know about the input:
- The audit reads the HTML the server sends. Widgets injected later by JavaScript (review apps, Tabby/Tamara badges, chat bubbles) may exist yet not appear — when absence matters, say "not in the page HTML" and list it under unknowns rather than asserting it is missing.
- redirectedFrom set means the requested page 301'd elsewhere: anyone clicking an ad or link to that product lands somewhere else. That is a top leak.
- The funnel may be unavailable (missing Shopify read_reports scope); then judge the page alone and say so.
- Gulf shoppers expect: price clarity incl. VAT, delivery time/cost, cash on delivery, Tabby/Tamara instalments, WhatsApp help, easy returns, Arabic, real reviews, fast mobile pages.

Prioritise fixes by visitors lost × ease. Prefer quick wins first when impact is similar.`;

export type RoastInput = {
  site: string;
  page: PageAudit;
  funnel: { status: string; steps?: FunnelStep[]; message?: string };
  devices?: { device: string; sessions: number; addedToCart: number; completed: number }[];
  productLeaks?: ProductLeak[];
  range: { from: string; to: string };
};

export class RoastError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function runSiteRoast(input: RoastInput) {
  const client = new Anthropic();
  const { visibleText, productImages, ...facts } = input.page;
  const images: Anthropic.Beta.BetaImageBlockParam[] = productImages.slice(0, 3).map((url) => ({
    type: "image",
    source: { type: "url", url },
  }));
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(SiteRoast) },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        ...images,
        {
          type: "text",
          text: `Storefront: ${input.site}\nRange for funnel figures: ${input.range.from} → ${input.range.to}\n\n` +
            `Page audit:\n${JSON.stringify(facts)}\n\n` +
            `Store funnel:\n${JSON.stringify(input.funnel)}\n\n` +
            `By device:\n${JSON.stringify(input.devices ?? null)}\n\n` +
            `Leakiest product landing pages (visitors who never added to cart):\n${JSON.stringify((input.productLeaks ?? []).slice(0, 10))}\n\n` +
            `Visible page copy (HTML text, truncated):\n${visibleText}\n\n` +
            (images.length ? "The attached images are this page's product/share photos." : "No product photos were found on the page."),
        },
      ],
    }],
  });
  if (response.stop_reason === "refusal") throw new RoastError("The model declined to review this page.", 422);
  if (!response.parsed_output) throw new RoastError(`No roast returned (stop reason: ${response.stop_reason}).`, 502);
  const roast = response.parsed_output;

  const { data, error } = await supabase
    .from("site_roasts")
    .insert({ tenant_id: TENANT, site: input.site, url: input.page.url, model: response.model, roast, snapshot: { page: facts, funnel: input.funnel } })
    .select("id, created_at")
    .single();
  if (error) throw new RoastError(`Roast generated but not saved: ${error.message}`, 500);
  return { id: data.id as string, created_at: data.created_at as string, model: response.model, url: input.page.url, roast };
}

export async function latestRoasts(site: string, limit = 5) {
  const { data, error } = await supabase
    .from("site_roasts")
    .select("id, created_at, url, model, roast")
    .eq("tenant_id", TENANT)
    .eq("site", site)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; created_at: string; url: string; model: string; roast: SiteRoast }[];
}
