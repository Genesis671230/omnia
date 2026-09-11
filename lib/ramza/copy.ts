/* All RAMZA landing copy in one place. Keep claims inside the guardrails:
   only Shopify, WooCommerce, Stripe, Telr, Tabby, Tamara, Checkout.com, COD
   couriers, Zoho Books, AED/SAR. No metrics, no client names, no logos. */

export type H1Variant = "default" | "money" | "books";

export const H1_VARIANTS: Record<H1Variant, string> = {
  default:
    "Every Tabby, Tamara and Telr payout, matched to your bank and closed in Zoho Books.",
  money: "Find the money your payment gateways didn't send.",
  books: "Your gateways pay out. RAMZA closes the books.",
};

export function resolveH1(param: string | string[] | undefined): string {
  const key = Array.isArray(param) ? param[0] : param;
  if (key && key in H1_VARIANTS) return H1_VARIANTS[key as H1Variant];
  return H1_VARIANTS.default;
}

export const HERO_SUB =
  "RAMZA reads your store orders, payout files and bank statement, matches every dirham, and posts payments, gateway fees and VAT to Zoho. No more month-end spreadsheets.";

export const CTA_PRIMARY = "Get a free payout audit";
export const CTA_SECONDARY = "Chat on WhatsApp";

export const PAIN = [
  "Tabby and Tamara pay you net of fees, so the amount in the bank never matches the invoice.",
  "A refund or chargeback next month reopens a payout you already reconciled.",
  "Five gateways, two currencies, one bank account, and someone matching it by hand every month.",
];

export const CONTRAST_LINE = "Dashboards show you the gap. RAMZA closes it.";

/* Step 2 copy depends on whether email-forwarding to a private RAMZA address is
   live. Until the founder confirms, use the fallback. */
export const EMAIL_FORWARDING_LIVE = false;

export const HOW_IT_WORKS = [
  {
    title: "Connect your stores.",
    body: "Shopify and WooCommerce orders sync automatically.",
  },
  {
    title: "Send your payout files.",
    body: EMAIL_FORWARDING_LIVE
      ? "Upload them, or forward gateway payout emails to your private RAMZA address."
      : "Upload them, or we pull them for you.",
  },
  {
    title: "Match to the bank.",
    body: "Every payout is tied to a bank credit, including FX differences between AED and SAR.",
  },
  {
    title: "Close in Zoho.",
    body: "Payments are posted at invoice total, fees go to bank charges, VAT on fees is recorded. Invoices flip to Paid.",
  },
];

export const CHAIN = ["Order", "Gateway", "Payout", "Bank", "Books"];

export const ACCOUNTANT_COPY =
  "Payments are recorded the way your accountant would do it by hand: full invoice amount, fee split out, VAT captured. Nothing is left hanging as a residual.";

export const ACCOUNTANT_ROW = {
  invoiceTotal: "AED 1,250.00",
  received: "AED 1,209.63",
  gatewayFee: "AED 38.45",
  vatOnFee: "AED 1.92",
  status: "Paid",
};
// arithmetic: 1250.00 - 38.45 - 1.92 = 1209.63 ✓

export const INTEGRATIONS = {
  stores: [{ name: "Shopify" }, { name: "WooCommerce" }],
  payments: [
    { name: "Stripe" },
    { name: "Telr" },
    { name: "Tabby" },
    { name: "Tamara" },
    { name: "Checkout.com" },
    { name: "Cash on delivery" },
  ],
  books: [
    { name: "Zoho Books", status: "live" as const },
    { name: "Xero", status: "on-request" as const, tool: "xero" },
    { name: "QuickBooks", status: "on-request" as const, tool: "quickbooks" },
  ],
};

export const AUDIT_COPY =
  "Send us last month's payout files and bank statement. Within 48 hours you get a report of every unmatched payout, unbooked gateway fee, and invoice stuck on overdue. We sign an NDA before you send anything.";

export const MONTHLY_ORDER_BANDS = [
  { value: "<500", label: "Under 500" },
  { value: "500-2000", label: "500 to 2,000" },
  { value: "2000-10000", label: "2,000 to 10,000" },
  { value: "10000+", label: "10,000+" },
];

export const ACCOUNTING_TOOLS = [
  { value: "zoho", label: "Zoho Books" },
  { value: "xero", label: "Xero" },
  { value: "quickbooks", label: "QuickBooks" },
  { value: "excel-none", label: "Excel or none" },
];

export const GATEWAY_OPTIONS = [
  "Stripe",
  "Telr",
  "Tabby",
  "Tamara",
  "Checkout.com",
  "Cash on delivery",
];

export const FOUNDING_COPY =
  "We're onboarding a small number of Gulf stores this quarter. Founding partners get setup done for them and pricing locked for 12 months.";

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Do I need to change payment gateways?",
    a: "No. RAMZA works with the ones you already use: Stripe, Telr, Tabby, Tamara, Checkout.com and cash-on-delivery couriers.",
  },
  {
    q: "What about my bank statement data?",
    a: "Files are used only to reconcile your account. We sign an NDA before you share anything. [Founder to confirm retention wording before launch.]",
  },
  {
    q: "We use Xero or QuickBooks.",
    a: "Tell us in the form. Zoho Books is live today; we're prioritising Xero and QuickBooks based on demand.",
  },
  {
    q: "We sell in AED and SAR.",
    a: "Both are handled, including the FX difference between the payout currency and what lands in your bank.",
  },
  {
    q: "How long does setup take?",
    a: "[SETUP_TIME]",
  },
  {
    q: "Is this an app or a service?",
    a: "Both. The software does the matching and posting; we set it up and check the first month with you.",
  },
];

