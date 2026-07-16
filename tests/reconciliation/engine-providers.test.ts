import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";
import { parseCodCsv, parseCheckoutCsv } from "@/lib/parsers/payouts";

test("COD: a parsed remittance file resolves its bank credit to SETTLED with zero variance", () => {
  const [codPayout] = parseCodCsv(
    ["Invoice No,Order Number,COD Amount", "16964,5001,2462.00"].join("\n"),
    "on-track-delivery.csv",
  );
  assert.equal(codPayout.originalCurrency, undefined, "COD must never carry a guessed FX currency");

  const lines = computeReconLines({
    credits: [{
      id: "C-COD-1", statement_date: "2026-07-11",
      description: "KWD Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES//REF/invoice 16964",
      reference: "INV16964", amount: 2462.00, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: codPayout.id, gateway: codPayout.provider, net_amount: codPayout.net,
      gross_amount: codPayout.gross ?? codPayout.net, fee_amount: codPayout.fees ?? 0,
      source: codPayout.source, status: "uploaded", order_refs: codPayout.orderRefs,
      original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5001" }],
    confirmations: new Map(),
  });

  assert.equal(lines[0].state, "SETTLED");
  assert.equal(lines[0].variance, 0);
  assert.deepEqual(lines[0].resolvedOrders, ["5001"]);
});

test("Checkout: a parsed settlement resolves its bank credit to SETTLED with zero variance", () => {
  const header = "Currency Account ID,Action Type,Payment ID,Processed On,Holding Currency,Holding Currency Amount,Reference";
  const csv = [
    header,
    "ca_1,Authorization,pay_a,2026-07-10 10:00:00,AED,499.35,#5300",
    "ca_1,Network Token Update,nt_a,2026-07-10 10:00:00,AED,-0.37,",
  ].join("\n");
  const [checkoutPayout] = parseCheckoutCsv(csv, "checkout.csv");
  assert.equal(checkoutPayout.originalCurrency, undefined, "Checkout must never carry a guessed FX currency");

  const lines = computeReconLines({
    credits: [{
      id: "C-CKO-1", statement_date: "2026-07-10",
      description: "NETWORK INTERNATIONAL LLC STRIPEXXXXXXXX", // irrelevant text, provider comes from gateway_guess
      reference: "REF001", amount: +(499.35 - 0.37).toFixed(2), gateway_guess: "Checkout", confidence: "keyword",
    }],
    payouts: [{
      id: checkoutPayout.id, gateway: checkoutPayout.provider, net_amount: checkoutPayout.net,
      gross_amount: checkoutPayout.gross ?? checkoutPayout.net, fee_amount: checkoutPayout.fees ?? 0,
      source: checkoutPayout.source, status: "uploaded", order_refs: checkoutPayout.orderRefs,
      original_currency: null, net_original: null,
      transactions: checkoutPayout.transactions!.map((t) => ({
        order_ref: t.ref, is_refund: t.isRefund, quality: t.quality, net_aed: t.netShare,
      })),
    }],
    orders: [{ order_number: "5300" }],
    confirmations: new Map(),
  });

  assert.equal(lines[0].state, "SETTLED");
  assert.equal(lines[0].variance, 0);
  assert.deepEqual(lines[0].resolvedOrders, ["5300"]);
});

test("PAYOUT_VARIANCE still fires for a new provider when the parsed net doesn't match the bank credit", () => {
  const [codPayout] = parseCodCsv(
    ["Invoice No,Order Number,COD Amount", "17000,5002,940.00"].join("\n"),
    "on-track-delivery.csv",
  );

  const lines = computeReconLines({
    credits: [{
      id: "C-COD-2", statement_date: "2026-07-12", description: "invoice 17000",
      reference: "INV17000", amount: 950.00, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: codPayout.id, gateway: codPayout.provider, net_amount: codPayout.net,
      gross_amount: codPayout.net, fee_amount: 0, source: codPayout.source, status: "uploaded",
      order_refs: codPayout.orderRefs, original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5002" }],
    confirmations: new Map(),
  });

  // Candidate filter: |expectedNetFor(p,credit).net - credit.amount| <= max(TOLERANCE_AED=1, credit.amount*0.02).
  // credit.amount=950 -> max(1, 19) = 19. Parsed net = 940.00, diff = |940-950| = 10 <= 19, so this payout
  // IS considered a candidate (unlike the brief's original 1000/950 pair, whose diff of 50 exceeds 19 and
  // would leave the line AWAITING_PAYOUT instead of exercising PAYOUT_VARIANCE).
  // variance = credit.amount (950) - expected.net (940) = 10, and 10 > TOLERANCE_AED (1.0) -> PAYOUT_VARIANCE.
  assert.equal(lines[0].state, "PAYOUT_VARIANCE");
  assert.equal(lines[0].variance, 10); // hand-computed: 950 (bank) - 940 (payout net)
});
