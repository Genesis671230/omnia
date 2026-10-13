import { test } from "node:test";
import assert from "node:assert/strict";
import { designOf, learnPackaging, packagingSku, ruleFor, suggestPackaging, sumPack } from "@/lib/ksa-dispatch/packaging";
import { buildKsaRows, findMonthTab, inTab, KSA_HEADERS, newMonthTabTitle, phoneWithCode, placeRows, shipDateLabel } from "@/lib/ksa-dispatch/sheet-rows";

const col = (name: string) => KSA_HEADERS.indexOf(name as (typeof KSA_HEADERS)[number]);

// OS4301 as the team typed it in "KSA Orders // Oct 2026" on 2026-10-10.
test("rows match the team's OS4301 rows", () => {
  const rows = buildKsaRows(
    { order_number: "OS4301", customer_name: "TAHANI ALHAJRI", customer_phone: "+97470300292", city: "Ain Khaled", country: "QA", shipping_address1: "Zone 56 Street 610 House 40" },
    [{ sku: "999029883C1B16", qty: 1 }, { sku: "SET101", qty: 1 }, { sku: "BAN101", qty: 1 }, { sku: "PAP999", qty: 1 }],
    "2026-10-10",
  );
  assert.equal(rows.length, 4);
  const r = rows[0];
  assert.equal(r.length, 29);
  assert.equal(r[col("ReferenceNumber")], "OS4301");
  assert.equal(r[col("ShipCarrier")], "SMSA");
  assert.equal(r[col("ShipService")], "DLV");
  assert.equal(r[col("ShipDate")], "10-Oct-26");
  assert.equal(r[col("ShipToMobile")], "97470300292");
  assert.equal(r[col("ShipToCompany")], "OMNIASTORES LLC (KSA FULFILLMENT)");
  assert.equal(r[col("ShipToAddress1")], "Zone 56 Street 610 House 40\nAin Khaled\nQatar");
  assert.equal(r[col("ShipToAddress2")], r[col("ShipToAddress1")]);
  assert.equal(r[col("ShipToCity")], "Ain Khaled");
  assert.equal(r[col("ShipToCountry")], "Qatar");
  assert.equal(r[col("CODAmount")], "0");
  assert.deepEqual(rows.map((x) => [x[col("SKU")], x[col("Quantity")]]), [["999029883C1B16", "1"], ["SET101", "1"], ["BAN101", "1"], ["PAP999", "1"]]);
});

test("Arabic city: address keeps it as typed, ShipToCity goes English", () => {
  const [r] = buildKsaRows(
    { order_number: "SA4069", customer_name: "Sara Alsulaiman", customer_phone: "0507811744", city: "جدة", country: "SA", shipping_address1: "7094 مالك بن نويره, الزهراء" },
    [{ sku: "999018998C0B15", qty: 1 }], "2026-10-10",
  );
  assert.equal(r[col("ShipToAddress1")], "7094 مالك بن نويره, الزهراء\nجدة\nSaudi Arabia");
  assert.equal(r[col("ShipToCity")], "Jeddah");
  assert.equal(r[col("ShipToMobile")], "966507811744");
});

test("phones get the country code, digits only", () => {
  assert.equal(phoneWithCode("0553637139", "SA"), "966553637139");
  assert.equal(phoneWithCode("533999015", "SA"), "966533999015");
  assert.equal(phoneWithCode("+966 50 383 5198", "SA"), "966503835198");
  assert.equal(phoneWithCode("00966503835198", "SA"), "966503835198");
  assert.equal(phoneWithCode("+97470300292", "QA"), "97470300292");
  assert.equal(phoneWithCode("", "SA"), "");
});

test("ship date and month tab", () => {
  assert.equal(shipDateLabel("2026-10-03"), "03-Oct-26");
  const titles = ["KSA DISPATCH", "KSA Orders // Oct 2026", "KSA Orders // Sep 2026", "KSA Orders // August 2026", "KSA orders // May 2025"];
  assert.equal(findMonthTab(titles, "2026-10-10"), "KSA Orders // Oct 2026");
  assert.equal(findMonthTab(titles, "2026-08-01"), "KSA Orders // August 2026");
  assert.equal(findMonthTab(titles, "2025-05-09"), "KSA orders // May 2025");
  assert.equal(findMonthTab(titles, "2026-11-01"), null);
  assert.equal(newMonthTabTitle("2026-11-01"), "KSA Orders // Nov 2026");
});

test("placement: first order of the day opens a block, later ones join it", () => {
  const header = [...KSA_HEADERS];
  const yesterday = Array(29).fill(""); yesterday[0] = "OS4290"; yesterday[col("ShipDate")] = "08-Oct-26";
  const rows = [["OS4301"]];
  // trailing empty rows are ignored
  const a = placeRows([header, yesterday, [], []], rows, "10-Oct-26");
  assert.equal(a.startRow, 3);
  assert.deepEqual(a.write, [[], header, ["OS4301"]]);

  const today = Array(29).fill(""); today[0] = "OS4301"; today[col("ShipDate")] = "10-Oct-26";
  const b = placeRows([header, yesterday, [], header, today], [["OS4303"]], "10-Oct-26");
  assert.equal(b.startRow, 6);
  assert.deepEqual(b.write, [["OS4303"]]);

  const c = placeRows([], rows, "10-Oct-26");
  assert.equal(c.startRow, 1);
  assert.deepEqual(c.write, [header, ["OS4301"]]);
  assert.equal(inTab([header, today], "os4301"), true);
  assert.equal(inTab([header, today], "OS4303"), false);
});

