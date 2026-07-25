export type TransactionKind =
  | "gateway_transfer" | "deposit" | "expense"
  | "owner_contribution" | "owner_drawing"
  | "interest_income" | "refund" | "unknown";

export type BankTransactionInput = {
  id: string;
  date?: string | null;
  narration: string;
  reference?: string | null;
  amount: number;
  type?: string | null;
};

export interface TransactionIntent {
  kind: TransactionKind;
  confidence: number;
  entity?: string;
  reasons: string[];
  metadata: Record<string, unknown>;
}

export function classifyTransaction(bankLine: BankTransactionInput): TransactionIntent {
  const text = normalise(`${bankLine.narration} ${bankLine.reference ?? ""}`);

  const gateway = detectGateway(text);
  if (gateway) {
    return {
      kind: "gateway_transfer",
      confidence: 0.95,
      entity: gateway.name,
      reasons: ["matched payout provider", `settlement pattern: ${gateway.key}`],
      metadata: { provider: gateway.key },
    };
  }

  if (containsAny(text, ["refund", "reversal", "chargeback"])) {
    return { kind: "refund", confidence: 0.90, reasons: ["refund keyword detected"], metadata: {} };
  }

  if (containsAny(text, ["owner contribution", "capital injection", "director loan", "shareholder"])) {
    return { kind: "owner_contribution", confidence: 0.85, reasons: ["owner funding pattern detected"], metadata: {} };
  }

  if (containsAny(text, ["owner withdrawal", "drawings", "personal"])) {
    return { kind: "owner_drawing", confidence: 0.85, reasons: ["owner withdrawal pattern detected"], metadata: {} };
  }

  if (containsAny(text, ["interest", "profit rate", "bank return"])) {
    return { kind: "interest_income", confidence: 0.90, reasons: ["interest income detected"], metadata: {} };
  }

  if (bankLine.amount < 0 || containsAny(text, ["invoice", "supplier", "purchase", "payment", "bill"])) {
    return { kind: "expense", confidence: 0.70, reasons: ["outgoing payment pattern detected"], metadata: {} };
  }

  if (bankLine.amount > 0) {
    return { kind: "deposit", confidence: 0.60, reasons: ["incoming bank transaction"], metadata: {} };
  }

  return { kind: "unknown", confidence: 0, reasons: ["no business pattern matched"], metadata: {} };
}

function normalise(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

function containsAny(text: string, values: string[]) {
  return values.some((v) => text.includes(v.toUpperCase()));
}

// Bank prints the settlement currency directly before the AED conversion,
// e.g. "...2026071403577784/SAR/AED 0.958357/DSZ..." or ".../KWD/AED 11.72.../DSZ..."
// No marker at all = settled natively in AED.
const CURRENCY_MARKER_RE = /(?:^|[\s/])(SAR|KWD)\/AED\b/;

type GatewayRule = {
  key: string;   // must exactly match the slug used in Zoho account config (clearingByGateway)
  name: string;
  words: string[];
  currencyVariants?: Partial<Record<"SAR" | "KWD", { key: string; name: string }>>;
};

const GATEWAY_RULES: GatewayRule[] = [
  {
    key: "tamara_AED", name: "TAMARA",
    words: ["TAMARA FINANCE COMPANY", "TAMARA FZE", "TAMARA"],
    currencyVariants: {
      SAR: { key: "tamara_ksa", name: "TAMARA KSA" },
      KWD: { key: "tamara_kwd", name: "TAMARA KWD" },
    },
  },
  {
    key: "tabby_aed", name: "TABBY AED",
    words: ["TABBY FINANCING COMPANY", "TABBY L.L.C", "TABBY LLC FZ", "TABBY"],
    currencyVariants: {
      SAR: { key: "tabby_ksa", name: "TABBY KSA" },
      KWD: { key: "tabby_kwd", name: "TABBY KWD" },
    },
  },
  { key: "telr_1", name: "TELR", words: ["INNOVATE TECHNOLOGIES"] },
  { key: "stripe_gateway", name: "STRIPE", words: ["STRIPE", "NETWORK INTERNATIONAL"] },
  { key: "checkout_aed", name: "CHECKOUT.COM", words: ["CHECKOUT MENA", "CHECKOUT.COM", "CHECKOUT"] },
  { key: "ontrack", name: "ON TRACK", words: ["ONTRACK", "ON TRACK"] },
  { key: "payfort", name: "PAYFORT", words: ["PAYFORT", "AMAZON PAYMENT SERVICES"] },
  { key: "shopify", name: "SHOPIFY PAYMENTS", words: ["SHOPIFY"] }, // must stay last — "SHOPIFY" appears inside Stripe/Shopify Payments narrations too
];

function detectGateway(text: string): { key: string; name: string } | null {
  const currency = CURRENCY_MARKER_RE.exec(text)?.[1] as "SAR" | "KWD" | undefined;
  for (const rule of GATEWAY_RULES) {
    if (!rule.words.some((w) => text.includes(w))) continue;
    const variant = currency ? rule.currencyVariants?.[currency] : undefined;
    return variant ?? { key: rule.key, name: rule.name };
  }
  return null;
}