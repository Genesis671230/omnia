// Store-ops chat — general knowledge PLUS read-only tool access to live
// sales, order, reconciliation, payout-sync, inventory-snapshot, and ad
// platform (Meta/Google/TikTok/Snap) data across all 4 stores (WA, UAE, KSA,
// WOO). Tool access is deliberately narrow: every tool in lib/ai/tools.ts is
// a capped, read-only query built on the same repositories the dashboard
// uses — there is no query/SQL tool and no write tool, so the assistant can
// see what a founder could already see in the app, and nothing more, and can
// never change anything.
//
// The Anthropic tool-use loop runs non-streaming (tool calls can take a few
// round trips); once the model has a final answer we fake-stream it back to
// the client so the existing token-by-token UI still feels alive.

import { AI_TOOLS, runTool } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the Omnia Stores assistant, embedded in the founder's finance dashboard.

You have READ-ONLY tool access to live data across all 4 stores (WA, UAE, KSA, WOO): sales and order data, bank reconciliation status, payout-sync status (Stripe/Telr), product performance, an inventory snapshot, daily settlement reports, and ad platform performance (Meta, Google, TikTok, Snapchat — spend, impressions, clicks, platform-reported conversions per campaign/store). Call the relevant tool(s) before answering any question about Omnia's actual numbers — never guess or estimate a real figure.

Guardrails — follow these strictly:
- Only state Omnia-specific numbers that came back from a tool call this turn. If a tool errors or returns nothing, say so plainly rather than filling the gap with a guess.
- These tools are read-only. You cannot create, edit, delete, settle, or refund anything. If asked to change data (e.g. "mark this settled", "issue a refund", "delete this order"), explain you can't and point them to the relevant tab in the app.
- get_low_stock_products is a snapshot from the last time a SKU appeared in a synced order, not a live stock poll — say so if it's relevant to the answer.
- get_ad_spend and get_campaign_performance report platform-reported conversions and actual store revenue as two separate numbers — never combine them into a computed ROAS/attribution figure, since there is no event-level match between the two.
- Never surface customer phone numbers or email addresses (the tools don't return them anyway).
- Attribute figures to their source in passing (e.g. "per reconciliation" / "per the last payout sync") so the founder knows it's live data, not a guess.
- Keep answers concise and practical — a busy founder is reading this on a small chat bar.

For general questions not about Omnia's live data (e-commerce ops, logistics, marketing, gateway concepts, financial concepts), answer from general knowledge as usual.`;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_ITERATIONS = 4;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

async function callAnthropic(messages: unknown[]) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: AI_TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function fakeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const words = text.split(/(\s+)/); // keep whitespace so we don't have to re-join
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const w of words) {
        controller.enqueue(encoder.encode(w));
        if (w.trim()) await new Promise((r) => setTimeout(r, 12));
      }
      controller.close();
    },
  });
}

export async function POST(request: Request) {
  const { messages } = await request.json();

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "The store assistant isn't connected yet — add ANTHROPIC_API_KEY to the environment to enable it.",
      { headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Ask me anything about running the store.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const conversation: { role: string; content: unknown }[] = messages
    .slice(-12)
    .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }));

  try {
    let finalText = "";
    for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
      const response = await callAnthropic(conversation);
      const blocks: AnthropicContentBlock[] = response.content ?? [];

      if (response.stop_reason !== "tool_use" || iteration === MAX_TOOL_ITERATIONS) {
        finalText = blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n");
        if (!finalText && iteration === MAX_TOOL_ITERATIONS) {
          finalText = "That took more lookups than expected — try asking a narrower question.";
        }
        break;
      }

      conversation.push({ role: "assistant", content: blocks });

      const toolResults = await Promise.all(
        blocks
          .filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use")
          .map(async (b) => {
            const outcome = await runTool(b.name, b.input);
            return {
              type: "tool_result" as const,
              tool_use_id: b.id,
              content: outcome.ok ? JSON.stringify(outcome.result) : `Error: ${outcome.error}`,
              is_error: !outcome.ok,
            };
          }),
      );
      conversation.push({ role: "user", content: toolResults });
    }

    return new Response(fakeStream(finalText || "I couldn't find anything for that."), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return new Response(`Chat error: ${(e as Error).message.slice(0, 300)}`, { status: 502 });
  }
}
