import { supabase } from "@/lib/supabase";
async function main() {
  for (const t of ["payouts","payout_transactions","payout_ref_links","recon_lines","bank_lines","settlement_records","uploaded_files"]) {
    const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
    const risk = (count ?? 0) >= 1000 ? "  <-- TRUNCATED TODAY" : (count ?? 0) > 800 ? "  <-- near the cap" : "";
    console.log(`${t.padEnd(20)} ${String(count ?? "?").padStart(7)}${risk}${error ? " ERR "+error.message : ""}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
