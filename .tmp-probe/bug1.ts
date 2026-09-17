import { runReconciliation } from "@/lib/reconciliation/engine";
import { supabase } from "@/lib/supabase";
async function main() {
  const lines = await runReconciliation();
  const l = lines.find(x => x.reference === "DSZ26248HBBCBJFC" || Number(x.bankAmount) === 16122.22);
  if (!l) { console.log("line not found"); return; }
  console.log("state:", l.state, "| provider:", l.provider, "| confirmedBy:", l.confirmedBy);
  console.log("payout:", l.payout?.id, "net", l.payout?.net, "fxSource", l.payout?.fxSource);
  console.log("variance:", l.variance);
  console.log("resolvedOrders:", l.resolvedOrders.length, l.resolvedOrders.slice(0,5));
  console.log("unresolvedRefs:", l.unresolvedRefs.length, l.unresolvedRefs.slice(0,10));
  console.log("transactions:", l.transactions.length);

  const { data: tx } = await supabase.from("payout_transactions").select("order_ref").eq("payout_id", "Tabby20260831SAR-ORPL");
  const refs = (tx ?? []).map(t => t.order_ref);
  console.log("\npayout refs in DB:", refs.length, refs.slice(0, 12));

  const { data: orders } = await supabase.from("orders").select("order_number").limit(20000);
  const nums = new Set((orders ?? []).map(o => o.order_number));
  console.log("orders in db:", nums.size);
  const hits = refs.filter(r => nums.has(r));
  console.log("refs that match an order_number exactly:", hits.length);
  console.log("sample order_numbers:", [...nums].slice(0, 12));
}
main().catch(e => { console.error(e); process.exit(1); });
