import { supabase } from "@/lib/supabase";


async function main(){

    // Add to same cron or /api/workers/pending-zoho-timeout — every 5 min.
    const { data: stale } = await supabase.from("pending_zoho_sync")
    .select("sku, origin_channel, order_ref, created_at")
    .is("cleared_at", null)
    .lt("created_at", new Date(Date.now() - 30 * 60_000).toISOString()); // 30m Zoho lag = broken
    
    for (const row of stale ?? []) {
        await supabase.from("stock_alerts").upsert({
            sku: row.sku, kind: "zoho_lag_exceeded",
            detail: { origin: row.origin_channel, order_ref: row.order_ref, waited_min: 30 },
        }, { onConflict: "sku,kind" });
    }
    
}
main()