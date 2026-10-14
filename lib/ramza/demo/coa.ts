/* Chart of accounts per industry + a keyword categoriser for bank / expense
 * lines (UAE narrations: DEWA, SALIK, ENOC, WPS, Ejari…). A visitor's own
 * chart of accounts can replace ours: lines are then mapped to their account
 * whose name best matches our category. Pure. */

export const INDUSTRIES = ["ecommerce", "logistics", "realestate", "wholesale", "retail", "construction"] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_LABEL: Record<Industry, string> = {
  ecommerce: "E-commerce",
  logistics: "Logistics",
  realestate: "Real estate",
  wholesale: "Wholesale",
  retail: "Retail",
  construction: "Construction",
};

export type AccountType = "Asset" | "Liability" | "Equity" | "Income" | "Cost of sales" | "Expense";
export type Account = { code: string; name: string; type: AccountType };

const BASE: Account[] = [
  { code: "1000", name: "Bank — current account", type: "Asset" },
  { code: "1010", name: "Petty cash", type: "Asset" },
  { code: "1100", name: "Accounts receivable", type: "Asset" },
  { code: "1150", name: "Gateway clearing", type: "Asset" },
  { code: "1200", name: "Inventory", type: "Asset" },
  { code: "1300", name: "VAT input (recoverable)", type: "Asset" },
  { code: "1400", name: "Prepaid expenses", type: "Asset" },
  { code: "1500", name: "Fixed assets", type: "Asset" },
  { code: "2000", name: "Accounts payable", type: "Liability" },
  { code: "2100", name: "VAT output (payable)", type: "Liability" },
  { code: "2200", name: "Salaries payable", type: "Liability" },
  { code: "2300", name: "End-of-service gratuity provision", type: "Liability" },
  { code: "2400", name: "Corporate Tax payable", type: "Liability" },
  { code: "3000", name: "Owner's capital", type: "Equity" },
  { code: "3100", name: "Retained earnings", type: "Equity" },
  { code: "4000", name: "Sales", type: "Income" },
  { code: "4900", name: "Exchange gain", type: "Income" },
  { code: "5000", name: "Cost of goods sold", type: "Cost of sales" },
  { code: "6000", name: "Salaries & wages", type: "Expense" },
  { code: "6050", name: "Visa & labour fees", type: "Expense" },
  { code: "6100", name: "Rent", type: "Expense" },
  { code: "6150", name: "Utilities (DEWA / ADDC)", type: "Expense" },
  { code: "6200", name: "Telecom & internet", type: "Expense" },
  { code: "6250", name: "Software & subscriptions", type: "Expense" },
  { code: "6300", name: "Advertising & marketing", type: "Expense" },
  { code: "6350", name: "Payment processing fees", type: "Expense" },
  { code: "6400", name: "Bank charges", type: "Expense" },
  { code: "6450", name: "Fuel & tolls (Salik)", type: "Expense" },
  { code: "6500", name: "Delivery & courier", type: "Expense" },
  { code: "6550", name: "Professional fees", type: "Expense" },
  { code: "6600", name: "Government fees & licences", type: "Expense" },
  { code: "6650", name: "Meals & entertainment", type: "Expense" },
  { code: "6700", name: "Office supplies", type: "Expense" },
  { code: "6800", name: "Exchange loss", type: "Expense" },
  { code: "6900", name: "Uncategorised", type: "Expense" },
];

const EXTRA: Record<Industry, Account[]> = {
  ecommerce: [
    { code: "4010", name: "Online sales — website", type: "Income" },
    { code: "4020", name: "Online sales — marketplaces", type: "Income" },
    { code: "4090", name: "Sales returns & refunds", type: "Income" },
    { code: "1160", name: "COD receivable (courier)", type: "Asset" },
    { code: "5100", name: "Packaging materials", type: "Cost of sales" },
  ],
  logistics: [
    { code: "4010", name: "Freight & delivery income", type: "Income" },
    { code: "4020", name: "Warehousing income", type: "Income" },
    { code: "1160", name: "COD collected — to remit", type: "Asset" },
    { code: "2050", name: "COD payable to merchants", type: "Liability" },
    { code: "5100", name: "Vehicle running costs", type: "Cost of sales" },
    { code: "5200", name: "Subcontracted drivers", type: "Cost of sales" },
  ],
  realestate: [
    { code: "4010", name: "Rental income", type: "Income" },
    { code: "4020", name: "Service charge income", type: "Income" },
    { code: "4030", name: "Commission income", type: "Income" },
    { code: "2050", name: "Tenant security deposits", type: "Liability" },
    { code: "1170", name: "Post-dated cheques held", type: "Asset" },
    { code: "5100", name: "Property maintenance", type: "Cost of sales" },
  ],
  wholesale: [
    { code: "4010", name: "Wholesale sales", type: "Income" },
    { code: "4090", name: "Trade discounts", type: "Income" },
    { code: "5100", name: "Freight in & customs duty", type: "Cost of sales" },
    { code: "1180", name: "Goods in transit", type: "Asset" },
  ],
  retail: [
    { code: "4010", name: "Store sales — card", type: "Income" },
    { code: "4020", name: "Store sales — cash", type: "Income" },
    { code: "1155", name: "Card settlements receivable (POS)", type: "Asset" },
    { code: "5100", name: "Shrinkage & stock loss", type: "Cost of sales" },
  ],
  construction: [
    { code: "4010", name: "Contract revenue (progress billing)", type: "Income" },
    { code: "1190", name: "Retention receivable", type: "Asset" },
    { code: "2060", name: "Retention payable (subcontractors)", type: "Liability" },
    { code: "5100", name: "Materials", type: "Cost of sales" },
    { code: "5200", name: "Subcontractor costs", type: "Cost of sales" },
    { code: "5300", name: "Equipment hire", type: "Cost of sales" },
  ],
};

