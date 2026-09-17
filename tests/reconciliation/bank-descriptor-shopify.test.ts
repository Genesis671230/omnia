import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBankCredit } from "@/lib/gateways";

// Shopify Payments and Stripe both settle through NETWORK INTERNATIONAL LLC in
// the UAE, so the acquirer name says nothing about which rail a credit is. The
// only discriminator is the SHOPIFY- / STRIPE- token further along. The
// "NETWORK" rule used to fire first and claimed all 34 Shopify credits for
// Stripe.
//
// The hyphen matters: Tabby's SAR narrations carry the store name
// "OMNIASTORES SHOPIFY KSA", which must NOT read as a Shopify payout.

const SHOPIFY_CREDIT =
  "FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2609090006977 ntsub.VE5JfK8/cyw7Oyc SHOPIFY-0ALMOHZJBTQW4JGCYPU/ FT26252Q19HG FT26252Q19HG";

const SHOPIFY_CREDIT_SPACED =
  "FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2609080002294 ntsub.VDi63nB/5mKiAdf SHOPIFY- NW2RJWW0W91RRQKDRI8/ FT262514NNQZ FT262514NNQZ";

const STRIPE_CREDIT =
  "FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2609100008380 ntsub.VESYaRS/oj7oJB3 STRIPE-64FQBMUX0MLNEJOYDHYJ/ FT26253RMWQ3 FT26253RMWQ3";

const STRIPE_CREDIT_SPACED =
  "FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2609090003741 ntsub.VE5JfK8/cyw7Oyc STRIPE- V0KC3FYZYXR7BE3EUT8F/FT26252892Q7 FT26252892Q7";

const TABBY_SAR_SHOPIFY_STORE =
  "Inward Telex Payment/Sender Info:SA SABB 003-777729-001, TABBY FINANCING COMPANY JSC/TT CPMP004T2BBT/Rmt Info:BUSINESS RELATED PAYMENT OMNIASTORES SHOPIFY KSA";

test("a SHOPIFY- token wins over the NETWORK INTERNATIONAL acquirer name", () => {
  assert.equal(classifyBankCredit(SHOPIFY_CREDIT).provider, "Shopify Payments");
  assert.equal(classifyBankCredit(SHOPIFY_CREDIT).confidence, "keyword");
});

test("a SHOPIFY- token followed by a space is still Shopify", () => {
  assert.equal(classifyBankCredit(SHOPIFY_CREDIT_SPACED).provider, "Shopify Payments");
});

test("a STRIPE- token is Stripe", () => {
  assert.equal(classifyBankCredit(STRIPE_CREDIT).provider, "Stripe");
  assert.equal(classifyBankCredit(STRIPE_CREDIT_SPACED).provider, "Stripe");
});

test("Tabby's KSA store name 'OMNIASTORES SHOPIFY KSA' stays Tabby", () => {
  // The store is called Shopify KSA; the payout is still Tabby's. Requiring the
  // hyphen is what keeps this from flipping to Shopify Payments.
  assert.equal(classifyBankCredit(TABBY_SAR_SHOPIFY_STORE).provider, "Tabby");
});

test("a bare NETWORK INTERNATIONAL credit with no token is not claimed as certain", () => {
  const bare =
    "FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2607160004477 ntsub.";
  const c = classifyBankCredit(bare);
  assert.equal(c.provider, "Stripe");
  assert.equal(
    c.confidence,
    "inferred",
    "both rails use Network International, so the acquirer alone is an inference, not proof",
  );
});

test("the other gateways are unaffected", () => {
  assert.equal(classifyBankCredit("Inward Telex Payment/TAMARA FZE/ AE05").provider, "Tamara");
  assert.equal(classifyBankCredit("Inward Telex Payment/TABBY LLC/ AE20").provider, "Tabby");
  assert.equal(classifyBankCredit("CHECKOUT MENA FZ LLC").provider, "Checkout");
  assert.equal(classifyBankCredit("INNOVATE TECHNOLOGIES").provider, "Telr");
  assert.equal(classifyBankCredit("ON TRACK DELIVERY").provider, "COD");
  assert.equal(classifyBankCredit("something else entirely").provider, "Unclassified");
});
