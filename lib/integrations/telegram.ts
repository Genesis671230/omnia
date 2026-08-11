// Telegram bot notifications — internal ops alerts (e.g. "AWB issued for
// #12345"), the CFO digest persona (separate bot, same group), and the
// long-poll listener (lib/telegram/listener.ts) that lets both bots respond
// to @mentions. Each no-ops until its own token/chat env vars are supplied,
// same pattern as the ad platform connectors' `configured()` guards.

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export function telegramCfoConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_CFO_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function sendVia(
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId, allow_sending_without_reply: true } : {}),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) return { ok: false, error: json.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function sendTelegramMessage(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!telegramConfigured()) return { ok: false, error: "Telegram is not configured" };
  return sendVia(process.env.TELEGRAM_BOT_TOKEN!, process.env.TELEGRAM_CHAT_ID!, text);
}

export async function sendCfoTelegramMessage(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!telegramCfoConfigured()) return { ok: false, error: "Telegram CFO bot is not configured" };
  return sendVia(process.env.TELEGRAM_CFO_BOT_TOKEN!, process.env.TELEGRAM_CHAT_ID!, text);
}

// --- Listener primitives (long-polling — no public URL required) ---------

export type TelegramUser = { id: number; is_bot: boolean; username?: string; first_name?: string };
export type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  from?: TelegramUser;
  text?: string;
  new_chat_members?: TelegramUser[];
  reply_to_message?: TelegramMessage;
};
export type TelegramUpdate = { update_id: number; message?: TelegramMessage };

export async function getBotIdentity(token: string): Promise<TelegramUser | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = await res.json();
    return json.ok ? (json.result as TelegramUser) : null;
  } catch {
    return null;
  }
}

// Long-poll: blocks server-side (Telegram holds the connection) up to
// `timeoutSeconds`, returning as soon as an update arrives, or an empty
// array on timeout. This is what makes polling not hammer the API.
export async function getTelegramUpdates(token: string, offset: number, timeoutSeconds = 25): Promise<TelegramUpdate[]> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, timeout: timeoutSeconds, allowed_updates: ["message"] }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || `getUpdates HTTP ${res.status}`);
  return json.result as TelegramUpdate[];
}

export async function replyVia(token: string, chatId: number, text: string, replyToMessageId: number) {
  return sendVia(token, String(chatId), text, replyToMessageId);
}

export async function sendChatMessage(token: string, chatId: number, text: string) {
  return sendVia(token, String(chatId), text);
}
