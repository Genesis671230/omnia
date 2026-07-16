import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayoutFile } from "@/lib/parsers/payouts";

test("parsePayoutFile: detects a COD file by 'ON TRACK DELIVERY' content even without a hint", () => {
  const csv = [
    "ON TRACK DELIVERY SERVICES — INVOICE #16964,Order Number,COD Amount",
    "Service Description,5001,100.00",
  ].join("\n");
  const buf = Buffer.from(csv, "utf8");

  const [payout] = parsePayoutFile(buf, "remittance.csv");
  assert.equal(payout.provider, "COD");
  assert.equal(payout.id, "COD-16964");
});

test("parsePayoutFile: routes to the COD parser via hint when content sniffing doesn't recognize the file", () => {
  const csv = ["Order Number,Net Amount", "5001,100.00"].join("\n");
  const buf = Buffer.from(csv, "utf8");

  const [payout] = parsePayoutFile(buf, "courier.csv", "COD");
  assert.equal(payout.provider, "COD");
});

test("parsePayoutFile: detects a Checkout.com export by its header shape even without a hint", () => {
  const csv = [
    "Client Entity Name,Currency Account ID,Action Type,Payment ID,Processed On,Holding Currency,Holding Currency Amount,Breakdown Type,Reference",
    "OmniaStores LLC,ca_1,Authorization,pay_x,2026-07-10 10:00:00,AED,100.00,Authorization Fixed Fee,#8001",
  ].join("\n");
  const buf = Buffer.from(csv, "utf8");

  const [payout] = parsePayoutFile(buf, "checkout.csv");
  assert.equal(payout.provider, "Checkout");
});

test("parsePayoutFile: existing Telr/Tabby/Tamara/Stripe detection is unaffected", () => {
  const stripeCsv = [
    "automatic_payout_id,net,gross,fee,description",
    "po_1,95,100,5,#9001",
  ].join("\n");
  const [payout] = parsePayoutFile(Buffer.from(stripeCsv, "utf8"), "stripe.csv");
  assert.equal(payout.provider, "Stripe");
});
