// Every credit note our system wrote to Zoho since a date: payout refunds,
// the order adjust dialog, and the Zoho Books tab. Read-only.
import { supabase } from "@/lib/supabase";
const FROM = process.argv[2] ?? "2026-09-20";
const real = (id: string | null) => !!id && !id.startsWith("PENDING");
(async () => {
  const rows: any[] = [];
  const { data: rp, error: e1 } = await supabase.from("refund_postings").select("*").gte("created_at", FROM);
  if (e1) throw e1;
  const payoutIds = [...new Set(rp!.map((r) => r.payout_id))];
  const { data: po } = payoutIds.length ? await supabase.from("payouts").select("id,zoho_connection_id,gateway").in("id", payoutIds) : { data: [] };
  const orgOf = new Map((po ?? []).map((p: any) => [p.id, p.zoho_connection_id || "env"]));
  for (const r of rp!) rows.push({ source: "payout refund", order: r.order_number, cn_id: r.zoho_creditnote_id, cn_no: "", org: orgOf.get(r.payout_id) ?? "env", aed: Number(r.amount_aed), at: r.posted_at ?? r.created_at, ref: r.payout_id, reused: r.creditnote_reused, error: r.error });
  const { data: oa, error: e2 } = await supabase.from("order_adjustments").select("*").gte("created_at", FROM);
  if (e2) throw e2;
  for (const a of oa!) if (a.zoho_creditnote_id || a.kind !== "received") rows.push({ source: `adjust: ${a.kind}${a.mark_only ? " (mark only)" : ""}`, order: a.order_number, cn_id: a.zoho_creditnote_id, cn_no: a.zoho_creditnote_number, org: a.zoho_connection_id, aed: Number(a.credit_aed), at: a.posted_at ?? a.created_at, ref: a.zoho_invoice_number, status: a.status, applied: Number(a.applied_to_invoice_aed), by: a.created_by, error: a.error });
  const { data: al, error: e3 } = await supabase.from("zoho_action_log").select("*").gte("at", FROM).ilike("entity", "%credit%");
  if (e3) throw e3;
  for (const l of al!) rows.push({ source: `zoho tab: ${l.action}`, order: (l.request as any)?.reference_number ?? "", cn_id: l.record_id, cn_no: "", org: l.connection_id, aed: Number((l.request as any)?.total ?? 0), at: l.at, ok: l.ok, by: l.actor, error: l.ok ? null : l.message });
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  require("fs").writeFileSync(process.argv[3] ?? "/dev/stdout", JSON.stringify(rows, null, 1));
  const c = new Map<string, number>(); for (const r of rows) c.set(`${r.source}|${real(r.cn_id) ? "has CN" : "no CN"}`, (c.get(`${r.source}|${real(r.cn_id) ? "has CN" : "no CN"}`) ?? 0) + 1);
  console.error(rows.length, c);
})().catch((e) => { console.error(e); process.exit(1); });
