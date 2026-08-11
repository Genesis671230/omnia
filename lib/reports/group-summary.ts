// Daily recap of the ops Telegram group's raw chat log (group_messages,
// populated by lib/telegram/listener.ts) — the "AI has memory of what the
// team discussed" piece. Saved to group_daily_summaries regardless of
// whether it's also posted to the group, so later questions ("what did we
// decide yesterday") have something to read even without re-scanning the
// full transcript.

import { supabase } from "@/lib/supabase";
import { dubaiDayBoundsUtc } from "@/lib/reports/cfo-digest";
import { runChatTurn } from "@/lib/ai/chat";

const SUMMARIZER_PROMPT = "You summarize internal team chat logs concisely and factually. Do not invent details not present in the transcript.";

export async function buildAndSaveGroupSummary(dateIsoDay: string): Promise<{ summary: string; messageCount: number } | null> {
  const { fromUtc, toUtc } = dubaiDayBoundsUtc(dateIsoDay);
  const { data, error } = await supabase
    .from("group_messages")
    .select("username, text, sent_at")
    .gte("sent_at", fromUtc)
    .lt("sent_at", toUtc)
    .order("sent_at", { ascending: true });
  if (error) throw new Error(`group_messages read failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  const transcript = data.map((m) => `${m.username || "someone"}: ${m.text}`).join("\n");
  const prompt = `Summarize this Omnia ops Telegram group conversation from ${dateIsoDay} in 3-6 short bullet points — decisions made, issues raised, who did what. Be concise and factual, plain text with "•" bullets, no markdown headers.\n\nTranscript:\n${transcript}`;

  const summary = await runChatTurn([{ role: "user", content: prompt }], SUMMARIZER_PROMPT, []);

  const { error: saveError } = await supabase.from("group_daily_summaries").upsert(
    { date_iso_day: dateIsoDay, summary, message_count: data.length, created_at: new Date().toISOString() },
    { onConflict: "date_iso_day" },
  );
  if (saveError) throw new Error(`group_daily_summaries save failed: ${saveError.message}`);

  return { summary, messageCount: data.length };
}
