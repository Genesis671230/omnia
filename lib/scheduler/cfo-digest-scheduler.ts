// Once-daily CFO digest — checks every few minutes whether today's (Dubai
// calendar day) digest has already gone out; if not and it's past the
// configured posting hour, builds and sends it. Dedup rides webhook_inbox
// (provider="cfo-digest", webhook_id=dateIsoDay) so a restart/redeploy
// never double-posts the same day's numbers.

import { supabase } from "@/lib/supabase";
import { alreadyProcessed } from "@/lib/webhook-plumbing";
import { buildCfoDigest, buildCfoDigestExtras, formatCfoDigest } from "@/lib/reports/cfo-digest";
import { sendCfoTelegramMessage, telegramCfoConfigured } from "@/lib/integrations/telegram";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // poll every 5 minutes for the posting hour
const DEFAULT_POST_HOUR_DUBAI = 21; // 9pm Dubai — after both courier cutoffs, day is effectively closed
const DUBAI_OFFSET_MINUTES = 4 * 60;
const INITIAL_DELAY_MS = 30_000;

const g = globalThis as unknown as { __cfoDigestTimer?: NodeJS.Timeout };

function dubaiNow(): { dateIsoDay: string; hour: number } {
  const dubai = new Date(Date.now() + DUBAI_OFFSET_MINUTES * 60_000);
  return { dateIsoDay: dubai.toISOString().slice(0, 10), hour: dubai.getUTCHours() };
}

async function maybePostToday() {
  if (!telegramCfoConfigured()) return;

  const postHour = Math.max(0, Math.min(23, parseInt(process.env.CFO_DIGEST_HOUR_DUBAI || "", 10) || DEFAULT_POST_HOUR_DUBAI));
  const { dateIsoDay, hour } = dubaiNow();
  if (hour < postHour) return;

  // Insert-based check-and-mark — same race-safety pattern as the order
  // alert dedup: only one process ever gets past this for a given day.
  if (await alreadyProcessed("cfo-digest", dateIsoDay)) return;

  try {
    const [digest, extras] = await Promise.all([buildCfoDigest(dateIsoDay), buildCfoDigestExtras(dateIsoDay)]);
    const result = await sendCfoTelegramMessage(formatCfoDigest(digest, extras));
    if (!result.ok) throw new Error(result.error);
  } catch (e) {
    console.error(`[cfo-digest] failed to build/post ${dateIsoDay}:`, (e as Error).message);
    // Roll back the mark so the next 5-minute check retries — otherwise a
    // transient failure means that day's digest never goes out.
    await supabase.from("webhook_inbox").delete().eq("provider", "cfo-digest").eq("webhook_id", dateIsoDay);
  }
}

export function startCfoDigestScheduler() {
  if (g.__cfoDigestTimer) return; // already running

  const tick = () => { void maybePostToday(); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__cfoDigestTimer = setInterval(tick, CHECK_INTERVAL_MS);

  console.log("[cfo-digest] persistent CFO daily digest scheduler started — checks every 5m, posts once past the configured hour (default 9pm Dubai)");
}
