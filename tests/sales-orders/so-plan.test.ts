import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, invoiceDateFor, planClose, type SoDetail, type PackItem } from "@/lib/sales-orders/so-plan";
import { parsePackingTab, sheetIdFromInput } from "@/lib/sales-orders/packing-sheet";

const WH = "WH-MAIN";
const taxes = { UAE: { tax_id: "STD", pct: 5 }, GCC: { tax_id: "ZERO", pct: 0 }, INTL: { tax_id: "ZERO", pct: 0 } };
const items = new Map<string, PackItem>([
  ["SET101", { item_id: "I-SET", sku: "SET101", name: "LED Set Box", stockTracked: true, trackBatch: true }],
  ["PAP999", { item_id: "I-BAGB", sku: "PAP999", name: "Paper Bag Large", stockTracked: true }],
  ["BRAC101", { item_id: "I-BRAC", sku: "BRAC101", name: "Bracelet Box", stockTracked: true }],
]);

// OS4256 as it sat in Zoho on 2026-10-07: UAE, shipping line tax-exempt.
const os4256 = (): SoDetail => ({
  salesorder_id: "SO1", salesorder_number: "OS4256", status: "draft", date: "2026-10-07", customer_id: "C1",
  tax_treatment: "vat_not_registered", place_of_supply: "SH", currency_code: "AED", total: 784.57,
  line_items: [
    { line_item_id: "L1", item_id: "P1", sku: "999018966C1B16", quantity: 1, rate: 720, tax_id: "STD", tax_percentage: 5, item_total: 720, warehouse_id: WH, item_type: "inventory", product_type: "goods" },
    { line_item_id: "L2", item_id: "SHIP", sku: "Shipping", quantity: 1, rate: 28.57, tax_id: "", tax_exemption_id: "EX", item_total: 28.57, item_type: "sales_and_purchases", product_type: "service" },
  ],
});

test("UAE draft: shipping gets 5%, packaging added, total matches the order", () => {
  const p = planClose({
    so: os4256(), order: { country: "AE", currency: "AED", grossOriginal: 786 },
    packaging: [{ sku: "PAP999", qty: 1 }, { sku: "SET101", qty: 1 }, { sku: "BRAC101", qty: 1 }],
    items, stock: new Map([["P1", new Map([[WH, 7]])], ["I-SET", new Map([[WH, 100]])]]), taxes, defaultWarehouse: WH,
  });
  assert.equal(p.state, "ready", JSON.stringify(p.issues));
  assert.equal(p.expectedTotal, 786);
  const lines = p.update!.line_items as { item_id: string; tax_id: string; rate: number; warehouse_id?: string }[];
  assert.equal(lines.length, 5);
  assert.ok(lines.every((l) => l.tax_id === "STD"));
  assert.deepEqual(lines.slice(2).map((l) => [l.item_id, l.rate, l.warehouse_id]), [["I-BAGB", 0, WH], ["I-SET", 0, WH], ["I-BRAC", 0, WH]]);
  assert.equal(p.update!.tax_treatment, "vat_not_registered");
  assert.equal(p.update!.place_of_supply, "SH");
});

