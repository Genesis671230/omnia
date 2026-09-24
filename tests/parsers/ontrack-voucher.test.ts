import { test } from "node:test";
import assert from "node:assert/strict";
import { onTrackVoucherToPayout, parseOnTrackVoucherPages, type PdfItem } from "@/lib/parsers/ontrack-voucher";
import { planOrderPosting } from "@/lib/finance/settlement-posting";

// Positions copied from the live voucher CP17175 (18 Sep 2026): header row,
// a return whose Bill No wraps over three lines, a prepaid delivery, a COD
// order, and a status that wraps ("Delivered With" / "Price Change").
const header: PdfItem[] = [
  { s: "Client Payment Voucher", x: 221, y: 388 }, { s: "On Track Delivery Services", x: 207, y: 376 },
  { s: "CPC12376 (CP17175)", x: 411, y: 377 }, { s: "Date : 18-September-2026", x: 464, y: 389 },
  { s: "Client Money", x: 120, y: 300 }, { s: "Del Price", x: 178, y: 300 }, { s: "Pro Price", x: 220, y: 300 },
  { s: "Customer Address", x: 272, y: 301 }, { s: "Mob No", x: 355, y: 300 }, { s: "Customer", x: 411, y: 300 },
  { s: "Bill No", x: 465, y: 300 }, { s: "Voucher No", x: 497, y: 300 }, { s: "Status", x: 56, y: 299 }, { s: "SL", x: 552, y: 299 },
];
const row = (y: number, status: string, cm: string, pro: string, bill: string[], voucher: string, sl: number, del = "28.57"): PdfItem[] => [
  { s: status, x: 53, y }, { s: cm, x: 128, y }, { s: del, x: 182, y }, { s: pro, x: 231, y },
  { s: voucher, x: 503, y }, { s: String(sl), x: 555, y },
  { s: "0502606648", x: 347, y: y - 1 }, { s: "هند", x: 440, y: y - 1 },
  ...bill.map((b, i) => ({ s: b, x: 462, y: y - 1 - 12 * i })),
];
const page1: PdfItem[] = [
  ...header,
  ...row(288, "Delivered", "-30.00", "0.00", ["rtn", "wa557", "36"], "OD13116", 1),
  ...row(252, "Delivered", "399.00", "429.00", ["80563", "1"], "12440", 2),
  ...row(216, "Delivered", "-30.00", "0.00", ["#3495"], "12441", 3),
  { s: "Delivered With", x: 43, y: 180 }, { s: "Price Change", x: 45, y: 168 },
  ...row(180, "", "-490.00", "0.00", ["wa557", "73"], "OD13149", 4, "466.67").filter((i) => i.s !== ""),
];
const page2: PdfItem[] = [
  { s: "Total Count", x: 30, y: 382 }, { s: "4", x: 129, y: 383 },
  { s: "Total Amount", x: 176, y: 379 }, { s: "-151.00", x: 302, y: 381 },
];

test("reads every row, joins wrapped Bill Nos, and splits COD orders from delivery charges", () => {
  const v = parseOnTrackVoucherPages([page1, page2]);
  assert.equal(v.cpNo, "17175");
  assert.equal(v.date, "2026-09-18");
  assert.deepEqual(v.cod.map((r) => [r.ref, r.proPrice, r.clientMoney]), [["805631", 429, 399]]);
  assert.deepEqual(v.charges.map((c) => [c.ref, c.amount, c.isReturn]), [["WA55736", 30, true], ["3495", 30, false], ["WA55773", 490, false]]);
  assert.equal(v.charges[2].status, "Delivered With Price Change");
  assert.equal(v.charges[2].exVat, 466.67);
  assert.equal(v.charges[2].vat, 23.33);
  assert.equal(v.totalAmount, -151);
  assert.equal(v.totalCount, 4);
});

test("payout: net = remittance, COD order carries gross / 30 fee / net, charges kept aside", () => {
  const p = onTrackVoucherToPayout(parseOnTrackVoucherPages([page1, page2]), "17175.pdf");
  assert.equal(p.id, "COD-17175");
  assert.equal(p.net, -151);
  assert.deepEqual(p.orderRefs, ["805631"]);
  assert.deepEqual(p.transactions?.[0], { ref: "805631", grossShare: 429, feeShare: 30, netShare: 399, isRefund: false, quality: "clean" });
  assert.equal(p.deliveryCharges.length, 3);
});

test("a voucher that doesn't foot to its own total is refused", () => {
  const wrong = page2.map((i) => (i.s === "-151.00" ? { ...i, s: "-150.00" } : i));
  assert.throws(() => onTrackVoucherToPayout(parseOnTrackVoucherPages([page1, wrong]), "x.pdf"), /Total Amount/);
  const short = page2.map((i) => (i.s === "4" ? { ...i, s: "5" } : i));
  assert.throws(() => onTrackVoucherToPayout(parseOnTrackVoucherPages([page1, short]), "x.pdf"), /Total Count/);
});

test("a COD order where the courier kept all 30 it collected books cleanly", () => {
  const p = planOrderPosting({ invoiceBalance: 30, grossAed: 30, feeAed: 30, netAed: 0, bankScale: 1, crossBorder: false, feeVatInclusive: true });
  assert.equal(p.review, null);
  assert.equal(p.fee, 30);
  assert.equal(p.feeVat, 1.43);
});
