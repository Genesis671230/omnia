import { supabase } from "@/lib/supabase";

// Wraps the SQL try_consume_token function. Non-blocking: returns false when
// the bucket is empty, caller enqueues a retry instead of waiting. This is
// deliberate — waiting inside a webhook receiver would eat the maxDuration
// budget and stack up under load.
export async function tryConsumeToken(channel: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_consume_token", { p_channel: channel });
  if (error) {
    console.error("[rate-limit] rpc failed:", error.message);
    return false;
  }
  return data === true;
}

// For scripts that legitimately need to wait (bulk sync, backfill). Never
// call this from a request handler — spin loops on serverless burn money.
export async function consumeTokenBlocking(channel: string, maxWaitMs = 30_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    if (await tryConsumeToken(channel)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}