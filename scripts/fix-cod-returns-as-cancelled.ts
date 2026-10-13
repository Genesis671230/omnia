// COD orders that came back before the courier paid us out were recorded as
// "returned" / "refunded"; the founder's rule (management_report_definitions
// #4) says they are cancellations. Reclassifies those app adjustments to
// "cancelled" (the Zoho credit note stays as it is — same document either
// way: full credit applied to the unpaid invoice). App data only, no Zoho.
// Optionally also marks the month's dispatch-sheet cancellations still
// unmarked (mark only).
//
//   npx tsx scripts/fix-cod-returns-as-cancelled.ts [--month 2026-09] [--apply]
import "dotenv/config";
import { supabase } from "@/lib/supabase";
import { codReturnIsCancellation } from "@/lib/orders/order-adjustment";
import { runAdjustment } from "@/lib/orders/order-adjustment.service";
import { buildSheetAdjustments } from "@/lib/dispatch/sheet-adjustments.service";

const apply = process.argv.includes("--apply");
const mi = process.argv.indexOf("--month");
const month = mi > 0 ? process.argv[mi + 1] : null;

(async () => {
  const { data: adjs, error } = await supabase.from("order_adjustments").select("id, order_uid, order_number, kind, credit_aed, damage_aed, returned_lines, note")
    .eq("status", "posted").in("kind", ["returned", "refunded"]);
  if (error) throw error;
  const uids = [...new Set((adjs ?? []).map((a) => a.order_uid))];
  const orders = new Map<string, { gateway: string; payout_id: string | null; gross_aed: number; order_date: string }>();
  for (let i = 0; i < uids.length; i += 200) {
    const { data } = await supabase.from("orders").select("uid, gateway, payout_id, gross_aed, order_date").in("uid", uids.slice(i, i + 200));
    for (const o of data ?? []) orders.set(o.uid, o);
  }
  const fix = (adjs ?? []).filter((a) => {
    const o = orders.get(a.order_uid);
    if (!o || (month && !String(o.order_date).startsWith(month))) return false;
    const full = !(Number(a.damage_aed) > 0) && Number(a.credit_aed) >= Number(o.gross_aed) - 1;
    return codReturnIsCancellation({ kind: a.kind, gateway: o.gateway, payoutId: o.payout_id, fullCredit: full });
  });
  console.log(`${fix.length} COD returns → cancelled${apply ? "" : " (dry run)"}`);
  for (const a of fix) {
    const o = orders.get(a.order_uid)!;
    console.log(" ", a.order_number, a.kind, "→ cancelled", "AED", o.gross_aed);
    if (!apply) continue;
    const note = `${a.note ? `${a.note} · ` : ""}Reclassified ${a.kind} → cancelled: COD returned before the courier paid out`;
    const { error: e1 } = await supabase.from("order_adjustments").update({ kind: "cancelled", credit_aed: o.gross_aed, note }).eq("id", a.id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("orders").update({ ops_status: "cancelled", ops_credit_aed: o.gross_aed }).eq("uid", a.order_uid);
    if (e2) throw e2;
  }

  if (month) {
    const r = await buildSheetAdjustments(month, true);
    const cancels = r.suggestions.filter((s) => s.kind === "cancelled");
    console.log(`${cancels.length} sheet cancellations still unmarked in ${month}${apply ? "" : " (dry run)"}`);
    for (const s of cancels) {
      console.log(" ", s.orderNumber, s.gateway, "AED", s.grossAed, "|", s.evidence.join(" | ").slice(0, 120));
      if (!apply) continue;
      const res = await runAdjustment({ uid: s.uid, kind: "cancelled", connectionId: null, invoiceId: null, quantity: 0, rate: 0, item_total: 0,
        markOnly: true, dryRun: false, actor: "script:fix-cod-returns", date: s.eventDate ?? undefined, note: `Dispatch sheet — ${s.evidence.join(" · ")}`.slice(0, 900) } as never);
      console.log("    ", res.ok ? "marked" : `FAILED: ${res.message}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