const sheetRows = (ref: string, skus: [string, number][]) => skus.map(([sku, qty]) => ({ ref, sku, qty }));

test("history: per-unit packaging from single-product orders, design fallback", () => {
  const h = learnPackaging([
    ...sheetRows("OS1", [["999029883C1B16", 1], ["SET101", 1], ["BRAC101", 1], ["PAP999", 1]]),
    ...sheetRows("OS2", [["999029883C3B16", 2], ["SET101", 2], ["BRAC101", 2], ["PAP999", 2]]),
    // two products — ignored, can't attribute the boxes
    ...sheetRows("OS3", [["999029883C1B16", 1], ["888633C1B16", 1], ["SET101", 2], ["BAN101", 2], ["PAP999", 2]]),
    ...sheetRows("OS4", [["999016692C0", 1], ["PEN102", 1], ["LED Ring Box - LEDBOX1", 1], ["PAP666", 2]]),
  ]);
  assert.deepEqual(h.get("999029883C1B16")?.pack, [{ sku: "BRAC101", qty: 1 }, { sku: "PAP999", qty: 1 }, { sku: "SET101", qty: 1 }]);
  assert.equal(h.get("design:999029883")?.orders, 2);
  assert.deepEqual(h.get("999016692C0")?.pack, [{ sku: "LEDR1", qty: 1 }, { sku: "PAP666", qty: 2 }, { sku: "PEN102", qty: 1 }]);

  // A colour never shipped from KSA uses its design's history; quantity scales.
  const s = suggestPackaging([{ sku: "999029883C5B16", qty: 2, title: "Adaliya Full Set" }], h);
  assert.match(s.perLine[0].basis, /this design/);
  assert.deepEqual(s.total, [{ sku: "SET101", qty: 2 }, { sku: "PAP999", qty: 2 }, { sku: "BRAC101", qty: 2 }]);
});

test("rules when there is no history", () => {
  assert.deepEqual(ruleFor({ sku: "999031783C123B16", qty: 1, title: "Omnia Simra Multicolor Luxury Bridal Full Set" }).pack.map((p) => p.sku), ["SET101", "PAP999", "BAN101"]);
  assert.deepEqual(ruleFor({ sku: "999016658C1", qty: 1, title: "Full set Rhodium White Adjustable" }).pack.map((p) => p.sku), ["SET101", "PAP999"]);
  assert.deepEqual(ruleFor({ sku: "QE7817-1", qty: 1, title: "Fashion Accessories Earring Black Agate" }).pack.map((p) => p.sku), ["EAR101", "PAP666"]);
  assert.equal(designOf("8887359C1"), "8887359");
  assert.equal(packagingSku("set101"), "SET101");
  assert.equal(packagingSku("LED Pendant Box - LEDBOX1"), "PEN102");
  assert.equal(packagingSku("999029883C1B16"), null);
  assert.deepEqual(sumPack([{ sku: "PAP999", qty: 1 }, { sku: "SET101", qty: 1 }, { sku: "PAP999", qty: 1 }, { sku: "BAN101", qty: 0 }]), [{ sku: "SET101", qty: 1 }, { sku: "PAP999", qty: 2 }]);
});

import { planClose, type SoDetail, type PackItem } from "@/lib/sales-orders/so-plan";

test("planClose warehouseOverride: product + packaging move to KSA, stock checked there", () => {
  const so: SoDetail = {
    salesorder_id: "S1", salesorder_number: "OS4301", status: "draft", date: "2026-10-09", customer_id: "C1",
    tax_treatment: "gcc_vat_not_registered", place_of_supply: "QA", currency_code: "AED", total: 1324.6,
    line_items: [
      { line_item_id: "L1", item_id: "I-P", sku: "999029883C1B16", quantity: 1, rate: 1269.6, tax_id: "ZERO", item_total: 1269.6, warehouse_id: "UAE", item_type: "inventory" },
      { line_item_id: "L2", item_id: "I-SHIP", name: "Shipping", quantity: 1, rate: 55, tax_id: "ZERO", item_total: 55, product_type: "service" },
    ],
  };
  const items = new Map<string, PackItem>([["SET101", { item_id: "I-SET", sku: "SET101", name: "Set box", stockTracked: true, trackBatch: true }]]);
  const stock = new Map([["I-P", new Map([["KSA", 1], ["UAE", 5]])], ["I-SET", new Map([["KSA", 0], ["UAE", 900]])]]);
  const taxes = { UAE: { tax_id: "STD", pct: 5 }, GCC: { tax_id: "ZERO", pct: 0 }, INTL: { tax_id: "ZERO", pct: 0 } };
  const p = planClose({ so, order: { country: "QA", currency: "AED", grossOriginal: 1324.6 }, packaging: [{ sku: "SET101", qty: 1 }], items, stock, taxes, defaultWarehouse: "UAE", warehouseOverride: "KSA" });
  const lines = (p.update!.line_items as { item_id: string; warehouse_id?: string }[]);
  assert.equal(lines.find((l) => l.item_id === "I-P")?.warehouse_id, "KSA");
  assert.equal(lines.find((l) => l.item_id === "I-SET")?.warehouse_id, "KSA");
  assert.equal(lines.find((l) => l.item_id === "I-SHIP")?.warehouse_id, undefined);
  assert.ok(p.issues.some((i) => i.code === "stock_short" && /SET101/.test(i.message)), "SET101 is short in KSA, not UAE");
  assert.equal(p.state, "blocked");
});
