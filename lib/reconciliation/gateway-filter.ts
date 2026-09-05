// Gateway filter options for the reconciliation surface, derived from the
// SAME live Zoho clearing-account list lib/finance/gateway-account-map.ts
// posts settlements against — so the filter never drifts from the accounts
// a founder can actually post to. Keyword-matched (not hardcoded literal
// labels) for the same reason gateway-account-map.ts is: it adapts
// automatically if Zoho renames or adds an account.

const CLEARING_ACCOUNT_TYPE = "payment_clearing";
const NON_UAE_REGION_TOKENS = ["ksa", "kwd", "qar", "qtr", "omr", "bhd", "sar"];
const REGION_LABEL: Record<string, string> = {
  ksa: "KSA", kwd: "KWD", qar: "QAR", qtr: "QAR", omr: "OMR", bhd: "BHD", sar: "KSA",
};

// Currency → region, the inverse of the mapping gateway-account-map.ts uses
// to pick a region-specific clearing account. SAR is the KSA store's
// settlement currency (verified against FX reconciliation work), so it maps
// to the "KSA" filter bucket like the KSA-tagged Zoho accounts do.
const CURRENCY_REGION: Record<string, string> = {
  SAR: "KSA", KWD: "KWD", QAR: "QAR", OMR: "OMR", BHD: "BHD",
};

const GATEWAY_KEYWORDS: { keyword: string; gateway: string }[] = [
  { keyword: "tabby", gateway: "Tabby" },
  { keyword: "tamara", gateway: "Tamara" },
  { keyword: "telr", gateway: "Telr" },
  { keyword: "stripe", gateway: "Stripe" },
  { keyword: "shopify", gateway: "Shopify Payments" },
  { keyword: "checkout", gateway: "Checkout" },
];

// The founder's requested display order — known gateway+region pairs sort
// first, in this order; anything else (a future Zoho account this list
// doesn't anticipate) sorts after, never dropped silently.
const PRIORITY: [string, string | null][] = [
  ["Tabby", null], ["Tabby", "KSA"], ["Tabby", "KWD"],
  ["Tamara", "KSA"], ["Tamara", null],
  ["Telr", null], ["Stripe", null], ["Shopify Payments", null],
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim();
}

export type GatewayFilterOption = {
  key: string;
  label: string;
  gateway: string;
  region: string | null;
};

export function gatewayFilterOptionsFromZohoAccounts(
  accounts: { account_name: string; account_type?: string }[],
): GatewayFilterOption[] {
  const pool = accounts.filter((a) => !a.account_type || a.account_type === CLEARING_ACCOUNT_TYPE);
  const seen = new Set<string>();
  const options: GatewayFilterOption[] = [];

  for (const a of pool) {
    const n = normalize(a.account_name);
    const hit = GATEWAY_KEYWORDS.find((g) => n.includes(g.keyword));
    if (!hit) continue;
    const regionToken = NON_UAE_REGION_TOKENS.find((t) => n.includes(t));
    const region = regionToken ? REGION_LABEL[regionToken] : null;
    const key = `${hit.gateway.toLowerCase()}-${region ? region.toLowerCase() : "aed"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ key, label: a.account_name, gateway: hit.gateway, region });
  }

  const rank = (o: GatewayFilterOption) => {
    const i = PRIORITY.findIndex(([g, r]) => g === o.gateway && r === o.region);
    return i === -1 ? PRIORITY.length : i;
  };
  return options.sort((x, y) => rank(x) - rank(y));
}

export function regionForLine(line: { payout: { currency: string | null } | null }): string | null {
  const ccy = line.payout?.currency;
  if (!ccy) return null;
  return CURRENCY_REGION[ccy.toUpperCase()] ?? null;
}
