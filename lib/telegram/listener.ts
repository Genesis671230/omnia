// Telegram long-poll listener — one loop per bot persona (ops/@omnia_cos_bot,
// cfo/@omnia_cfo_bot). Long-polling means no public URL/webhook is needed:
// each loop just holds an outbound HTTPS connection open, same shape as the
// other persistent schedulers in lib/scheduler/.
//
// Responsibilities split by persona:
// - ops (isPrimary): logs every group message (for the daily summary),
//   welcomes new members and captures their role, AND answers when tagged.
// - cfo: only answers when tagged — no logging/welcoming, to avoid every
//   message being logged/welcomed twice since both bots see the same updates.

import { supabase } from "@/lib/supabase";
import {
  getBotIdentity, getTelegramUpdates, replyVia, sendChatMessage,
  type TelegramMessage, type TelegramUpdate,
} from "@/lib/integrations/telegram";
import { runChatTurn, type ChatMessage } from "@/lib/ai/chat";
import type { ToolName } from "@/lib/ai/tools";

export type Persona = {
  bot: "ops" | "cfo";
  token: string;
  systemPrompt: string;
  allowedTools: ToolName[];
  isPrimary: boolean; // owns message logging + member welcome
};

const TELEGRAM_FORMATTING_NOTE =
  "Format your reply for a Telegram chat: plain text, short lines, bullet points using \"•\", bold key numbers with <b>...</b> HTML tags only. Never use markdown (no #, no **, no | tables) — Telegram doesn't render it and it'll show as literal characters.";

// Explicit voice guidance — without this the model defaults to a dry,
// hedge-everything corporate-support register ("I don't have a tool for
// that... Is there a different question I can help with?"), which reads as
// evasive in a small team's group chat and erodes trust in the bot. The goal
// is a sharp colleague who answers straight, not a chatbot performing
// helpfulness.
const VOICE_NOTE =
  "Write like a sharp colleague replying in the team chat, not a support bot: natural phrasing, contractions, lead with the actual answer. No \"I apologize,\" no \"Is there anything else I can help with?\", no restating the question back. If something genuinely can't be answered from the data or tools available, say exactly what's missing and why in one direct sentence — don't just deflect to \"ask something else instead,\" that reads as unhelpful when the person is asking because they need to know.";

export const OPS_PERSONA_PROMPT = `You are Omnia's Chief of Staff assistant, in the ops Telegram group. You help with orders, dispatch, inventory, and payout-sync questions using read-only tools over live data — never guess a real number. For an exact clock-time window ("from 1pm yesterday to 1pm today"), "SMSA"/"DHL"/"international" orders, "OnTrack"/"local" orders, or a dispatch/shipped/delivered status question, use get_dispatch_report with courier_tier ("SMSA"/"DHL"/"international" → courier_tier=international; "OnTrack"/"local" → courier_tier=local — never the raw courier field, it's a checkout shipping-method label, not a carrier name, and will always return 0 for a carrier name search) — resolve the relative time to a concrete Dubai-local (UTC+4) UTC ISO range yourself first, and pass along its note about dispatched_with_live_awb under-counting real-world dispatches. You cannot write to Zoho, edit the dispatch sheet, or ship/invoice anything; if asked, say so and point them to the app. ${VOICE_NOTE} ${TELEGRAM_FORMATTING_NOTE}`;

export const CFO_PERSONA_PROMPT = `You are Omnia's CFO assistant, in the ops Telegram group. You answer revenue, COGS, profit, margin, settlement, and ad-spend questions for any date range using read-only tools over live data — never guess a real number, and always call get_financial_report for profit/margin/COGS questions rather than estimating. For anything with an exact clock-time window ("from 1pm yesterday to 1pm today"), "SMSA"/"DHL"/"international" orders, "OnTrack"/"local" orders, or a dispatch/shipped/delivered status question, use get_dispatch_report with courier_tier ("SMSA"/"DHL"/"international" → courier_tier=international; "OnTrack"/"local" → courier_tier=local — never the raw courier field, it's a checkout shipping-method label, not a carrier name, and will always return 0 for a carrier name search) — resolve the relative time to a concrete Dubai-local (UTC+4) UTC ISO range yourself first, and pass along its note about dispatched_with_live_awb under-counting real-world dispatches. State clearly whether a figure is paid-only or includes all order statuses. ${VOICE_NOTE} ${TELEGRAM_FORMATTING_NOTE}`;

const OPS_TOOLS: ToolName[] = ["get_sales_summary", "search_orders", "get_top_products", "get_low_stock_products", "get_payout_sync_status", "get_reconciliation_status", "get_dispatch_report"];
const CFO_TOOLS: ToolName[] = ["get_financial_report", "get_sales_summary", "get_daily_settlement_report", "get_reconciliation_status", "get_payout_sync_status", "get_ad_spend", "get_campaign_performance", "get_dispatch_report"];

// --- Pure helpers (unit tested) -------------------------------------------

export function isDirectedAtBot(message: TelegramMessage, botUsername: string, botUserId: number): boolean {
  const mentionsUsername = Boolean(message.text) && message.text!.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const repliesToBot = message.reply_to_message?.from?.id === botUserId;
  return mentionsUsername || repliesToBot;
}

export function stripMention(text: string, botUsername: string): string {
  return text.replace(new RegExp(`@${botUsername}`, "ig"), "").trim();
}

// --- Conversation memory ----------------------------------------------------
//
// Process-lifetime only (resets on redeploy/restart) — each @mention used to
// start a brand-new single-message conversation, so the bot forgot the
// question it was just asked the moment it answered. Keyed per bot persona +
// chat so ops and cfo keep independent threads even though they share a
// group. Capped to the same window size as the web dashboard's client-side
// history (app/api/chat/route.ts) for consistent behavior across both.
const MAX_HISTORY_MESSAGES = 12;
const conversationHistory = new Map<string, ChatMessage[]>();

