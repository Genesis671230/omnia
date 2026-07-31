// app/api/workers/reconcile-drain/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { reconcile } from "@/lib/reconciler";

export const maxDuration = 300;

export async function GET() {
  const workerId = `vercel-${Date.now()}`;
  const startedAt = Date.now();
  let processed = 0, failed = 0;

  // Drain in small batches. FOR UPDATE SKIP LOCKED = concurrent-safe.
  while (Date.now() - startedAt < 250_000) {   // leave 50s headroom on 300s cap
    const { data: batch } = await supabase.rpc("claim_reconcile_tasks", {
      p_worker: workerId, p_limit: 25,
    });
    if (!batch || batch.length === 0) break;

    for (const task of batch) {
      try {
        await reconcile(task.sku, { trigger: `retry:${task.reason}` });
        await supabase.from("reconcile_tasks")
          .update({ completed_at: new Date().toISOString() }).eq("id", task.id);
        processed++;
      } catch (e) {
        await supabase.from("reconcile_tasks")
          .update({ claimed_at: null, attempts: task.attempts + 1,
                    last_error: (e as Error).message.slice(0, 500) })
          .eq("id", task.id);
        failed++;
      }
    }
  }

  return NextResponse.json({ workerId, processed, failed });
}