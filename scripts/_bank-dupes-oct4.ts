import { supabase } from "@/lib/supabase";
(async () => {
  const B = "BANK-rak-house-of-omnia-2026-10-08-Transaction history_8_10_2026.pdf";
  const { data: rows } = await supabase.from("bank_lines").select("id,statement_date,direction,amount,reference").eq("batch_id", B);
  const ids = rows!.map((r) => r.id);
  const { data: rl } = await supabase.from("recon_lines").select("id,gateway,payout_id,bank_line_id,match_status,confirmed_at,force_booked_at").in("bank_line_id", ids);
  const k = (r: any) => [r.statement_date.slice(0,10), r.direction, Number(r.amount).toFixed(2), r.reference].join("|");
  const { data: sib } = await supabase.from("bank_lines").select("id,statement_date,direction,amount,reference").eq("statement_account", "sib-omniastores").gte("statement_date", "2026-10-01");
  for (const l of rl!) {
    const r = rows!.find((x) => x.id === l.bank_line_id)!;
    const twin = sib!.filter((s) => k(s) === k(r));
    const { data: tl } = twin.length ? await supabase.from("recon_lines").select("id,payout_id,match_status").in("bank_line_id", twin.map((t) => t.id)) : { data: [] };
    console.log(k(r), l.gateway, l.payout_id, l.match_status, l.confirmed_at ?? "", "| sib twin", twin.map((t) => t.id), "twin recon", JSON.stringify(tl));
  }
  // other FKs to bank_lines?
})();