function historyKey(bot: string, chatId: number): string {
  return `${bot}:${chatId}`;
}

function appendToHistory(key: string, question: string, answer: string) {
  const history = conversationHistory.get(key) ?? [];
  history.push({ role: "user", content: question }, { role: "assistant", content: answer });
  conversationHistory.set(key, history.slice(-MAX_HISTORY_MESSAGES));
}

// --- Orchestration ---------------------------------------------------------

async function getOffset(bot: string): Promise<number> {
  const { data } = await supabase.from("telegram_poll_state").select("last_update_id").eq("bot", bot).maybeSingle();
  return (data?.last_update_id ?? 0) + 1;
}

async function saveOffset(bot: string, lastUpdateId: number) {
  await supabase.from("telegram_poll_state").upsert({ bot, last_update_id: lastUpdateId, updated_at: new Date().toISOString() }, { onConflict: "bot" });
}

async function logGroupMessage(chatId: number, msg: TelegramMessage) {
  if (!msg.text) return;
  await supabase.from("group_messages").insert({
    chat_id: String(chatId), user_id: msg.from?.id ?? null, username: msg.from?.username ?? msg.from?.first_name ?? "",
    text: msg.text, sent_at: new Date().toISOString(),
  });
}

async function handleNewMembers(token: string, chatId: number, members: NonNullable<TelegramMessage["new_chat_members"]>) {
  for (const member of members) {
    if (member.is_bot) continue;
    await supabase.from("group_members").upsert({
      user_id: member.id, username: member.username ?? "", display_name: member.first_name ?? "",
      awaiting_role: true, joined_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    await sendChatMessage(
      token, chatId,
      `👋 Welcome${member.first_name ? ` ${member.first_name}` : ""}! What do you work on here (e.g. local dispatch, international shipping, warehouse/picking, finance)? Reply here and I'll remember it.`,
    );
  }
}

// Returns true if this message was consumed as a role-capture reply (so the
// caller skips further processing of it).
async function tryCaptureRole(msg: TelegramMessage): Promise<boolean> {
  if (!msg.from || !msg.text) return false;
  const { data } = await supabase.from("group_members").select("awaiting_role").eq("user_id", msg.from.id).maybeSingle();
  if (!data?.awaiting_role) return false;

  await supabase.from("group_members").update({
    role_description: msg.text, awaiting_role: false, updated_at: new Date().toISOString(),
  }).eq("user_id", msg.from.id);
  return true;
}

async function handleMessage(persona: Persona, botUserId: number, botUsername: string, chatId: number, msg: TelegramMessage) {
  if (msg.new_chat_members?.length) {
    if (persona.isPrimary) await handleNewMembers(persona.token, chatId, msg.new_chat_members);
    return;
  }

  if (persona.isPrimary) {
    const captured = await tryCaptureRole(msg);
    if (captured) {
      await sendChatMessage(persona.token, chatId, "Got it, thanks — noted.");
      return;
    }
    await logGroupMessage(chatId, msg);
  }

  if (!msg.text || !isDirectedAtBot(msg, botUsername, botUserId)) return;

  const question = stripMention(msg.text, botUsername);
  if (!question) return;

  const key = historyKey(persona.bot, chatId);
  try {
    const history = conversationHistory.get(key) ?? [];
    const answer = await runChatTurn([...history, { role: "user", content: question }], persona.systemPrompt, persona.allowedTools);
    appendToHistory(key, question, answer);
    await replyVia(persona.token, chatId, answer, msg.message_id);
  } catch (e) {
    console.error(`[telegram-listener:${persona.bot}] chat turn failed:`, (e as Error).message);
    await replyVia(persona.token, chatId, "Something went wrong answering that — try again in a moment.", msg.message_id);
  }
}

async function pollOnce(persona: Persona, botUserId: number, botUsername: string): Promise<void> {
  const offset = await getOffset(persona.bot);
  const updates: TelegramUpdate[] = await getTelegramUpdates(persona.token, offset, 25);
  if (updates.length === 0) return;

  for (const update of updates) {
    if (update.message) {
      await handleMessage(persona, botUserId, botUsername, update.message.chat.id, update.message);
    }
  }
  await saveOffset(persona.bot, updates[updates.length - 1].update_id);
}

export async function runListenerLoop(persona: Persona, shouldStop: () => boolean) {
  const identity = await getBotIdentity(persona.token);
  if (!identity?.username) {
    console.error(`[telegram-listener:${persona.bot}] getMe failed — listener not starting`);
    return;
  }
  console.log(`[telegram-listener:${persona.bot}] listening as @${identity.username}`);

  while (!shouldStop()) {
    try {
      await pollOnce(persona, identity.id, identity.username);
    } catch (e) {
      console.error(`[telegram-listener:${persona.bot}] poll cycle failed:`, (e as Error).message);
      await new Promise((r) => setTimeout(r, 5000)); // back off before retrying after an error
    }
  }
}

export function buildPersonas(): Persona[] {
  const personas: Persona[] = [];
  if (process.env.TELEGRAM_BOT_TOKEN) {
    personas.push({ bot: "ops", token: process.env.TELEGRAM_BOT_TOKEN, systemPrompt: OPS_PERSONA_PROMPT, allowedTools: OPS_TOOLS, isPrimary: true });
  }
  if (process.env.TELEGRAM_CFO_BOT_TOKEN) {
    personas.push({ bot: "cfo", token: process.env.TELEGRAM_CFO_BOT_TOKEN, systemPrompt: CFO_PERSONA_PROMPT, allowedTools: CFO_TOOLS, isPrimary: false });
  }
  return personas;
}
