import { test } from "node:test";
import assert from "node:assert/strict";
import { planAdjustment, type ZInvoice } from "@/lib/orders/order-adjustment";

// Shaped like live HoO invoice INV-005158 (WA55697, COD): tax-exclusive,
// a 5% product line and a zero-rated shipping line, total 859.50.
const inv = (over: Partial<ZInvoice> = {}): ZInvoice => ({
  invoice_id: "I1", invoice_number: "INV-005158", customer_id: "C1", status: "sent",
  total: 859.5, balance: 859.5, is_inclusive_tax: false, tax_treatment: "vat_not_registered", place_of_supply: "DU",
  line_items: [
    { line_item_id: "L1", item_id: "IT1", name: "Abaya", quantity: 1, rate: 790, item_total: 790, tax_id: "T5", tax_percentage: 5, account_id: "A1" },
    { line_item_id: "L2", item_id: "IT2", name: "shipping", quantity: 1, rate: 30, item_total: 30, tax_id: "T0", tax_percentage: 0, account_id: "A1" },
  ],
  ...over,
});

const cnTotal = (body: Record<string, unknown>, inclusive = false) =>
  Math.round(((body.line_items as { quantity: number; rate: number; tax_id?: string }[])
    .reduce((s, l) => s + l.quantity * l.rate * (inclusive ? 1 : l.tax_id === "T5" ? 1.05 : 1), 0) + Number(body.adjustment ?? 0)) * 100) / 100;

test("cancelled unpaid COD: full credit note applied to the invoice, nothing owed or due", () => {
  const p = planAdjustment(inv(), { kind: "cancelled", orderNumber: "WA55697", date: "2026-10-02", deductAed: 50 });
  assert.equal(p.ok, true);
  assert.equal(p.deductAed, 0, "a cancellation never keeps a damage amount");
  assert.equal(p.creditAed, 859.5);
  assert.equal(p.applyToInvoiceAed, 859.5);
  assert.equal(p.refundDueAed, 0);
  assert.equal(p.customerOwesAed, 0);
  assert.equal(p.fullCredit, true);
  assert.equal(cnTotal(p.creditNoteBody!), 859.5);
  assert.equal(p.creditNoteBody!.reference_number, "ADJ/WA55697/CN");
  assert.equal(p.creditNoteBody!.invoice_id, "I1");
});

test("return with damage on an unpaid COD invoice: note = value − damage, damage stays owed", () => {
  const p = planAdjustment(inv(), { kind: "returned", orderNumber: "WA55697", date: "2026-10-02", deductAed: 100 });
  assert.equal(p.creditAed, 759.5);
  assert.equal(p.applyToInvoiceAed, 759.5);
  assert.equal(p.customerOwesAed, 100);
  assert.equal(p.refundDueAed, 0);
  assert.equal(cnTotal(p.creditNoteBody!), 759.5);
});

test("return with damage on a paid invoice: the note stays open as the refund due", () => {
  const p = planAdjustment(inv({ balance: 0, status: "paid" }), { kind: "returned", orderNumber: "X1", date: "2026-10-02", deductAed: 100 });
  assert.equal(p.applyToInvoiceAed, 0);
  assert.equal(p.refundDueAed, 759.5);
  assert.equal(p.customerOwesAed, 0);
});

test("partial return of one line keeps the shipping line out", () => {
  const p = planAdjustment(inv({ balance: 0 }), { kind: "returned", orderNumber: "X1", date: "2026-10-02", picks: [{ line_item_id: "L1", qty: 1 }] });
  assert.equal(p.creditAed, 829.5); // 790 × 1.05
  assert.equal((p.creditNoteBody!.line_items as unknown[]).length, 1);
  assert.equal(cnTotal(p.creditNoteBody!), 829.5);
});

test("exchange: note applied to the replacement invoice, customer pays only the difference", () => {
  const p = planAdjustment(inv({ balance: 0, status: "paid" }), {
    kind: "exchanged", orderNumber: "WA55697", date: "2026-10-02", picks: [{ line_item_id: "L1", qty: 1 }],
    exchange: [{ item_id: "IT9", name: "Abaya L", qty: 1, unitGross: 900 }],
  });
  assert.equal(p.creditAed, 829.5);
  assert.equal(p.exchangeTotalAed, 900);
  assert.equal(p.applyToExchangeAed, 829.5);
  assert.equal(p.customerOwesAed, 70.5);
  assert.equal(p.refundDueAed, 0);
  const body = p.exchangeInvoiceBody!;
  assert.equal(body.customer_id, "C1", "same Zoho customer as the original invoice");
  assert.equal(body.reference_number, "ADJ/WA55697/EXI");
  assert.equal(cnTotal(body), 900);
});

test("exchange to a cheaper item leaves the difference open on the note", () => {
  const p = planAdjustment(inv({ balance: 0 }), {
    kind: "exchanged", orderNumber: "X1", date: "2026-10-02", picks: [{ line_item_id: "L1", qty: 1 }],
    exchange: [{ name: "Scarf", qty: 1, unitGross: 300 }],
  });
  assert.equal(p.applyToExchangeAed, 300);
  assert.equal(p.refundDueAed, 529.5);
  assert.equal(p.customerOwesAed, 0);
});

test("tax-inclusive invoice with header discount: full refund credits exactly the total", () => {
  const p = planAdjustment(inv({
    is_inclusive_tax: true, total: 950, balance: 0,
    line_items: [{ line_item_id: "L1", name: "Set", quantity: 2, rate: 500, item_total: 1000, tax_id: "T5", tax_percentage: 5 }],
  }), { kind: "refunded", orderNumber: "SA1", date: "2026-10-02" });
  assert.equal(p.creditAed, 950);
  assert.equal(cnTotal(p.creditNoteBody!, true), 950);
  assert.equal(p.refundDueAed, 950);
});

