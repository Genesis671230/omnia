import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignDeliveryEntities,
  deliveryChargeKeys,
  deliveryLineDescription,
  groupDeliveryCharges,
  type OrderEvidence,
} from "@/lib/finance/delivery-entities";
import {
  buildDeliveryChargesExpenseBody,
  buildIntercompanyDeliveryJournalBody,
  deliveryReferences,
} from "@/lib/finance/settlement-posting";
import type { CodDeliveryCharge } from "@/lib/parsers/ontrack-voucher";

const charge = (ref: string, amount = 30, extra: Partial<CodDeliveryCharge> = {}): CodDeliveryCharge => ({
  ref, amount, exVat: Math.round((amount / 1.05) * 100) / 100, vat: Math.round((amount - amount / 1.05) * 100) / 100,
  isReturn: false, voucherNo: "V1", status: "Delivered", ...extra,
});
const labels: Record<string, string> = { env: "Omniastores LLC", "house-of-omnia": "House of Omnia" };
const assign = (charges: CodDeliveryCharge[], evidence: [string, OrderEvidence][], extra: { overrides?: Record<string, string>; cod?: string[] } = {}) =>
  assignDeliveryEntities({
    charges,
    voucherOrg: "house-of-omnia",
    prepaidOrg: "env",
    codRefsOnVoucher: new Set(extra.cod ?? []),
    evidence: new Map(evidence),
    overrides: extra.overrides ?? {},
    knownOrgs: new Set(["env", "house-of-omnia"]),
    orgLabel: (id) => labels[id] ?? id,
  });

// CP17192 (live): every charge-only row was a Tabby / Tamara / Stripe order.
test("a prepaid order settled on an Omniastores payout books in Omniastores", () => {
  const [c] = assign([charge("OS3757")], [["OS3757", { gateway: "Tabby", settledInOrg: "env" }]]);
  assert.equal(c.entity, "env");
  assert.equal(c.reason, "settled");
  assert.match(c.why, /Tabby.*Omniastores/);
});

test("prepaid but not yet settled → the prepaid-orders company", () => {
  const [c] = assign([charge("WA55835", 490)], [["WA55835", { gateway: "Stripe", settledInOrg: null }]]);
  assert.equal(c.entity, "env");
  assert.equal(c.reason, "prepaid");
});

test("a COD order (on this voucher or by gateway) stays with the voucher company", () => {
  const out = assign([charge("805436"), charge("WA1", 30, { isReturn: true })], [["WA1", { gateway: "COD", settledInOrg: null }]], { cod: ["805436"] });
  assert.deepEqual(out.map((c) => [c.entity, c.reason]), [["house-of-omnia", "cod"], ["house-of-omnia", "cod"]]);
});

test("an order we can't find is never charged to the sister company", () => {
  const [c] = assign([charge("80537")], []);
  assert.equal(c.entity, "house-of-omnia");
  assert.equal(c.reason, "unknown");
});

test("a hand-picked company wins; one for a removed org is ignored", () => {
  const charges = [charge("OS1"), charge("OS2")];
  const ev: [string, OrderEvidence][] = [["OS1", { gateway: "Tabby", settledInOrg: "env" }], ["OS2", { gateway: "Tabby", settledInOrg: "env" }]];
  const out = assign(charges, ev, { overrides: { "OS1|V1": "house-of-omnia", "OS2|V1": "gone" } });
  assert.deepEqual(out.map((c) => [c.entity, c.reason]), [["house-of-omnia", "manual"], ["env", "settled"]]);
});

test("the same order twice on one voucher gets two keys", () => {
  assert.deepEqual(deliveryChargeKeys([charge("WA55607"), charge("WA55607"), charge("X")]), ["WA55607|V1", "WA55607|V1|2", "X|V1"]);
});

test("groups: voucher company first, totals and VAT per company", () => {
  const out = assign(
    [charge("OS1"), charge("80537", 165), charge("OS2")],
    [["OS1", { gateway: "Tabby", settledInOrg: "env" }], ["OS2", { gateway: "Tamara", settledInOrg: "env" }]],
  );
  const groups = groupDeliveryCharges(out, "house-of-omnia");
  assert.deepEqual(groups.map((g) => [g.entity, g.own, g.charges.length, g.total]), [["house-of-omnia", true, 1, 165], ["env", false, 2, 60]]);
  assert.equal(groups[1].vat, 2.86);
});