export function chartFor(industry: Industry): Account[] {
  return [...BASE, ...EXTRA[industry]].sort((a, b) => a.code.localeCompare(b.code));
}

/** Keyword → our account name. Order matters: specific first. */
const RULES: { re: RegExp; account: string; vat?: boolean }[] = [
  { re: /\b(TABBY|TAMARA|STRIPE|SHOPIFY|TELR|CHECKOUT\.?COM|NETWORK INT|NI SETTLEMENT|PAYTABS|POSTPAY)\b/i, account: "Gateway clearing" },
  { re: /\b(WPS|SALARY|SALARIES|PAYROLL|SIF)\b/i, account: "Salaries & wages" },
  { re: /\b(GDRFA|ICP|MOHRE|TASHEEL|AMER|VISA FEE|EMIRATES ID|LABOUR)\b/i, account: "Visa & labour fees", vat: false },
  { re: /\b(EJARI|RENT|LEASE|TENANCY)\b/i, account: "Rent" },
  { re: /\b(DEWA|ADDC|SEWA|FEWA|EMPOWER|TABREED|LOOTAH GAS)\b/i, account: "Utilities (DEWA / ADDC)", vat: true },
  { re: /\b(ETISALAT|E&|DU |EITC|DU\b|STARLINK)\b/i, account: "Telecom & internet", vat: true },
  { re: /\b(META|FACEBK|FACEBOOK|GOOGLE ADS|GOOGLE\*ADS|TIKTOK|SNAP|INSTAGRAM)\b/i, account: "Advertising & marketing", vat: true },
  { re: /\b(AWS|AMAZON WEB|ZOHO|GOOGLE\s?\*?WORKSPACE|GSUITE|MICROSOFT|SHOPIFY\*|CANVA|SLACK|NOTION|ADOBE|OPENAI|ANTHROPIC)\b/i, account: "Software & subscriptions", vat: true },
  { re: /\b(ENOC|ADNOC|EPPCO|EMARAT|SALIK|DARB|PARKIN|RTA)\b/i, account: "Fuel & tolls (Salik)", vat: true },
  { re: /\b(ARAMEX|SMSA|DHL|FEDEX|UPS|JEEBLY|QUIQUP|ONTRACK|EMIRATES POST|SHIPA|IMILE)\b/i, account: "Delivery & courier", vat: true },
  { re: /\b(DED|DET|ECONOMY|TRADE LICEN[CS]E|FREEZONE|DMCC|IFZA|RAKEZ|MUNICIPALITY|FTA PAYMENT|EMARATAX)\b/i, account: "Government fees & licences", vat: false },
  { re: /\b(AUDIT|LEGAL|ADVOCATE|CONSULT|ACCOUNTING)\b/i, account: "Professional fees", vat: true },
  { re: /\b(TALABAT|DELIVEROO|CAREEM FOOD|RESTAURANT|CAFE|STARBUCKS|COSTA)\b/i, account: "Meals & entertainment", vat: true },
  { re: /\b(CAREEM|UBER|TAXI)\b/i, account: "Fuel & tolls (Salik)", vat: true },
  { re: /\b(CHARGES?|COMMISSION|FEE|SWIFT|MAINTENANCE FEE|VAT ON CHARGES)\b/i, account: "Bank charges", vat: true },
  { re: /\b(ACE HARDWARE|DANUBE|STATIONERY|OFFICE)\b/i, account: "Office supplies", vat: true },
  { re: /\b(CEMENT|STEEL|READYMIX|BUILDING MATERIAL)\b/i, account: "Materials", vat: true },
  { re: /\b(SUBCONTRACT|SUB-CONTRACT)\b/i, account: "Subcontractor costs", vat: true },
  { re: /\b(CRANE|EQUIPMENT HIRE|SCAFFOLD)\b/i, account: "Equipment hire", vat: true },
  { re: /\b(CUSTOMS|DUBAI TRADE|FREIGHT)\b/i, account: "Freight in & customs duty", vat: true },
  { re: /\b(PACKAGING|BOXES|CARTON)\b/i, account: "Packaging materials", vat: true },
  { re: /\b(MAINTENANCE|PLUMB|ELECTRICIAN|AC SERVICE)\b/i, account: "Property maintenance", vat: true },
];

export type Categorised = { account: Account; confidence: "rule" | "fallback"; vatRecoverable: boolean };

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));

/** Best account in `chart` for a category name (exact, else most shared words). */
export function mapToChart(category: string, chart: Account[]): Account | null {
  const exact = chart.find((a) => a.name.toLowerCase() === category.toLowerCase());
  if (exact) return exact;
  const want = words(category);
  let best: { a: Account; score: number } | null = null;
  for (const a of chart) {
    const score = [...words(a.name)].filter((w) => want.has(w) || [...want].some((x) => x.startsWith(w) || w.startsWith(x))).length;
    if (score > 0 && (!best || score > best.score)) best = { a, score };
  }
  return best?.a ?? null;
}

export function categorise(description: string, amount: number, chart: Account[]): Categorised {
  const uncategorised = mapToChart("Uncategorised", chart) ?? chart[chart.length - 1];
  for (const r of RULES) {
    if (!r.re.test(description)) continue;
    const a = mapToChart(r.account, chart);
    if (a) return { account: a, confidence: "rule", vatRecoverable: r.vat ?? false };
  }
  // Money in with no rule: a customer receipt.
  if (amount > 0) return { account: mapToChart("Accounts receivable", chart) ?? uncategorised, confidence: "fallback", vatRecoverable: false };
  return { account: uncategorised, confidence: "fallback", vatRecoverable: false };
}
