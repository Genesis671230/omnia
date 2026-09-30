// Which company each courier delivery charge on a COD voucher belongs to.
//
// One OnTrack voucher is remitted to ONE company (the payout's Zoho org —
// House of Omnia for COD), but the rows on it are not all that company's:
//
//   - a COD row (cash collected) is the voucher company's own sale;
//   - a charge-only row (Pro Price 0) is usually a PREPAID order — paid through
//     Tabby / Tamara / Stripe…, invoiced and settled by the sister company
//     (Omniastores). The courier still netted its charge out of the voucher
//     company's remittance, so the voucher company paid that charge on the
//     sister company's behalf: an intercompany balance, not its own expense.
//
// Each charge gets an entity (a Zoho connection id) and the reason it was
// chosen, in this order:
//   1. manual       — someone picked it in the drawer (saved on the payout)
//   2. settled      — the order was booked off a gateway payout; that payout's
//                     Zoho org is where its invoice lives
//   3. cod          — the order was cash on delivery → the voucher's company
//   4. prepaid      — known order, paid through a gateway → the prepaid org
//   5. unknown      — no such order: stays with the voucher's company (nothing
//                     is charged to a sister company without evidence) and is
//                     flagged for a look
//
// Pure: the loader in delivery-entities.server.ts gathers the evidence.

import type { CodDeliveryCharge } from "@/lib/parsers/ontrack-voucher";

export type DeliveryEntityReason = "manual" | "settled" | "cod" | "prepaid" | "unknown";

export type OrderEvidence = {
  /** Gateway on the order row ("COD", "Tabby", …), null when unknown. */
  gateway: string | null;
  /** Zoho org of the gateway payout this order was settled on, if any. */
  settledInOrg: string | null;
};

export type AssignedDeliveryCharge = CodDeliveryCharge & {
  /** Stable per-row key: the same order can appear twice on one voucher. */
  key: string;
  entity: string;
  reason: DeliveryEntityReason;
  /** One line a person can read: why this company. */
  why: string;
};

const COD_GATEWAY_RE = /^(cod|cash)/i;

/** Row key — order + courier voucher no., with an occurrence counter so a
 *  row that repeats (same order, same voucher) still gets its own key. */
export function deliveryChargeKeys(charges: Pick<CodDeliveryCharge, "ref" | "voucherNo">[]): string[] {
  const seen = new Map<string, number>();
  return charges.map((c) => {
    const base = `${c.ref}|${c.voucherNo}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}|${n + 1}`;
  });
}

export function assignDeliveryEntities(input: {
  charges: CodDeliveryCharge[];
  /** Org the voucher's remittance is booked in (the payout's). */
  voucherOrg: string;
  /** Org that owns prepaid (gateway-paid) orders by default. */
  prepaidOrg: string;
  /** Orders collected as COD on this same voucher. */
  codRefsOnVoucher: Set<string>;
  evidence: Map<string, OrderEvidence>;
  /** key → org, picked by hand. */
  overrides: Record<string, string>;
  /** Connection ids that exist — an override to a removed org is ignored. */
  knownOrgs: Set<string>;
  orgLabel: (id: string) => string;
}): AssignedDeliveryCharge[] {
  const keys = deliveryChargeKeys(input.charges);
  return input.charges.map((c, i) => {
    const key = keys[i];
    const manual = input.overrides[key];
    if (manual && input.knownOrgs.has(manual)) {
      return { ...c, key, entity: manual, reason: "manual", why: `Picked by hand: ${input.orgLabel(manual)}` };
    }
    const ev = input.evidence.get(c.ref);
    if (ev?.settledInOrg) {
      return { ...c, key, entity: ev.settledInOrg, reason: "settled", why: `Paid via ${ev.gateway ?? "a gateway"}, settled in ${input.orgLabel(ev.settledInOrg)}` };
    }
    if (input.codRefsOnVoucher.has(c.ref) || (ev?.gateway && COD_GATEWAY_RE.test(ev.gateway))) {
      return { ...c, key, entity: input.voucherOrg, reason: "cod", why: `Cash on delivery — ${input.orgLabel(input.voucherOrg)}'s own order` };
    }
    if (ev) {
      return { ...c, key, entity: input.prepaidOrg, reason: "prepaid", why: `Prepaid via ${ev.gateway ?? "a gateway"} — ${input.orgLabel(input.prepaidOrg)}'s order` };
    }
    return { ...c, key, entity: input.voucherOrg, reason: "unknown", why: `Order not found — kept in ${input.orgLabel(input.voucherOrg)}; check it` };
  });
}

export type DeliveryEntityGroup = {
  entity: string;
  /** True when this is the company the voucher was remitted to. */
  own: boolean;
  charges: AssignedDeliveryCharge[];
  total: number;
  vat: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Charges grouped by company — the voucher's own group first. */
export function groupDeliveryCharges(charges: AssignedDeliveryCharge[], voucherOrg: string): DeliveryEntityGroup[] {
  const by = new Map<string, AssignedDeliveryCharge[]>();
  for (const c of charges) by.set(c.entity, [...(by.get(c.entity) ?? []), c]);
  return [...by.entries()]
    .map(([entity, list]) => ({
      entity,
      own: entity === voucherOrg,
      charges: list,
      total: r2(list.reduce((s, c) => s + c.amount, 0)),
      vat: r2(list.reduce((s, c) => s + c.vat, 0)),
    }))
    .sort((a, b) => Number(b.own) - Number(a.own) || a.entity.localeCompare(b.entity));
}

/** What one Zoho line says about a charge — the order number first, so it is
 *  what an accountant sees and searches for. */
export function deliveryLineDescription(c: Pick<CodDeliveryCharge, "ref" | "isReturn" | "voucherNo" | "status">, provider: string): string {
  return `Order #${c.ref} · ${c.isReturn ? "return" : "delivery"} charge · ${provider} voucher ${c.voucherNo || "—"}${c.status ? ` · ${c.status}` : ""}`.slice(0, 250);
}
