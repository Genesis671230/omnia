// One-time repair: re-derive orders.gateway from gateway_raw with the current
// classifier (lib/gateways.ts). The WhatsApp store spells its method
// "Pay By Tammara"; before the classifier accepted that spelling those orders
// were stored as Unclassified, so they never matched a Tamara payout and read
// "payout file not uploaded" on the dashboard forever.
//
// Only rows whose classification actually changes are written. Idempotent.
//
// Run:  npx tsx --env-file=.env.local scripts/reclassify-order-gateways.ts           (dry run)
//       npx tsx --env-file=.env.local scripts/reclassify-order-gateways.ts --apply   (writes)
import { supabase, selectAllPages } from "@/lib/supabase";
import { classifyOrderGateway } from "@/lib/gateways";

const apply = process.argv.includes("--apply");

(async () => {
  const rows = await selectAllPages<{ uid: string; order_number: string; gateway: string; gateway_raw: string; gross_aed: number }>(
    (from, to) => supabase.from("orders").select("uid, order_number, gateway, gateway_raw, gross_aed").range(from, to),
    "orders select",
  );
  const changes = rows
    .map((r) => ({ ...r, next: classifyOrderGateway(r.gateway_raw || "") }))
    .filter((r) => r.gateway_raw && r.next !== r.gateway && r.next !== "Unclassified");

  const byMove = new Map<string, { n: number; aed: number }>();
  for (const c of changes) {
    const k = `${c.gateway} -> ${c.next}  ("${c.gateway_raw}")`;
    const m = byMove.get(k) ?? { n: 0, aed: 0 };
    m.n++; m.aed += Number(c.gross_aed) || 0;
    byMove.set(k, m);
  }
  console.log(`${rows.length} orders scanned, ${changes.length} to reclassify`);
  for (const [k, v] of byMove) console.log(`  ${String(v.n).padStart(5)}  AED ${v.aed.toFixed(2).padStart(12)}  ${k}`);

  if (!apply) { console.log("\nDRY RUN — nothing written. Re-run with --apply to write."); return; }

  // Grouped by target gateway: one update per group of uids, 200 at a time.
  const byTarget = new Map<string, string[]>();
  for (const c of changes) byTarget.set(c.next, [...(byTarget.get(c.next) ?? []), c.uid]);
  for (const [gateway, uids] of byTarget) {
    for (let i = 0; i < uids.length; i += 200) {
      const { error } = await supabase.from("orders").update({ gateway }).in("uid", uids.slice(i, i + 200));
      if (error) throw new Error(`update failed: ${error.message}`);
    }
  }
  console.log(`\nWrote ${changes.length} rows.`);
})().catch((e) => { console.error(e); process.exit(1); });
