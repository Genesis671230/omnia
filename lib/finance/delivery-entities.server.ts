// Loads the evidence behind assignDeliveryEntities() for one COD payout:
// the order rows, the gateway payouts they settled on, and any company picked
// by hand in the drawer (payouts.delivery_charge_entities).

import { supabase } from "@/lib/supabase";
import { ENV_CONNECTION_ID } from "@/lib/integrations/zoho-context";
import { listZohoConnections } from "@/lib/integrations/zoho-org";
import { chunkForInFilter } from "@/lib/repositories/in-filter-chunks";
import type { CodDeliveryCharge } from "@/lib/parsers/ontrack-voucher";
import {
  assignDeliveryEntities,
  groupDeliveryCharges,
  type AssignedDeliveryCharge,
  type DeliveryEntityGroup,
  type OrderEvidence,
} from "./delivery-entities";

/** Org that owns prepaid (gateway-paid) orders when no payout says otherwise.
 *  Omnia: the main organisation. Another client sets it per deployment. */
export function prepaidOrdersOrg(): string {
  return process.env.COD_PREPAID_ORDERS_ZOHO_ORG?.trim() || ENV_CONNECTION_ID;
}

const orgOf = (v: string | null | undefined) => (v && v.trim()) || ENV_CONNECTION_ID;

async function loadEvidence(refs: string[]): Promise<Map<string, OrderEvidence>> {
  const evidence = new Map<string, OrderEvidence>();
  if (refs.length === 0) return evidence;

  for (const chunk of chunkForInFilter(refs)) {
    const { data, error } = await supabase.from("orders").select("order_number, gateway").in("order_number", chunk);
    if (error) throw new Error(`orders lookup failed: ${error.message}`);
    for (const o of data ?? []) evidence.set(o.order_number, { gateway: o.gateway ?? null, settledInOrg: null });
  }

  // The gateway payout an order was settled on decides its books — only
  // real gateway payouts, never another COD voucher.
  const settled: { order_number: string; payout_id: string }[] = [];
  for (const chunk of chunkForInFilter(refs)) {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("order_number, payout_id, gateway")
      .in("order_number", chunk)
      .not("payout_id", "is", null)
      .neq("gateway", "COD");
    if (error) throw new Error(`settlement_records lookup failed: ${error.message}`);
    settled.push(...((data ?? []) as { order_number: string; payout_id: string }[]));
  }
  const payoutIds = [...new Set(settled.map((s) => s.payout_id))];
  const orgByPayout = new Map<string, string>();
  for (const chunk of chunkForInFilter(payoutIds)) {
    const { data, error } = await supabase.from("payouts").select("id, zoho_connection_id").in("id", chunk);
    if (error) throw new Error(`payouts lookup failed: ${error.message}`);
    for (const p of data ?? []) orgByPayout.set(p.id, orgOf(p.zoho_connection_id));
  }
  for (const s of settled) {
    const org = orgByPayout.get(s.payout_id);
    if (!org) continue;
    const prev = evidence.get(s.order_number);
    evidence.set(s.order_number, { gateway: prev?.gateway ?? null, settledInOrg: org });
  }
  return evidence;
}

export type DeliveryEntityState = {
  payoutId: string;
  voucherOrg: string;
  prepaidOrg: string;
  charges: AssignedDeliveryCharge[];
  groups: DeliveryEntityGroup[];
  overrides: Record<string, string>;
  orgs: { id: string; label: string }[];
};

export async function loadDeliveryEntities(payoutId: string): Promise<DeliveryEntityState | null> {
  const { data: p, error } = await supabase
    .from("payouts")
    .select("id, zoho_connection_id, delivery_charges, delivery_charge_entities")
    .eq("id", payoutId)
    .maybeSingle();
  if (error) throw new Error(`payouts read failed: ${error.message}`);
  if (!p) return null;

  const charges = (p.delivery_charges ?? []) as CodDeliveryCharge[];
  const voucherOrg = orgOf(p.zoho_connection_id);
  const overrides = (p.delivery_charge_entities ?? {}) as Record<string, string>;
  const conns = await listZohoConnections();
  const label = new Map(conns.map((c) => [c.id, c.label]));
  const prepaidOrg = prepaidOrdersOrg();

  const { data: cod, error: codErr } = await supabase.from("payout_transactions").select("order_ref").eq("payout_id", payoutId);
  if (codErr) throw new Error(`payout_transactions read failed: ${codErr.message}`);

  const assigned = assignDeliveryEntities({
    charges,
    voucherOrg,
    prepaidOrg,
    codRefsOnVoucher: new Set((cod ?? []).map((t) => String(t.order_ref ?? "").toUpperCase())),
    evidence: await loadEvidence([...new Set(charges.map((c) => c.ref))]),
    overrides,
    knownOrgs: new Set(conns.filter((c) => c.status !== "disabled").map((c) => c.id)),
    orgLabel: (id) => label.get(id) ?? id,
  });

  return {
    payoutId,
    voucherOrg,
    prepaidOrg,
    charges: assigned,
    groups: groupDeliveryCharges(assigned, voucherOrg),
    overrides,
    orgs: conns.filter((c) => c.status !== "disabled").map((c) => ({ id: c.id, label: c.label })),
  };
}

/** Save the companies picked by hand. `null` clears a row back to automatic. */
export async function saveDeliveryEntityOverrides(payoutId: string, patch: Record<string, string | null>): Promise<void> {
  const { data: p, error } = await supabase.from("payouts").select("delivery_charge_entities").eq("id", payoutId).maybeSingle();
  if (error) throw new Error(`payouts read failed: ${error.message}`);
  const next = { ...((p?.delivery_charge_entities ?? {}) as Record<string, string>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v) next[k] = v;
    else delete next[k];
  }
  const { error: upErr } = await supabase.from("payouts").update({ delivery_charge_entities: next }).eq("id", payoutId);
  if (upErr) throw new Error(`payouts update failed: ${upErr.message}`);
}

export type DeliveryPosting = {
  /** "own" = the voucher company's charges; "ic-voucher" / "ic-counterpart" =
   *  the two sides of charges paid for a sister company. */
  leg: "own" | "ic-voucher" | "ic-counterpart";
  org: string;
  kind: "expense" | "journal";
  id: string;
  reference: string;
  amount: number;
  /** Order numbers on the document — each charge traces to it. */
  refs: string[];
  at: string;
};

/** Remember a Zoho document the charges were booked as (idempotent on
 *  org + reference + kind). This is what locks the payout's books. */
export async function recordDeliveryPosting(payoutId: string, posting: DeliveryPosting): Promise<void> {
  const { data: p, error } = await supabase.from("payouts").select("delivery_postings").eq("id", payoutId).maybeSingle();
  if (error) throw new Error(`payouts read failed: ${error.message}`);
  const same = (x: DeliveryPosting) => x.org === posting.org && x.reference === posting.reference && x.kind === posting.kind;
  const next = [...((p?.delivery_postings ?? []) as DeliveryPosting[]).filter((x) => !same(x)), posting];
  const { error: upErr } = await supabase.from("payouts").update({ delivery_postings: next }).eq("id", payoutId);
  if (upErr) throw new Error(`payouts update failed: ${upErr.message}`);
}
