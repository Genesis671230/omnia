import { supabase } from "@/lib/supabase";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
async function main() {
  const { count: txCount } = await supabase.from("payout_transactions").select("*", { count: "exact", head: true });
  const { count: orderCount } = await supabase.from("orders").select("*", { count: "exact", head: true });
  const { count: bankCount } = await supabase.from("bank_lines").select("*", { count: "exact", head: true });
  console.log("payout_transactions rows:", txCount);
  console.log("orders rows:", orderCount);
  console.log("bank_lines rows:", bankCount);

  const { data: plain } = await supabase.from("payout_transactions").select("payout_id, order_ref");
  console.log("\nrows returned by an unpaginated select:", plain?.length);

  const viaRepo = await PayoutsRepository.listWithRefs();
  const totalRefs = viaRepo.reduce((n, p) => n + p.order_refs.length, 0);
  const withRefs = viaRepo.filter(p => p.order_refs.length > 0).length;
  console.log(`listWithRefs(): ${viaRepo.length} payouts, ${withRefs} with refs, ${totalRefs} refs total`);
  const target = viaRepo.find(p => p.id === "Tabby20260831SAR-ORPL");
  console.log("Tabby20260831SAR-ORPL refs via repo:", target?.order_refs.length);
}
main().catch(e => { console.error(e); process.exit(1); });
