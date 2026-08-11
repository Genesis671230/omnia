// Shared Anthropic tool-use loop — the same read-only-tools chat harness
// backs both the web dashboard's chat (app/api/chat/route.ts) and the
// Telegram @mention listener (lib/telegram/listener.ts). One implementation,
// one place to fix guardrail bugs.

import { AI_TOOLS, runTool, type ToolName } from "@/lib/ai/tools";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_ITERATIONS = 4;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type ChatMessage = { role: string; content: unknown };

async function callAnthropic(messages: unknown[], systemPrompt: string, tools: readonly unknown[]) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: systemPrompt, tools, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Runs the full tool-use loop to a final text answer. `allowedTools` scopes
// which tools this persona may call (e.g. the CFO persona vs. an ops
// persona) — defaults to every tool in lib/ai/tools.ts.
export async function runChatTurn(
  conversation: ChatMessage[],
  systemPrompt: string,
  allowedTools?: ToolName[],
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "The assistant isn't connected yet — ANTHROPIC_API_KEY is missing.";
  }

  const tools = allowedTools ? AI_TOOLS.filter((t) => allowedTools.includes(t.name)) : AI_TOOLS;
  const messages = [...conversation];

  // Grounds "last week" / "last month" / "this year" style date-range
  // questions — without this the model has no way to know what "today" is.
  const dubaiNowIso = new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 10);
  const systemPromptWithDate = `${systemPrompt}\n\nToday's date is ${dubaiNowIso} (Asia/Dubai, UTC+4, no DST) — use this to resolve relative date ranges like "last week" or "last month" before calling any date-range tool.`;

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    const response = await callAnthropic(messages, systemPromptWithDate, tools);
    const blocks: AnthropicContentBlock[] = response.content ?? [];

    if (response.stop_reason !== "tool_use" || iteration === MAX_TOOL_ITERATIONS) {
      const finalText = blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n");
      if (finalText) return finalText;
      return iteration === MAX_TOOL_ITERATIONS
        ? "That took more lookups than expected — try asking a narrower question."
        : "I couldn't find anything for that.";
    }

    messages.push({ role: "assistant", content: blocks });

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
    messages.push({ role: "user", content: toolResults });
  }

  return "I couldn't find anything for that.";
}
