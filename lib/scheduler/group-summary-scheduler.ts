// Once-daily group chat recap — posts to the group via the ops bot and
// saves to group_daily_summaries. Dedup via webhook_inbox
// (provider="group-daily-summary", webhook_id=dateIsoDay), same
// check-and-mark-then-rollback-on-failure pattern as cfo-digest-scheduler.ts.

import { supabase } from "@/lib/supabase";
import { alreadyProcessed } from "@/lib/webhook-plumbing";
import { buildAndSaveGroupSummary } from "@/lib/reports/group-summary";
import { sendTelegramMessage, telegramConfigured } from "@/lib/integrations/telegram";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_POST_HOUR_DUBAI = 22; // after the CFO digest (21:00) and both courier cutoffs
const DUBAI_OFFSET_MINUTES = 4 * 60;
const INITIAL_DELAY_MS = 45_000;

const g = globalThis as unknown as { __groupSummaryTimer?: NodeJS.Timeout };

function dubaiNow(): { dateIsoDay: string; hour: number } {
  const dubai = new Date(Date.now() + DUBAI_OFFSET_MINUTES * 60_000);
  return { dateIsoDay: dubai.toISOString().slice(0, 10), hour: dubai.getUTCHours() };
}

async function maybePostToday() {
  if (!telegramConfigured()) return;

  const postHour = Math.max(0, Math.min(23, parseInt(process.env.GROUP_SUMMARY_HOUR_DUBAI || "", 10) || DEFAULT_POST_HOUR_DUBAI));
  const { dateIsoDay, hour } = dubaiNow();
  if (hour < postHour) return;

  if (await alreadyProcessed("group-daily-summary", dateIsoDay)) return;

  try {
    const result = await buildAndSaveGroupSummary(dateIsoDay);
    if (!result) return; // no messages that day — nothing to post, mark stays (correctly, nothing to retry)
    const text = `🗒 <b>Daily recap — ${dateIsoDay}</b> (${result.messageCount} messages)\n${result.summary}`;
    const sendResult = await sendTelegramMessage(text);
    if (!sendResult.ok) throw new Error(sendResult.error);
  } catch (e) {
    console.error(`[group-summary] failed to build/post ${dateIsoDay}:`, (e as Error).message);
    await supabase.from("webhook_inbox").delete().eq("provider", "group-daily-summary").eq("webhook_id", dateIsoDay);
  }
}

export function startGroupSummaryScheduler() {
  if (g.__groupSummaryTimer) return;

  const tick = () => { void maybePostToday(); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__groupSummaryTimer = setInterval(tick, CHECK_INTERVAL_MS);

  console.log("[group-summary] persistent daily group recap scheduler started — checks every 5m, posts once past the configured hour (default 10pm Dubai)");
}
