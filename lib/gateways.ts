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
  if (t.includes("TAMARA")) return "Tamara";
  if (t.includes("SHOPIFY")) return "Shopify Payments";
  if (t.includes("COD") || t.includes("CASH ON DELIVERY")) return "COD";
  return "Unclassified";
}

// Bank-side: keyword rules over the statement narration. Confidence is honest:
// SABB is a settlement BANK on Tabby's rail, not proof of the gateway.
export type Confidence = "keyword" | "inferred" | "unknown";

export const BANK_DESCRIPTOR_RULES: { keyword: string; provider: Gateway; confidence: Confidence }[] = [
  { keyword: "TAMARA", provider: "Tamara", confidence: "keyword" },
  { keyword: "CHECKOUT MENA", provider: "Checkout", confidence: "keyword" },
  { keyword: "CHECKOUT.COM", provider: "Checkout", confidence: "keyword" },
  { keyword: "INNOVATE TECHNOLOGIES", provider: "Telr", confidence: "keyword" },
  { keyword: "INNOVATE", provider: "Telr", confidence: "keyword" },
  { keyword: "NETWORK", provider: "Stripe", confidence: "keyword" },
  { keyword: "TABBY", provider: "Tabby", confidence: "keyword" },
  { keyword: "SHOPIFY", provider: "Shopify Payments", confidence: "keyword" },
  { keyword: "ON TRACK DELIVERY", provider: "COD", confidence: "keyword" },
  { keyword: "SABB", provider: "Tabby", confidence: "inferred" },
];

export function classifyBankCredit(narration: string): { provider: Gateway; confidence: Confidence } {
  const text = (narration || "").toUpperCase();
  for (const r of BANK_DESCRIPTOR_RULES) {
    if (text.includes(r.keyword)) return { provider: r.provider, confidence: r.confidence };
  }
  return { provider: "Unclassified", confidence: "unknown" };
}
