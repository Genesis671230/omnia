// Canonical gateway names + classification from raw store gateway strings
// and from bank statement narrations. One vocabulary for the whole system.

export type Gateway =
  | "Stripe"
  | "Telr"
  | "Checkout"
  | "Tabby"
  | "Tamara"
  | "Shopify Payments"
  | "COD"
  | "SHOPIFY"
  | "Unclassified";

export const GATEWAYS: Gateway[] = [
  "Stripe", "Telr", "Checkout", "Tabby", "Tamara", "Shopify Payments","SHOPIFY", "COD",
];

// Store-side: "Pay By Stripe", "Checkout.com - Onsite Payments", "Tamara Split
// Payments", "shopify_payments", "Cash on Delivery (COD)", woo "telr"...
export function classifyOrderGateway(raw: string): Gateway {
  const t = (raw || "").toUpperCase();
  if (t.includes("STRIPE")) return "Stripe";
  if (t.includes("TELR")) return "Telr";
  if (t.includes("CHECKOUT")) return "Checkout";
  if (t.includes("TABBY")) return "Tabby";
  // The WhatsApp store's method is spelled "Pay By Tammara" — without this it
  // read as Unclassified and its orders never matched a Tamara payout.
  if (t.includes("TAMARA") || t.includes("TAMMARA")) return "Tamara";
  if (t.includes("SHOPIFY")) return "Shopify Payments";
  if (t.includes("COD") || t.includes("CASH ON DELIVERY")) return "COD";
  return "Unclassified";
}

// Bank-side: keyword rules over the statement narration. Confidence is honest:
// SABB is a settlement BANK on Tabby's rail, not proof of the gateway.
export type Confidence = "keyword" | "inferred" | "unknown";

// Rules are evaluated IN ORDER, most specific first. Order is load-bearing:
//
//  * Shopify Payments and Stripe both settle through NETWORK INTERNATIONAL LLC
//    in the UAE, so the acquirer's name proves nothing. The rail is named by a
//    "SHOPIFY-…" / "STRIPE-…" reference token later in the narration, which is
//    why those are matched before "NETWORK". They used to sit after it, and all
//    34 Shopify credits were therefore booked as Stripe.
//  * The hyphen in those tokens is required, not decorative: Tabby's SAR
//    narrations carry the store name "OMNIASTORES SHOPIFY KSA", which is a
//    Tabby payout to a store that happens to be called Shopify KSA.
//  * The gateway ENTITY names (TABBY LLC, TAMARA FZE, …) are unambiguous, so
//    they run ahead of the acquirer rules.
export const BANK_DESCRIPTOR_RULES: {
  keyword?: string;
  pattern?: RegExp;
  provider: Gateway;
  confidence: Confidence;
}[] = [
  { keyword: "TAMARA", provider: "Tamara", confidence: "keyword" },
  { keyword: "TABBY", provider: "Tabby", confidence: "keyword" },
  { keyword: "TABI COMPANY", provider: "Tabby", confidence: "keyword" },
  // Settlement reference tokens — the only thing that separates the two rails
  // sharing Network International as acquirer.
  { pattern: /\bSHOPIFY-/, provider: "Shopify Payments", confidence: "keyword" },
  { pattern: /\bSTRIPE-/, provider: "Stripe", confidence: "keyword" },
  { keyword: "CHECKOUT MENA", provider: "Checkout", confidence: "keyword" },
  { keyword: "CHECKOUT.COM", provider: "Checkout", confidence: "keyword" },
  { keyword: "INNOVATE TECHNOLOGIES", provider: "Telr", confidence: "keyword" },
  { keyword: "INNOVATE", provider: "Telr", confidence: "keyword" },
  // Acquirer with no rail token: honestly an inference, since both Stripe and
  // Shopify Payments arrive this way. Stripe remains the more common of the two.
  { keyword: "NETWORK", provider: "Stripe", confidence: "inferred" },
  { keyword: "SHOPIFY", provider: "Shopify Payments", confidence: "keyword" },
  { keyword: "ON TRACK DELIVERY", provider: "COD", confidence: "keyword" },
  { keyword: "SABB", provider: "Tabby", confidence: "inferred" },
];

export function classifyBankCredit(narration: string): { provider: Gateway; confidence: Confidence } {
  const text = (narration || "").toUpperCase();
  for (const r of BANK_DESCRIPTOR_RULES) {
    const hit = r.pattern ? r.pattern.test(text) : r.keyword ? text.includes(r.keyword) : false;
    if (hit) return { provider: r.provider, confidence: r.confidence };
  }
  return { provider: "Unclassified", confidence: "unknown" };
}
