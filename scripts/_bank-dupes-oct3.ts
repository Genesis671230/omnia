import { supabase } from "@/lib/supabase";
(async () => {
  const B = "BANK-rak-house-of-omnia-2026-10-08-Transaction history_8_10_2026.pdf";
  const { data } = await supabase.from("bank_lines").select("*").eq("batch_id", B);
  const rows = data!;
  const st = new Map<string, number>(); for (const r of rows) st.set(`${r.status}|${r.matched_payout_id ? "matched" : "-"}|${r.zoho_description ? "zdesc" : "-"}`, (st.get(`${r.status}|${r.matched_payout_id ? "matched" : "-"}|${r.zoho_description ? "zdesc" : "-"}`) ?? 0) + 1);
  console.log("rak 8_10 batch", rows.length, st);
  console.log("mentions SIB acct", rows.filter((r) => /0012043598001/.test(r.description)).length, "mentions RAK acct", rows.filter((r) => /0333190982001|982001/.test(r.description)).length);
  const ids = rows.map((r) => r.id);
  // anything referencing these lines?
  for (const t of ["bank_line_postings", "zoho_bank_postings", "recon_lines", "bank_line_matches"]) {
    const { data: d, error } = await supabase.from(t).select("*").in("bank_line_id", ids).limit(5);
    console.log(t, error ? error.message : d!.length);
  }
  const { data: sib } = await supabase.from("bank_lines").select("*").eq("statement_account", "sib-omniastores").gte("statement_date", "2026-10-01");
  const k = (r: any) => [r.statement_date.slice(0,10), r.direction, Number(r.amount).toFixed(2), r.reference].join("|");
  const sk = new Set(sib!.map(k));
  const extra = rows.filter((r) => !sk.has(k(r)));
  console.log("rak rows not in sib:", extra.length);
  for (const r of extra) console.log(" ", k(r), String(r.description).slice(0, 60));
  const sst = new Map<string, number>(); for (const r of sib!) sst.set(`${r.status}|${r.matched_payout_id ? "matched" : "-"}`, (sst.get(`${r.status}|${r.matched_payout_id ? "matched" : "-"}`) ?? 0) + 1);
  console.log("sib oct status", sst);
})();
