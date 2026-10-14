// Dry run (default) / --apply: the 8 Oct SIB PDF was filed under RAK House of Omnia.
// Every line becomes SIB; where SIB already holds the same transaction, one copy goes.
import { supabase } from "@/lib/supabase";
import { dedupeKey } from "@/lib/parsers/bank-dedupe";
const APPLY = process.argv.includes("--apply");
const B = "BANK-rak-house-of-omnia-2026-10-08-Transaction history_8_10_2026.pdf";
const REF_TABLES = ["settlement_records", "zoho_postings", "zoho_bank_txn_postings", "bank_line_zoho_status", "refund_postings", "payout_reverts", "zoho_entry_deletions"];
const k = (r: any) => dedupeKey({ date: r.statement_date.slice(0, 10), direction: r.direction, amount: Number(r.amount), reference: r.reference, narration: r.description, account: "sib-omniastores" } as any);
async function refs(id: string) {
  const out: Record<string, number> = {};
  for (const t of REF_TABLES) {
    const { count, error } = await supabase.from(t).select("bank_line_id", { count: "exact", head: true }).eq("bank_line_id", id);
    if (error) throw new Error(`${t}: ${error.message}`);
    if (count) out[t] = count;
  }
  const { count } = await supabase.from("payouts").select("id", { count: "exact", head: true }).eq("bank_line_id", id);
  if (count) out.payouts = count;
  const { data: rl } = await supabase.from("recon_lines").select("id,payout_id,match_status,confirmed_at").eq("bank_line_id", id).maybeSingle();
  return { tables: out, recon: rl };
}
const score = (x: Awaited<ReturnType<typeof refs>>) => Object.keys(x.tables).length * 10 + (x.recon?.confirmed_at ? 5 : 0) + (x.recon?.payout_id ? 2 : 0);
(async () => {
  const { data: rak } = await supabase.from("bank_lines").select("*").eq("batch_id", B);
  const { data: sib } = await supabase.from("bank_lines").select("*").eq("statement_account", "sib-omniastores").gte("statement_date", "2026-09-30");
  // pair by key, one-to-one (sibling fee rows share a key with each other only by ref, so multiplicity matters)
  const pool = new Map<string, any[]>();
  for (const s of sib!) pool.set(k(s), [...(pool.get(k(s)) ?? []), s]);
  const del: { id: string; why: string }[] = [];
  const relabel: any[] = [];
  const blocked: string[] = [];
  for (const r of rak!) {
    const twin = pool.get(k(r))?.shift();
    if (!twin) { relabel.push(r); continue; }
    const [a, b] = [await refs(r.id), await refs(twin.id)];
    const keepRak = score(a) > score(b);
    const lose = keepRak ? { row: twin, x: b } : { row: r, x: a };
    if (Object.keys(lose.x.tables).length) { blocked.push(`${k(r)} BOTH copies carry postings: rak ${JSON.stringify(a)} sib ${JSON.stringify(b)}`); continue; }
    del.push({ id: lose.row.id, why: `${k(r)} drop ${keepRak ? "SIB" : "RAK"} copy (recon ${lose.x.recon?.match_status ?? "-"})` });
    if (keepRak) relabel.push(r);
    if (Object.keys(a.tables).length || Object.keys(b.tables).length) console.log("postings", k(r), "rak", JSON.stringify(a.tables), "sib", JSON.stringify(b.tables));
  }
  console.log(`delete ${del.length}, move to SIB ${relabel.length}, blocked ${blocked.length}`);
  for (const d of del) console.log(" DEL", d.why);
  for (const b of blocked) console.log(" BLOCKED", b);
  // Blocked pairs (settlements on both copies) are left untouched for review.
  if (!APPLY) return;
  const ids = del.map((d) => d.id);
  console.log("deleting", ids.length);
  await supabase.from("recon_lines").delete().in("bank_line_id", ids).throwOnError();
  await supabase.from("bank_lines").delete().in("id", ids).throwOnError();
  for (const r of relabel) {
    const key = k(r);
    await supabase.from("bank_lines").update({ statement_account: "sib-omniastores", dedupe_key: key, batch_id: B.replace("rak-house-of-omnia-", "") }).eq("id", r.id).throwOnError();
  }
  console.log("applied");
})().catch((e) => { console.error(e); process.exit(1); });
