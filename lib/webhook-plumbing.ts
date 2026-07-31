import { supabase } from "@/lib/supabase";

export async function alreadyProcessed(provider: string, webhookId: string): Promise<boolean> {
  const { error } = await supabase.from("webhook_inbox")
    .insert({ provider, webhook_id: webhookId });
  // Unique violation = already processed. Any other error, be conservative and process.
  if (!error) return false;
  return error.code === "23505";
}

export async function markHeartbeat(source: string, topic: string, lastId?: string) {
  const nowIso = new Date().toISOString();
  await supabase.rpc("bump_heartbeat", { p_source: source, p_topic: topic, p_id: lastId ?? null, p_ts: nowIso });
}