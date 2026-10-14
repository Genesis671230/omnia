import { supabase } from "@/lib/supabase";
(async () => {
  const { data, error } = await supabase.from("bank_lines").select("*").gte("statement_date", "2026-10-01").lte("statement_date", "2026-10-06").order("statement_date");
  if (error) { console.log(error); return; }
  console.log("rows", data!.length, "cols", Object.keys(data![0] ?? {}).join(","));
  const by = new Map<string, any[]>();
  for (const r of data!) {
    const k = [r.statement_account, r.statement_date, r.direction, Number(r.amount).toFixed(2)].join("|");
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const accts = new Map<string, number>();
  for (const r of data!) accts.set(`${r.statement_account}|${r.batch_id}|${r.source ?? ""}`, (accts.get(`${r.statement_account}|${r.batch_id}|${r.source ?? ""}`) ?? 0) + 1);
  console.log([...accts]);
  let n = 0;
  for (const [k, rows] of by) if (rows.length > 1) {
    n++;
    if (n <= 15) { console.log("\n", k); for (const r of rows) console.log("  ", r.id, r.batch_id, r.reference, "|", String(r.narration).slice(0, 70), "|", r.status, r.zoho_status ?? "", r.created_at); }
  }
  console.log("dup groups", n);
})();
