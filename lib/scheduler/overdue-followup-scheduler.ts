// Overdue payment chaser — the CFO bot posts overdue gateway money to the
// Telegram group at 10:00 and 16:00 Dubai, and once a day (from 11:00) places
// a phone call when the overdue total is above the configured threshold.
// Dedup rides webhook_inbox like the CFO digest, so restarts never repeat a
// slot; a failed send rolls its mark back so the next 5-minute check retries.

import { supabase } from "@/lib/supabase";
import { alreadyProcessed } from "@/lib/webhook-plumbing";
import { getSetting } from "@/lib/settings";
import { telegramCfoConfigured } from "@/lib/integrations/telegram";
import { dubaiToday } from "@/lib/dubai-day";
import { callSettings, placeOverdueCall, sendOverdueTelegram } from "@/lib/alerts/overdue-followup.service";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 60_000;
export const TELEGRAM_SLOTS_DUBAI = [10, 16];
export const CALL_HOUR_DUBAI = 11;

const g = globalThis as unknown as { __overdueFollowupTimer?: NodeJS.Timeout };

const dubaiHour = () => new Date(Date.now() + 4 * 3600_000).getUTCHours();

async function unmark(provider: string, id: string) {
  await supabase.from("webhook_inbox").delete().eq("provider", provider).eq("webhook_id", id);
}

async function tick() {
  const enabled = await getSetting<boolean>("alerts.overdue_followups").catch(() => true);
  if (enabled === false) return;
  const day = dubaiToday();
  const hour = dubaiHour();

  const slot = [...TELEGRAM_SLOTS_DUBAI].reverse().find((h) => hour >= h);
  // Only the latest slot that has passed — a server that starts at 17:00 posts once, not twice.
  if (slot != null && telegramCfoConfigured() && !(await alreadyProcessed("overdue-followup", `${day}-${slot}`))) {
    try {
      const r = await sendOverdueTelegram();
      if (!r.ok) throw new Error(r.error);
    } catch (e) {
      console.error(`[overdue-followup] telegram ${day}-${slot} failed:`, (e as Error).message);
      await unmark("overdue-followup", `${day}-${slot}`);
    }
  }

  if (hour >= CALL_HOUR_DUBAI) {
    const c = await callSettings();
    if (c.to && c.configured && !(await alreadyProcessed("overdue-call", day))) {
      try {
        const r = await placeOverdueCall();
        if (!r.ok) throw new Error(r.error);
        if (r.reason) console.log(`[overdue-followup] no call today: ${r.reason}`);
      } catch (e) {
        console.error(`[overdue-followup] call ${day} failed:`, (e as Error).message);
        await unmark("overdue-call", day);
      }
    }
  }
}

export function startOverdueFollowupScheduler() {
  if (g.__overdueFollowupTimer) return;
  const run = () => { void tick().catch((e) => console.error("[overdue-followup]", (e as Error).message)); };
  setTimeout(run, INITIAL_DELAY_MS);
  g.__overdueFollowupTimer = setInterval(run, CHECK_INTERVAL_MS);
  console.log("[overdue-followup] overdue payment chaser started — Telegram at 10:00/16:00 Dubai, daily call from 11:00 when configured");
}