export const COPILOT_INTRO =
  "Ask why the money is short. The copilot traces a payout back through every order, fee and refund and tells you where the gap is.";

/* Canned copilot Q&A. Synthetic numbers, each thread foots. Not wired to a
   model — this is a demonstration of the outcome, not a live assistant. */
export const COPILOT_THREADS: {
  q: string;
  steps: string[];
  answer: string;
}[] = [
  {
    q: "Why is this Tamara payout SAR 300 short?",
    steps: [
      "Payout SAR 24,180.00 covers 51 orders, gross SAR 25,090.00.",
      "Tamara fee SAR 723.00 and VAT on fee SAR 36.15 account for SAR 759.15.",
      "Two orders (SA-4471, SA-4488) were refunded after the cutoff: SAR 150.85 held back.",
      "25,090.00 − 759.15 − 150.85 = 24,180.00.",
    ],
    answer:
      "Nothing is missing. The SAR 300 you expected is a fee-plus-VAT line of SAR 759.15 offset by SAR 150.85 of post-cutoff refunds. RAMZA books the fee to bank charges and carries the two refunds to next month's payout.",
  },
  {
    q: "Which invoices are still unpaid after this payout?",
    steps: [
      "42 of the 44 orders in this payout map to open Zoho invoices.",
      "40 invoices match to the payout at full total and flip to Paid.",
      "INV-2291 is short AED 12.00: a partial Tabby capture. Flagged for review, not auto-closed.",
      "INV-2307 has no matching order line: likely a manual invoice. Left open.",
    ],
    answer:
      "40 invoices close automatically. Two stay open on purpose: one partial capture and one invoice with no order behind it. Both are in the review queue with the reason attached.",
  },
  {
    q: "What is the VAT on this month's gateway fees?",
    steps: [
      "Stripe fees AED 1,204.50, Telr AED 388.20, Tabby AED 2,110.40, Tamara AED 640.75.",
      "Total gateway fees AED 4,343.85 across 6 payouts.",
      "VAT at 5% on the fee value: AED 217.19.",
    ],
    answer:
      "AED 217.19 of recoverable VAT on AED 4,343.85 of gateway fees. RAMZA posts each fee to bank charges and the VAT to the input-tax account so it shows up on your return.",
  },
];

/* "One orchestrator, four specialists" — RAMZA's internal division of labour.
   Rendered as an original animated node diagram, not a video. */
export const ORCHESTRATOR_INTRO =
  "RAMZA is not one model doing everything. An orchestrator reads your payout file, bank statement and orders, then hands each job to the specialist that owns it.";

export const ORCHESTRATOR = {
  hub: {
    name: "Orchestrator",
    body: "Reads the payout file, the bank statement and your orders. Splits the work and routes it.",
  },
  specialists: [
    {
      name: "Reconciler",
      body: "Ties every payout to a bank credit, including the FX difference between AED and SAR.",
      status: "1,281 / 1,284 bank lines matched",
    },
    {
      name: "Bill handler",
      body: "Posts each gateway fee to bank charges and records the VAT on the fee.",
      status: "AED 4,343.85 fees + 217.19 VAT booked",
    },
    {
      name: "Consolidator",
      body: "Closes invoices in Zoho at invoice total and rolls up the AED and SAR ledgers.",
      status: "42 invoices moved to Paid",
    },
    {
      name: "Reporter",
      body: "Writes the 48-hour payout audit and the monthly reports, with every exception listed.",
      status: "March audit drafted, 3 exceptions",
    },
  ],
};

/* "Every line gets an account and a date" — the copilot proposing a posting,
   then it resolving to a booked entry. Synthetic. */
export const POSTING_INTRO =
  "Every payout line is proposed with an account and a date before anything is booked. You see the suggestion, then watch it post.";

export const POSTING_ROWS: {
  description: string;
  account: string;
  date: string;
  amount: string;
  negative?: boolean;
}[] = [
  { description: "Tabby settlement", account: "Payments received", date: "04 Mar", amount: "AED 18,420.50" },
  { description: "Gateway fee, Tabby", account: "Bank charges", date: "04 Mar", amount: "AED 584.00" },
  { description: "VAT on gateway fee", account: "Input VAT", date: "04 Mar", amount: "AED 29.20" },
  { description: "FX on SAR settlement", account: "Realised FX loss", date: "06 Mar", amount: "AED 42.00" },
  { description: "COD courier remittance", account: "Payments received", date: "09 Mar", amount: "AED 29,882.00" },
  { description: "Refund, order SA-4471", account: "Refunds payable", date: "11 Mar", amount: "AED 150.85", negative: true },
];

export const VIDEO_INTRO_HEADING = "See a month close in under a minute";
export const VIDEO_INTRO_BODY =
  "A short walkthrough: payout files in, every line matched to the bank, fees and VAT split out, invoices closed in Zoho.";

export const PRIVACY_INTRO =
  "This is a placeholder. The founder will replace it with the reviewed privacy policy before launch.";