test("guards: void invoice, too many returned, exchange without items", () => {
  assert.match(planAdjustment(inv({ status: "void" }), { kind: "cancelled", orderNumber: "X", date: "2026-10-02" }).error!, /void/);
  assert.match(planAdjustment(inv(), { kind: "returned", orderNumber: "X", date: "2026-10-02", picks: [{ line_item_id: "L1", qty: 2 }] }).error!, /Only 1/);
  assert.match(planAdjustment(inv(), { kind: "exchanged", orderNumber: "X", date: "2026-10-02" }).error!, /replacement/);
  assert.match(planAdjustment(inv(), { kind: "returned", orderNumber: "X", date: "2026-10-02", deductAed: 5000 }).error!, /zero/);
});

test("batch-tracked item: the credit note names the batch the stock goes back into (Zoho 2302, SA3917)", () => {
  const p = planAdjustment(inv({
    balance: 0,
    line_items: [
      { line_item_id: "L1", item_id: "IT1", name: "Full set B16", quantity: 3, rate: 200, item_total: 600, tax_id: "T0", tax_percentage: 0, warehouse_id: "W1",
        batches: [{ batch_id: "B48", batch_number: "BT48", out_quantity: 1 }, { batch_id: "B49", batch_number: "BT49", out_quantity: 2 }] },
      { line_item_id: "L2", name: "Shipping", quantity: 1, rate: 30, item_total: 30, tax_id: "T0", tax_percentage: 0 },
    ],
    total: 630,
  }), { kind: "returned", orderNumber: "SA3917", date: "2026-10-02", picks: [{ line_item_id: "L1", qty: 2 }] });
  const lines = p.creditNoteBody!.line_items as { batches?: unknown }[];
  assert.deepEqual(lines[0].batches, [{ batch_id: "B48", batch_number: "BT48", in_quantity: 1 }, { batch_id: "B49", batch_number: "BT49", in_quantity: 1 }]);
  const full = planAdjustment(inv({ balance: 0, total: 630, line_items: [
    { line_item_id: "L1", item_id: "IT1", name: "Full set", quantity: 1, rate: 600, item_total: 600, tax_id: "T0", tax_percentage: 0, batches: [{ batch_id: "B48", batch_number: "BT48", out_quantity: 1 }] },
    { line_item_id: "L2", name: "Shipping", quantity: 1, rate: 30, item_total: 30, tax_id: "T0", tax_percentage: 0 },
  ] }), { kind: "refunded", orderNumber: "SA3917", date: "2026-10-02" });
  const fl = full.creditNoteBody!.line_items as { batches?: unknown }[];
  assert.deepEqual(fl[0].batches, [{ batch_id: "B48", batch_number: "BT48", in_quantity: 1 }]);
  assert.equal(fl[1].batches, undefined);
});

test("kit item: the credit note returns each component into its own batch (Zoho 2302 on LED Set Box, OS3781)", () => {
  const p = planAdjustment(inv({
    total: 600, balance: 0, is_inclusive_tax: true,
    line_items: [
      { line_item_id: "L1", item_id: "KIT", name: "set box and pap999", quantity: 2, rate: 0, item_total: 0, tax_id: "T5", tax_percentage: 5,
        mapped_items: [
          { item_id: "BOX", name: "LED Set Box - LEDBOX2", quantity: 2, warehouse_id: "W1", batches: [{ batch_id: "LB19", batch_number: "LEDBOX19", out_quantity: 2 }] },
          { item_id: "BAG", name: "PAP999 Paper Bags", quantity: 2, warehouse_id: "W1" },
        ] },
      { line_item_id: "L2", item_id: "IT1", name: "Full set", quantity: 1, rate: 600, item_total: 600, tax_id: "T5", tax_percentage: 5 },
    ],
  }), { kind: "returned", orderNumber: "OS3781", date: "2026-10-05", picks: [{ line_item_id: "L1", qty: 1 }, { line_item_id: "L2", qty: 1 }] });
  assert.equal(p.ok, true, p.error ?? "");
  const kit = (p.creditNoteBody!.line_items as { item_id?: string; mapped_items?: unknown }[]).find((l) => l.item_id === "KIT")!;
  assert.deepEqual(kit.mapped_items, [
    { item_id: "BOX", quantity: 1, warehouse_id: "W1", batches: [{ batch_id: "LB19", batch_number: "LEDBOX19", in_quantity: 1 }] },
    { item_id: "BAG", quantity: 1, warehouse_id: "W1" },
  ]);
});

test("COD back before the courier paid out is a cancellation; remitted COD or a partial return stays a return", async () => {
  const { codReturnIsCancellation } = await import("@/lib/orders/order-adjustment");
  assert.equal(codReturnIsCancellation({ kind: "returned", gateway: "COD", payoutId: null, fullCredit: true }), true);
  assert.equal(codReturnIsCancellation({ kind: "refunded", gateway: " cod ", payoutId: null, fullCredit: true }), true);
  assert.equal(codReturnIsCancellation({ kind: "returned", gateway: "COD", payoutId: "CP17187", fullCredit: true }), false);
  assert.equal(codReturnIsCancellation({ kind: "returned", gateway: "COD", payoutId: null, fullCredit: false }), false);
  assert.equal(codReturnIsCancellation({ kind: "returned", gateway: "Tabby", payoutId: null, fullCredit: true }), false);
  assert.equal(codReturnIsCancellation({ kind: "exchanged", gateway: "COD", payoutId: null, fullCredit: true }), false);
});