test("each Zoho line starts with the order number", () => {
  assert.equal(deliveryLineDescription(charge("WA55736", 30, { isReturn: true, voucherNo: "17169" }), "COD"),
    "Order #WA55736 · return charge · COD voucher 17169 · Delivered");
});

test("sister company's expense: a line per order, paid through its Due-to account, VAT inclusive", () => {
  const body = buildDeliveryChargesExpenseBody({
    lines: [{ description: "Order #OS1 · delivery", amount: 30 }, { description: "Order #OS2 · delivery", amount: 165 }],
    expenseAccountId: "DLV", paidThroughAccountId: "DUE_TO_HOO", vatTaxId: "VAT5",
    date: "2026-09-29", reference: "FT26272M9D0C/DLV-IC-env", description: "x",
  });
  assert.equal(body.paid_through_account_id, "DUE_TO_HOO");
  assert.equal(body.is_inclusive_tax, true);
  assert.deepEqual(body.line_items.map((l) => [l.account_id, l.amount, l.tax_id, l.description.slice(0, 10)]),
    [["DLV", 30, "VAT5", "Order #OS1"], ["DLV", 165, "VAT5", "Order #OS2"]]);
  assert.equal("account_id" in body, false, "itemized: no header account");
});

test("voucher company's journal balances: Dr Due-from per order = Cr clearing", () => {
  const body = buildIntercompanyDeliveryJournalBody({
    lines: [{ description: "Order #OS1", amount: 30 }, { description: "Order #OS2", amount: 28.57 }],
    dueFromAccountId: "DUE_FROM_OMNIA", clearingAccountId: "ON_TRACK", date: "2026-09-29", reference: "r", description: "d",
  });
  const dr = body.line_items.filter((l) => l.debit_or_credit === "debit").reduce((s, l) => s + l.amount, 0);
  const cr = body.line_items.filter((l) => l.debit_or_credit === "credit");
  assert.equal(cr.length, 1);
  assert.equal(cr[0].account_id, "ON_TRACK");
  assert.equal(Math.round(dr * 100) / 100, cr[0].amount);
  assert.equal(cr[0].amount, 58.57);
});

test("references: own charges keep /DLV; a sister's tie both sides with one reference", () => {
  assert.equal(deliveryReferences("FT26272M9D0C"), "FT26272M9D0C/DLV");
  assert.equal(deliveryReferences("FT26272M9D0C", "env"), "FT26272M9D0C/DLV-IC-env");
});

// Live 2026-09-30: Zoho refused Omniastores' expense paid through
// "House of Omnia Accessories LLC - sis company" (an other-asset account):
// code 11016. Its side books as a journal with the same effect.
test("sister side as a journal: Dr delivery per order + Input VAT = Cr intercompany", async () => {
  const { buildDeliveryChargesJournalBody } = await import("@/lib/finance/settlement-posting");
  const lines = [
    { description: "Order #OS1", amount: 30, exVat: 28.57, vat: 1.43 },
    { description: "Order #OS2", amount: 165, exVat: 157.14, vat: 7.86 },
  ];
  const withVat = buildDeliveryChargesJournalBody({
    lines, expenseAccountId: "DLV", creditAccountId: "SIS", inputVatAccountId: "IVAT", date: "2026-09-30", reference: "r", description: "d",
  });
  const sum = (dc: string) => +withVat.line_items.filter((l) => l.debit_or_credit === dc).reduce((s, l) => s + l.amount, 0).toFixed(2);
  assert.equal(sum("debit"), 195);
  assert.equal(sum("credit"), 195);
  assert.deepEqual(withVat.line_items.map((l) => [l.account_id, l.amount]), [["DLV", 28.57], ["DLV", 157.14], ["IVAT", 9.29], ["SIS", 195]]);

  const noVat = buildDeliveryChargesJournalBody({
    lines, expenseAccountId: "DLV", creditAccountId: "SIS", inputVatAccountId: null, date: "2026-09-30", reference: "r", description: "d",
  });
  assert.deepEqual(noVat.line_items.map((l) => [l.account_id, l.amount]), [["DLV", 30], ["DLV", 165], ["SIS", 195]]);
});