test("KSA draft with UAE treatment: moved to GCC non-VAT, SA, zero rate, SAR at 0.98", () => {
  const so: SoDetail = {
    ...os4256(), salesorder_number: "SA4066", total: 1660.86,
    line_items: [
      { line_item_id: "L1", item_id: "P1", quantity: 1, rate: 818.67, tax_id: "ZERO", item_total: 818.67, warehouse_id: WH, item_type: "inventory" },
      { line_item_id: "L2", item_id: "SHIP", quantity: 1, rate: 55, tax_id: "", item_total: 55 },
      { line_item_id: "L3", item_id: "P2", quantity: 1, rate: 787.19, tax_id: "ZERO", item_total: 787.19, warehouse_id: WH, item_type: "inventory" },
    ],
  };
  const p = planClose({ so, order: { country: "SA", currency: "SAR", grossOriginal: 1693.63 }, packaging: [{ sku: "SET101", qty: 1 }], items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.equal(p.region, "GCC");
  assert.equal(p.update!.tax_treatment, "gcc_vat_not_registered");
  assert.equal(p.update!.place_of_supply, "SA");
  assert.ok((p.update!.line_items as { tax_id: string }[]).every((l) => l.tax_id === "ZERO"));
  assert.equal(p.orderTotalAed, 1659.76);
  assert.equal(p.state, "ready", JSON.stringify(p.issues)); // 1660.86 vs 1659.76: inside 0.2%
});

test("blocks: unknown packaging SKU, short stock, not in sheet", () => {
  const unknown = planClose({ so: os4256(), order: { country: "AE", currency: "AED", grossOriginal: 786 }, packaging: [{ sku: "CLCH101", qty: 1, description: "Clutch Bag" }], items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.equal(unknown.state, "blocked");
  assert.ok(unknown.issues.some((i) => i.code === "unknown_sku"));

  const short = planClose({ so: os4256(), order: { country: "AE", currency: "AED", grossOriginal: 786 }, packaging: [{ sku: "SET101", qty: 2 }], items, stock: new Map([["I-SET", new Map([[WH, 1]])]]), taxes, defaultWarehouse: WH });
  assert.ok(short.issues.some((i) => i.code === "stock_short" && i.message.includes("needs 2, 1 available")));

  const noSheet = planClose({ so: os4256(), order: null, packaging: null, items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.ok(noSheet.issues.some((i) => i.code === "not_in_sheet"));
});

test("packaging already on the draft is not added twice", () => {
  const so = os4256();
  so.line_items.push({ line_item_id: "L3", item_id: "I-SET", sku: "SET101", quantity: 1, rate: 0, tax_id: "STD", item_total: 0, warehouse_id: WH, item_type: "inventory" });
  const p = planClose({ so, order: { country: "AE", currency: "AED", grossOriginal: 786 }, packaging: [{ sku: "SET101", qty: 1 }], items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.equal((p.update!.line_items as unknown[]).length, 3);
});

test("closed sales orders need nothing", () => {
  const p = planClose({ so: { ...os4256(), status: "invoiced" }, order: null, packaging: null, items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.equal(p.state, "closed");
});

test("packing tab: order rows, SKU on the order row, duplicates summed, verification block ignored", () => {
  const rows = [
    ["Count", "Client #", "SKU", "BOX TYPE", "", "TOTAL ORDERS", "", "VERIFICATION"],
    ["", "", "", "", "", "31", "", "SKU", "Description"],
    ["", "", "", " ", "1", "", "", "SET101", "SET BOX", "312"],
    ["1", "SA4063", "", " ", "1", "", "", "PEN102", "PENDANT BOX"],
    ["", "", "PAP999", "BAG(B)", "1"],
    ["", "", "PAP999", "BAG(B)", "1"],
    ["5", "OS4041", "PAP999", "BAG(B)", "1"],
    ["", "", "SET101", "SET BOX", "1"],
    ["", "os3990", "", " ", "1"],
    ["23", "801907", "BRAC101", "BRACELET BOX", "1"],
  ];
  const o = parsePackingTab(rows, 7);
  assert.deepEqual(o.map((x) => x.orderNumber), ["SA4063", "OS4041", "OS3990", "801907"]);
  assert.deepEqual(o[0].packaging, [{ sku: "PAP999", description: "BAG(B)", qty: 2 }]);
  assert.deepEqual(o[1].packaging.map((p) => p.sku), ["PAP999", "SET101"]);
  assert.equal(o[2].packaging.length, 0);
  assert.equal(o[3].packaging[0].sku, "BRAC101");
  assert.equal(o[0].day, 7);
});

test("sheet id from a pasted URL", () => {
  assert.equal(sheetIdFromInput("https://docs.google.com/spreadsheets/d/1krsLLGY9OgEF89l5ac71B8PjPobcuM2yXwas9fcTai4/edit?gid=660468645#gid=660468645"), "1krsLLGY9OgEF89l5ac71B8PjPobcuM2yXwas9fcTai4");
});

test("batch pick: FIFO across batches, null when short", async () => {
  const { pickBatches } = await import("@/lib/sales-orders/zoho-so");
  const b = [{ batch_id: "A", batch_number: "BT1", balance: 1, date: "2026-08-01" }, { batch_id: "B", batch_number: "BT50", balance: 9, date: "2026-09-01" }];
  assert.deepEqual(pickBatches(b, 2), [{ batch_id: "A", batch_number: "BT1", out_quantity: 1 }, { batch_id: "B", batch_number: "BT50", out_quantity: 1 }]);
  assert.equal(pickBatches(b, 11), null);
});

test("SKU alias maps a sheet SKU onto a Zoho item; rates come from the rules", () => {
  const rules = { ...DEFAULT_RULES, aliases: { LEDR199: "SET101" }, rates: { ...DEFAULT_RULES.rates, AED: 1 } };
  const p = planClose({ so: os4256(), order: { country: "AE", currency: "AED", grossOriginal: 786 }, packaging: [{ sku: "LEDR199", qty: 1 }], items, stock: new Map(), taxes, defaultWarehouse: WH, rules });
  assert.equal(p.state, "ready", JSON.stringify(p.issues));
  assert.ok(p.changes.some((c) => c.includes("SET101")));
  const noRate = planClose({ so: os4256(), order: { country: "AE", currency: "EUR", grossOriginal: 100 }, packaging: [], items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.ok(noRate.issues.some((i) => i.code === "no_rate"));
});

test("invoice date: order day, else dispatch day, else the SO date", () => {
  const so = os4256();
  assert.equal(invoiceDateFor("order", so, "2026-10-06", "2026-10-07"), "2026-10-06");
  assert.equal(invoiceDateFor("order", so, null, "2026-10-07"), "2026-10-07");
  assert.equal(invoiceDateFor("dispatch", so, "2026-10-06", "2026-10-07"), "2026-10-07");
  assert.equal(invoiceDateFor("salesorder", so, "2026-10-06", "2026-10-07"), so.date);
});

test("OS4252: draft 5% a line vs store discount AED 99 → spread to match 2719.05", () => {
  const L = (id: string, rate: number) => ({ line_item_id: id, item_id: id, sku: id, quantity: 1, rate, discount: "5.00%", tax_id: "STD", item_total: r95(rate), warehouse_id: WH, item_type: "inventory", product_type: "goods" });
  const r95 = (n: number) => Math.round(n * 0.95 * 100) / 100;
  const so: SoDetail = {
    ...os4256(), salesorder_number: "OS4252", total: 2681.92,
    line_items: [L("A", 690), { line_item_id: "S", item_id: "SHIP", sku: "Shipping", quantity: 1, rate: 28.57, tax_id: "", tax_exemption_id: "EX", item_total: 28.57, product_type: "service" }, L("B", 680), L("C", 690), L("D", 600)],
  };
  const p = planClose({ so, order: { country: "AE", currency: "AED", grossOriginal: 2719.05, discountAed: 99 }, packaging: [], items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.equal(p.state, "ready", JSON.stringify(p.issues));
  assert.equal(p.expectedTotal, 2719.05);
  const d = (p.update!.line_items as { line_item_id?: string; discount: unknown }[]).filter((l) => l.line_item_id !== "S").reduce((s, l) => s + Number(l.discount), 0);
  assert.equal(Math.round(d * 100) / 100, 99);
});

test("rejected batch name is read from Zoho's 2309 message", async () => {
  const { rejectedBatch } = await import("@/lib/sales-orders/zoho-so");
  assert.equal(rejectedBatch("Zoho POST /invoices (code 2309): Batch LEDBOX2 is not available in selected location for the item LED Set Box - LEDBOX2"), "LEDBOX2");
  assert.equal(rejectedBatch("The batch number cannot be left empty for item X"), null);
});

test("COD booked in another org: every line goes to AED 0, no amount check, stock still moves", () => {
  const p = planClose({
    so: os4256(), order: { country: "AE", currency: "AED", grossOriginal: 999, gateway: "COD" },
    packaging: [{ sku: "SET101", qty: 1 }], items, stock: new Map(), taxes, defaultWarehouse: WH, codZero: true,
  });
  assert.equal(p.state, "ready", JSON.stringify(p.issues)); // 999 ≠ 786 but COD isn't priced here
  assert.equal(p.cod, true);
  assert.equal(p.expectedTotal, 0);
  assert.equal(p.orderTotalAed, 999);
  const lines = p.update!.line_items as { rate: number; discount?: number; quantity: number }[];
  assert.ok(lines.every((l) => l.rate === 0 && (l.discount ?? 0) === 0));
  assert.equal(lines[0].quantity, 1);
  assert.deepEqual(p.consume.map((c) => c.item_id), ["P1", "I-SET"]);
  assert.ok(p.changes.some((c) => c.startsWith("COD")));
});

test("COD without codZero (its SO is in the COD org itself): priced as usual", () => {
  const p = planClose({ so: os4256(), order: { country: "AE", currency: "AED", grossOriginal: 786, gateway: "COD" }, packaging: [], items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.equal(p.cod, false);
  assert.equal(p.expectedTotal, 786);
});

import { matchTotal, MATCH_MAX_PCT } from "@/lib/sales-orders/so-plan";

const gccTaxes = { UAE: { tax_id: "STD", pct: 5 }, GCC: { tax_id: "ZERO", pct: 0 }, INTL: { tax_id: "ZERO", pct: 0 } };
const draft = (lines: { id: string; rate: number; qty?: number; ship?: boolean; discount?: string | number }[], total: number): SoDetail => ({
  salesorder_id: "S", salesorder_number: "OS4303", status: "draft", date: "2026-10-08", customer_id: "C",
  tax_treatment: "gcc_vat_not_registered", place_of_supply: "SA", currency_code: "AED", total,
  line_items: lines.map((l) => ({
    line_item_id: l.id, item_id: `I-${l.id}`, name: l.ship ? "Shipping" : "Set", quantity: l.qty ?? 1, rate: l.rate, discount: l.discount,
    tax_id: "ZERO", item_total: l.rate * (l.qty ?? 1) - (typeof l.discount === "number" ? l.discount : 0),
    ...(l.ship ? { product_type: "service" } : { item_type: "inventory", warehouse_id: "WH" }),
  })),
});

test("match SO to order: OS4303 840.88 → 841.65, shipping untouched", () => {
  const so = draft([{ id: "P", rate: 785.88 }, { id: "SH", rate: 55, ship: true }], 840.88);
  const p = planClose({ so, order: { country: "SA", currency: "AED", grossOriginal: 841.65 }, packaging: [], items: new Map(), stock: new Map(), taxes: gccTaxes, defaultWarehouse: "WH", matchOrderTotal: true });
  assert.equal(p.expectedTotal, 841.65);
  const lines = p.update!.line_items as { line_item_id?: string; rate: number }[];
  assert.equal(lines.find((l) => l.line_item_id === "SH")!.rate, 55);
  assert.equal(lines.find((l) => l.line_item_id === "P")!.rate, 786.65);
  assert.ok(p.changes.some((c) => /scaled/.test(c)));
  assert.deepEqual(p.fx, { currency: "AED", paid: 841.65, rate: 1, aed: 841.65, source: "fixed" });
  assert.equal(p.state, "ready");
});

test("rate override: SAR order at 0.975 instead of 0.98, with 5% VAT and two items", () => {
  const so = draft([{ id: "A", rate: 500, qty: 2 }, { id: "B", rate: 300, discount: 30 }, { id: "SH", rate: 30, ship: true }], 1335);
  const taxes5 = { ...gccTaxes, GCC: { tax_id: "STD", pct: 5 } };
  const p = planClose({ so, order: { country: "SA", currency: "SAR", grossOriginal: 1400 }, packaging: [], items: new Map(), stock: new Map(), taxes: taxes5, defaultWarehouse: "WH", rateOverride: 0.975, matchOrderTotal: true });
  assert.equal(p.fx?.rate, 0.975);
  assert.equal(p.fx?.source, "override");
  assert.equal(p.orderTotalAed, 1365);
  assert.equal(p.expectedTotal, 1365);
  const b = (p.update!.line_items as { line_item_id?: string; discount?: unknown }[]).find((l) => l.line_item_id === "B")!;
  assert.equal(b.discount, 30, "absolute discount kept");
});

test("match refuses a gap above the limit — stays flagged", () => {
  const so = draft([{ id: "P", rate: 700 }], 700);
  const p = planClose({ so, order: { country: "SA", currency: "AED", grossOriginal: 841.65 }, packaging: [], items: new Map(), stock: new Map(), taxes: gccTaxes, defaultWarehouse: "WH", matchOrderTotal: true });
  assert.equal(p.state, "blocked");
  assert.ok(p.issues.some((i) => i.code === "amount_diff" && i.message.includes(`max ${MATCH_MAX_PCT}%`)));
  assert.equal(matchTotal(so.line_items, [], 800, 0), null);
});

test("confirmed SO: its own committed units count as available to it (OS4319 KSA 0 → ok)", () => {
  const so = { ...draft([{ id: "P", rate: 800 }], 800), status: "open" };
  so.line_items[0].warehouse_id = "KSA";
  // Zoho's available-for-sale already excludes the unit this SO commits
  const stock = new Map([["I-P", new Map([["KSA", 0]])]]);
  const p = planClose({ so, order: { country: "SA", currency: "AED", grossOriginal: 800 }, packaging: [], items: new Map(), stock, taxes: gccTaxes, defaultWarehouse: "UAE" });
  assert.ok(!p.issues.some((i) => i.code === "stock_short"), JSON.stringify(p.issues));
  const draftSo = { ...so, status: "draft" };
  const d = planClose({ so: draftSo, order: { country: "SA", currency: "AED", grossOriginal: 800 }, packaging: [], items: new Map(), stock, taxes: gccTaxes, defaultWarehouse: "UAE" });
  assert.ok(d.issues.some((i) => i.code === "stock_short"), "a draft commits nothing — 0 is really 0");
});

// 2026-10-12 screenshot: draft carries kit ledsp9 (SET101 + PAP999) at AED 0,
// the sheet says 1× PAP999, 1× SET101, 1× BRAC101; PAP999 reads −98 in Zoho.
const ledsp9 = new Map([["I-KIT", { sku: "ledsp9", components: [
  { item_id: "I-SET", sku: "SET101", name: "LED Set Box", stockTracked: true, trackBatch: true, qty: 1 },
  { item_id: "I-BAGB", sku: "PAP999", name: "Paper Bag Large", stockTracked: true, qty: 1 },
] }]]);
const withKit = () => {
  const so = os4256();
  so.line_items.push({ line_item_id: "LK", item_id: "I-KIT", sku: "ledsp9", quantity: 1, rate: 0, tax_id: "STD", item_total: 0, item_type: "sales", product_type: "goods" });
  return so;
};
const order786 = { country: "AE", currency: "AED", grossOriginal: 786 };

test("kit on the draft: swapped for the sheet's boxes, nothing counted twice, not blocked", () => {
  const p = planClose({ so: withKit(), order: order786, packaging: [{ sku: "PAP999", qty: 1 }, { sku: "SET101", qty: 1 }, { sku: "BRAC101", qty: 1 }], items, stock: new Map(), taxes, defaultWarehouse: WH, combos: ledsp9 });
  assert.equal(p.state, "ready", JSON.stringify(p.issues));
  const lines = p.update!.line_items as { item_id: string; line_item_id?: string }[];
  assert.ok(!lines.some((l) => l.item_id === "I-KIT"), "kit line comes off");
  assert.deepEqual(lines.filter((l) => !l.line_item_id).map((l) => l.item_id), ["I-BAGB", "I-SET", "I-BRAC"]);
  assert.ok(p.changes.some((c) => c.startsWith("− 1 × ledsp9")));
});

test("kit with no packaging rows on the sheet: its own components go out", () => {
  const p = planClose({ so: withKit(), order: order786, packaging: [], items, stock: new Map(), taxes, defaultWarehouse: WH, combos: ledsp9 });
  const lines = p.update!.line_items as { item_id: string; line_item_id?: string }[];
  assert.deepEqual(lines.filter((l) => !l.line_item_id).map((l) => l.item_id), ["I-SET", "I-BAGB"]);
  assert.ok(!p.issues.some((i) => i.code === "no_packaging"));
});

test("unknown kit (no components read) still blocks", () => {
  const p = planClose({ so: withKit(), order: order786, packaging: [{ sku: "SET101", qty: 1 }], items, stock: new Map(), taxes, defaultWarehouse: WH });
  assert.ok(p.issues.some((i) => i.code === "bundle_on_so" && i.blocking));
});

test("bag below zero in Zoho books warns, batch-tracked box short still blocks", () => {
  const bag = planClose({ so: os4256(), order: order786, packaging: [{ sku: "PAP999", qty: 1 }], items, stock: new Map([["I-BAGB", new Map([[WH, -98]])]]), taxes, defaultWarehouse: WH });
  assert.equal(bag.state, "ready", JSON.stringify(bag.issues));
  assert.ok(bag.issues.some((i) => i.code === "stock_short" && !i.blocking && i.message.includes("-98")));
  const batchItems = new Map(items); batchItems.set("SET101", { ...items.get("SET101")!, trackBatch: true });
  const box = planClose({ so: os4256(), order: order786, packaging: [{ sku: "SET101", qty: 1 }], items: batchItems, stock: new Map([["I-SET", new Map([[WH, 0]])]]), taxes, defaultWarehouse: WH });
  assert.equal(box.state, "blocked");
});

test("dispatch sheet comments → what the board suggests (October 2026 rows)", async () => {
  const { sheetSays } = await import("@/lib/sales-orders/so-close.service");
  const row = (comments: string, kind: any = "sale", saleType = "Paid", cancelledRefundedAed: number | null = null) => ({ comments, kind, saleType, cancelledRefundedAed });
  assert.equal(sheetSays([row("URGENT ORDER ")]), null);
  assert.equal(sheetSays([row("Dispatch from KSA")]), null);
  assert.equal(sheetSays([row("URGENT ORDER - 1 item returned and refunded  - 694.43", "partial_refund", "Paid", 694.43)])?.kind, "partial");
  assert.equal(sheetSays([row("URGENT ORDER  - Returned and refunded  - 1219.20", "refunded")])?.kind, "returned");
  assert.equal(sheetSays([row("CANCELLED BEFORE DISPATCH - 1132.50", "cancelled", "COD")])?.kind, "cancelled");
  assert.equal(sheetSays([row("cancelled BD  - 1237.50", "sale", "COD")])?.kind, "cancelled");
  assert.equal(sheetSays([row("Cancelled and Returned - 1089.45", "cancelled")])?.kind, "returned");
  assert.equal(sheetSays([row("URGENT ORDER "), row("to be refunded with 210 AED", "exchange", "Exchange")])?.kind, "exchanged");
  const n = sheetSays([row("COD to Stripe - Urgent OT")]);
  assert.equal(n?.kind, "note"); assert.deepEqual(n?.notes, ["COD to Stripe - Urgent OT"]);
});
