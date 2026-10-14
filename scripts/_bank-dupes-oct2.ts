import { supabase } from "@/lib/supabase";
(async () => {
  const { data, error } = await supabase.from("bank_lines").select("id,statement_date,direction,amount,reference,description,statement_account,batch_id,status,matched_payout_id,dedupe_key,zoho_description").gte("statement_date", "2026-09-25").lte("statement_date", "2026-10-09").order("statement_date");
  if (error) { console.log(error); return; }
  const k = (r: any) => [r.statement_date.slice(0,10), r.direction, Number(r.amount).toFixed(2), r.reference, String(r.description).replace(/\s+/g," ").slice(0,50)].join("|");
  const sib = data!.filter((r) => r.statement_account === "sib-omniastores");
  const rak = data!.filter((r) => r.statement_account === "rak-house-of-omnia");
  const batches = new Map<string, {n:number; min:string; max:string}>();
  for (const r of data!) { const b = batches.get(r.batch_id) ?? { n: 0, min: r.statement_date, max: r.statement_date }; b.n++; if (r.statement_date < b.min) b.min = r.statement_date; if (r.statement_date > b.max) b.max = r.statement_date; batches.set(r.batch_id, b); }
  console.log(batches);
  const sibKeys = new Map<string, number>(); for (const r of sib) sibKeys.set(k(r), (sibKeys.get(k(r)) ?? 0) + 1);
  let both = 0; for (const r of rak) if (sibKeys.has(k(r))) both++;
  console.log("sib", sib.length, "rak", rak.length, "rak rows also in sib (exact)", both);
  for (const r of rak.slice(0, 12)) console.log("RAK", k(r), r.status, r.matched_payout_id ? "M" : "");
  for (const r of sib.filter(r=>r.statement_date>="2026-10-01").slice(0, 12)) console.log("SIB", k(r), r.status);
})();
