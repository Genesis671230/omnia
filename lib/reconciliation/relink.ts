// Change which order a payout line pays — also for lines that matched an order
// directly, not only unmatched refs.
//
// Real case (Sept 2026): Tamara statement P8498683AE260905 (29 Aug–4 Sep) held
// a line that resolved to order 805543, placed 14 Sep — impossible. The line was
// really WA55583 (same customer, other phone, same AED 877.88). 805543's true
// payment was on statement …260919. Because the wrong line had already been
// booked in Zoho against 805543's invoice, 805543 showed "no settlement record,
// already settled by another payout" on the credit that really paid it, and
// nothing on screen could fix it.
//
// Rules:
//   - A manual link (payout_ref_links) overrides a direct match in the engine.
//   - The old order's settlement record on this payout:
//       not booked → deleted (the engine rebuilds records for the new order);
//       booked in Zoho → MOVED to the credit where the old order truly appears
//       (its Zoho payment already closes the right invoice, so nothing is
//       written to Zoho). If the old order appears on no other credit, refuse:
//       the booked payment would be orphaned — reverse it in Zoho first.
//   - The new order must not already be booked from another payout.

import { supabase } from "@/lib/supabase";
import { markReconDirty } from "@/lib/reconciliation/snapshot";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";
const bare = (s: string) => s.replace(/^#/, "").replace(/^(WA|UAE|KSA|WOO|SA)/i, "");
const isBooked = (id: string | null | undefined) => !!id && !/^(CLAIMED|PENDING):/.test(id);

export class RelinkError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export type RelinkResult = {
  payoutId: string; ref: string; from: string | null; to: string;
  moved?: { orderNumber: string; toPayoutId: string; toBankLineId: string; bankReference: string };
  removedUnbooked: number;
};

async function orderExists(n: string) {
  const { data } = await supabase.from("orders").select("uid, order_number").eq("order_number", n).limit(1);
  return data?.[0] as { uid: string; order_number: string } | undefined;
}

/** The order a line resolves to today: its manual link, else a direct match. */
async function currentOrder(payoutId: string, ref: string): Promise<string | null> {
  const { data: link } = await supabase.from("payout_ref_links").select("order_number").eq("payout_id", payoutId).eq("order_ref", ref).maybeSingle();
  if (link?.order_number) return link.order_number;
  for (const c of [...new Set([ref, bare(ref)])]) if (await orderExists(c)) return c;
  return null;
}

/** The line on a payout that resolves to an order (for fixing it from the order's side). */
export async function refForOrderOnPayout(payoutId: string, orderNumber: string): Promise<string | null> {
  const { data: link } = await supabase.from("payout_ref_links").select("order_ref").eq("payout_id", payoutId).eq("order_number", orderNumber).maybeSingle();
  if (link?.order_ref) return link.order_ref;
  const { data: tx } = await supabase.from("payout_transactions").select("order_ref").eq("payout_id", payoutId).eq("is_refund", false);
  const hit = (tx ?? []).find((t) => t.order_ref === orderNumber || bare(t.order_ref) === bare(orderNumber));
  return hit?.order_ref ?? null;
}

/** Other payouts whose lines resolve to this order (direct match or link), with their bank credit. */
async function otherCreditsFor(orderNumber: string, exceptPayoutId: string) {
  const [{ data: tx }, { data: links }] = await Promise.all([
    supabase.from("payout_transactions").select("payout_id, order_ref").in("order_ref", [...new Set([orderNumber, bare(orderNumber)])]).eq("is_refund", false),
    supabase.from("payout_ref_links").select("payout_id, order_ref").eq("order_number", orderNumber),
  ]);
  // A direct hit only counts if that line isn't linked to a different order.
  const { data: overrides } = await supabase.from("payout_ref_links").select("payout_id, order_ref, order_number")
    .in("payout_id", [...new Set((tx ?? []).map((t) => t.payout_id))]);
  const overridden = new Set((overrides ?? []).filter((o) => o.order_number !== orderNumber).map((o) => `${o.payout_id}|${o.order_ref}`));
  const payoutIds = [...new Set([
    ...(tx ?? []).filter((t) => !overridden.has(`${t.payout_id}|${t.order_ref}`)).map((t) => t.payout_id),
    ...(links ?? []).map((l) => l.payout_id),
  ])].filter((p) => p !== exceptPayoutId);
  if (payoutIds.length === 0) return [];
  const { data: recon } = await supabase.from("recon_lines").select("payout_id, bank_line_id").in("payout_id", payoutIds);
  const out: { payoutId: string; bankLineId: string; reference: string; date: string | null }[] = [];
  for (const r of recon ?? []) {
    const { data: bl } = await supabase.from("bank_lines").select("reference, statement_date").eq("id", r.bank_line_id).maybeSingle();
    out.push({ payoutId: r.payout_id, bankLineId: r.bank_line_id, reference: bl?.reference ?? "", date: bl?.statement_date ? String(bl.statement_date).slice(0, 10) : null });
  }
  return out;
}

export async function changeLineOrder(opts: { payoutId: string; ref?: string; fromOrder?: string; orderNumber: string; actor?: string }): Promise<RelinkResult> {
  const payoutId = opts.payoutId.trim();
  const to = opts.orderNumber.trim().replace(/^#/, "");
  const ref = opts.ref?.trim() || (opts.fromOrder ? await refForOrderOnPayout(payoutId, opts.fromOrder.trim()) : null);
  if (!payoutId || !ref || !to) throw new RelinkError("payoutId, the line (ref) and the new order number are required", 400);

  const { data: tx } = await supabase.from("payout_transactions").select("order_ref, is_refund").eq("payout_id", payoutId).eq("order_ref", ref).maybeSingle();
  if (!tx) throw new RelinkError(`Line ${ref} is not on payout ${payoutId}`, 404);
  const target = await orderExists(to);
  if (!target) throw new RelinkError(`Order ${to} isn't in the synced orders. Run a store sync first.`, 404);

  const from = await currentOrder(payoutId, ref);
  if (from === to) return { payoutId, ref, from, to, removedUnbooked: 0 };

  // The new order can't be paid twice on this payout, nor already booked elsewhere.
  const { data: clash } = await supabase.from("payout_ref_links").select("order_ref").eq("payout_id", payoutId).eq("order_number", to).neq("order_ref", ref).maybeSingle();
  if (clash) throw new RelinkError(`Order ${to} is already linked to line ${clash.order_ref} on this payout.`);
  const { data: toRecords } = await supabase.from("settlement_records").select("payout_id, zoho_payment_id").eq("order_number", to);
  const bookedElsewhere = (toRecords ?? []).find((r) => r.payout_id !== payoutId && isBooked(r.zoho_payment_id));
  if (bookedElsewhere) {
    throw new RelinkError(`Order ${to} is already booked in Zoho from payout ${bookedElsewhere.payout_id}. Change that line first, or pick another order.`);
  }

  // What happens to the old order's record on this payout.
  let moved: RelinkResult["moved"];
  let removedUnbooked = 0;
  if (from) {
    const { data: fromRecords } = await supabase.from("settlement_records").select("*").eq("payout_id", payoutId).eq("order_number", from);
    for (const rec of fromRecords ?? []) {
      if (!isBooked(rec.zoho_payment_id)) {
        await supabase.from("settlement_document_links").delete().eq("settlement_record_id", rec.id);
        const { error } = await supabase.from("settlement_records").delete().eq("id", rec.id);
        if (error) throw new Error(`Could not remove the unbooked record for ${from}: ${error.message}`);
        removedUnbooked++;
        continue;
      }
      const others = await otherCreditsFor(from, payoutId);
      if (others.length !== 1) {
        throw new RelinkError(
          others.length === 0
            ? `Order ${from} is booked in Zoho from this line (payment ${rec.zoho_payment_id}) and appears on no other payout, so moving it would orphan that payment. Reverse it in Zoho first.`
            : `Order ${from} is booked in Zoho from this line and appears on ${others.length} other payouts (${others.map((o) => o.payoutId).join(", ")}). Fix those lines first.`,
        );
      }
      const dest = others[0];
      const newId = `${rec.order_uid}_${dest.bankLineId}`;
      const { data: existingDest } = await supabase.from("settlement_records").select("id, zoho_payment_id").eq("id", newId).maybeSingle();
      if (existingDest && isBooked(existingDest.zoho_payment_id)) {
        throw new RelinkError(`Order ${from} is already booked from ${dest.payoutId} too. Two Zoho payments exist for it; reverse one in Zoho first.`);
      }
      if (existingDest) await supabase.from("settlement_records").delete().eq("id", newId);
      const { error: insErr } = await supabase.from("settlement_records").insert({
        ...rec, id: newId, bank_line_id: dest.bankLineId, payout_id: dest.payoutId, bank_reference: dest.reference,
        settlement_date: dest.date ?? rec.settlement_date, zoho_claimed_at: null,
      });
      if (insErr) throw new Error(`Could not move ${from}'s booking to ${dest.payoutId}: ${insErr.message}`);
      await supabase.from("settlement_document_links").update({ settlement_record_id: newId }).eq("settlement_record_id", rec.id);
      await supabase.from("settlement_records").delete().eq("id", rec.id);
      moved = { orderNumber: from, toPayoutId: dest.payoutId, toBankLineId: dest.bankLineId, bankReference: dest.reference };
    }
  }

  const { error } = await supabase.from("payout_ref_links").upsert(
    { payout_id: payoutId, order_ref: ref, order_number: to, tenant_id: TENANT, linked_by: opts.actor || "founder", linked_at: new Date().toISOString() },
    { onConflict: "payout_id,order_ref" },
  );
  if (error) throw new Error(error.message);
  await markReconDirty(`relink ${payoutId}|${ref}: ${from ?? "-"} → ${to}`);
  return { payoutId, ref, from, to, moved, removedUnbooked };
}
