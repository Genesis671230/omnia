// Builds today's overdue follow-up from the last 30 days of admin money and
// sends it — Telegram (CFO bot) and, once a day above a threshold, a call.

import { buildAdminMoney } from "@/lib/dashboard/admin-money.service";
import { addDubaiDays, dubaiToday } from "@/lib/dubai-day";
import { getSetting } from "@/lib/settings";
import { sendCfoTelegramMessage, telegramCfoConfigured } from "@/lib/integrations/telegram";
import { placeVoiceCall, voiceCallConfigured } from "@/lib/integrations/voice-call";
import { overdueCallScript, overdueMessage } from "./overdue-followup";

// 30 days: the live chase window. Older gaps (late Aug 2026: Telr/Tabby/Tamara
// payout files never loaded, ~AED 413k) are history to clear in
// Reconciliation, not something to ping the group about twice a day.
export const LOOKBACK_DAYS = 30;

export async function buildOverdueFollowup() {
  const today = dubaiToday();
  const v = await buildAdminMoney(addDubaiDays(today, -LOOKBACK_DAYS), today);
  const overdueTotal = v.overdue.reduce((a, g) => a + g.amount, 0);
  return {
    today,
    overdue: v.overdue,
    overdueTotal: Math.round(overdueTotal * 100) / 100,
    pendingTotal: v.totals.awaiting,
    message: overdueMessage(today, v.overdue, v.orders, v.totals.awaiting),
    callScript: v.overdue.length ? overdueCallScript(v.overdue) : null,
  };
}

export async function callSettings() {
  const [to, min] = await Promise.all([
    getSetting<string>("alerts.overdue_call_to").catch(() => ""),
    getSetting<number>("alerts.overdue_call_min_aed").catch(() => 5000),
  ]);
  return { to: (to || "").trim(), minAed: typeof min === "number" ? min : 5000, configured: voiceCallConfigured() };
}

export async function sendOverdueTelegram(): Promise<{ ok: boolean; sent: boolean; error?: string; overdueTotal: number }> {
  const f = await buildOverdueFollowup();
  if (!f.message) return { ok: true, sent: false, overdueTotal: 0 };
  if (!telegramCfoConfigured()) return { ok: false, sent: false, error: "Telegram CFO bot is not configured", overdueTotal: f.overdueTotal };
  const r = await sendCfoTelegramMessage(f.message);
  return r.ok ? { ok: true, sent: true, overdueTotal: f.overdueTotal } : { ok: false, sent: false, error: r.error, overdueTotal: f.overdueTotal };
}

export async function placeOverdueCall(opts: { force?: boolean } = {}): Promise<{ ok: boolean; called: boolean; error?: string; reason?: string }> {
  const [f, c] = await Promise.all([buildOverdueFollowup(), callSettings()]);
  if (!c.to) return { ok: true, called: false, reason: "No phone number set (Settings → Daily overdue call)" };
  if (!f.callScript) return { ok: true, called: false, reason: "Nothing overdue" };
  if (!opts.force && f.overdueTotal < c.minAed) return { ok: true, called: false, reason: `Overdue AED ${f.overdueTotal} is under the AED ${c.minAed} call threshold` };
  const r = await placeVoiceCall(c.to, f.callScript);
  return r.ok ? { ok: true, called: true } : { ok: false, called: false, error: r.error };
}
