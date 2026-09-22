import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayoutFile, withShopifyStore } from "@/lib/parsers/payouts";
import { pickShopifyStore } from "@/lib/finance/shopify-payout-store";

// The admin "Export transactions" file, verbatim header + the founder's sample rows.
const CSV = `Transaction Date,Type,Order,Card Brand,Card Source,Payout Status,Payout Date,Payout ID,Available On,Amount,Fee,Net,Checkout,Payment Method Name,Presentment Amount,Presentment Currency,Currency,Business Entity Name,Business Entity ID
2026-08-30 16:59:53 +0400,refund,#3426,visa,online,paid,2026-09-01,148156579998,2026-08-30,-1598.70,0.00,-1598.70,#43685329797278,card,1598.70,AED,AED,OmniaStores LLC,MTY5NDMzMDY1NjMw
2026-08-24 22:01:24 +0400,charge,#3439,master,online,paid,2026-09-01,148156579998,2026-09-01,988.21,57.68,930.53,#43736360550558,card,1010.40,SAR,AED,OmniaStores LLC,MTY5NDMzMDY1NjMw
2026-08-24 21:44:32 +0400,charge,#3438,visa,online,paid,2026-09-01,148156579998,2026-09-01,893.73,52.28,841.45,#43735957766302,card,913.80,SAR,AED,OmniaStores LLC,MTY5NDMzMDY1NjMw
2026-08-24 20:16:26 +0400,charge,#3437,visa,online,paid,2026-09-01,148156579998,2026-09-01,857.93,23.57,834.36,#43735502913694,card,857.93,AED,AED,OmniaStores LLC,MTY5NDMzMDY1NjMw
2026-08-23 17:39:31 +0400,charge,#3435,visa,online,paid,2026-09-01,148156579998,2026-09-01,870.00,23.89,846.11,#43725393035422,card,870.00,AED,AED,OmniaStores LLC,MTY5NDMzMDY1NjMw
2026-08-22 11:17:05 +0400,charge,#3433,visa,online,paid,2026-09-01,148156579998,2026-09-01,1153.50,31.33,1122.17,#43714796224670,card,1153.50,AED,AED,OmniaStores LLC,MTY5NDMzMDY1NjMw
`;

test("detects the Shopify Payments export (not Stripe) and totals the payout", () => {
  const [p, ...rest] = parsePayoutFile(Buffer.from(CSV), "payment_transactions_export_1.csv");
  assert.equal(rest.length, 0);
  assert.equal(p.provider, "Shopify Payments");
  assert.equal(p.id, "SHOPIFY-UNKNOWN-148156579998");
  assert.equal(p.net, 2975.92); // 930.53+841.45+834.36+846.11+1122.17-1598.70
  assert.equal(p.fees, 188.75);
  assert.deepEqual(p.orderRefs, ["3426", "3439", "3438", "3437", "3435", "3433"]);
  assert.equal(p.originalCurrency, undefined); // settled in AED
});

test("each order carries its real fee and net; the refund is flagged", () => {
  const [p] = parsePayoutFile(Buffer.from(CSV), "x.csv");
  const t3439 = p.transactions!.find((t) => t.ref === "3439")!;
  assert.deepEqual([t3439.grossShare, t3439.feeShare, t3439.netShare, t3439.isRefund], [988.21, 57.68, 930.53, false]);
  assert.equal(p.transactions!.find((t) => t.ref === "3426")!.isRefund, true);
});

test("the store is keyed the same way as the API, so upload and API pull share one row", () => {
  const [p] = parsePayoutFile(Buffer.from(CSV), "x.csv");
  const keyed = withShopifyStore(p, "UAE");
  assert.equal(keyed.id, "SHOPIFY-UAE-148156579998");
  assert.equal(keyed.statementNo, "SHOPIFY-UAE-148156579998");
  assert.equal(keyed.store, "Shopify UAE");
});

test("store is picked by the orders' own store, with SAR as the only fallback", () => {
  assert.equal(pickShopifyStore(["UAE", "UAE", "MAIN"], "AED"), "UAE");
  assert.equal(pickShopifyStore(["MAIN"], "AED"), "MAIN");
  assert.equal(pickShopifyStore([], "SAR"), "KSA");
  assert.equal(pickShopifyStore([], "AED"), null); // never guessed
  assert.equal(pickShopifyStore(["UAE", "MAIN"], "AED"), null); // a tie is not a decision
});
