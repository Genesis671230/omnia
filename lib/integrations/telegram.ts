// Telegram bot notifications — internal ops alerts (e.g. "AWB issued for
// #12345"). Not configured yet: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are
// absent from .env, so this silently no-ops until they're supplied, same
// pattern as the ad platform connectors' `configured()` guards.

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegramMessage(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!telegramConfigured()) return { ok: false, error: "Telegram is not configured" };
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) return { ok: false, error: json.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
