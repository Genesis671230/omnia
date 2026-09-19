/* All RAMZA landing copy in one place. Keep claims inside the guardrails:
   only Shopify, WooCommerce, Stripe, Telr, Tabby, Tamara, Checkout.com, COD
   couriers, Zoho Books, AED/SAR. No metrics, no client names, no logos. */

export type H1Variant = "default" | "money" | "books";

export const H1_VARIANTS: Record<H1Variant, string> = {
  default:
    "Every payout, matched to your bank",
  money: "Find the money your payment gateways didn't send.",
  books: "Your gateways pay out. RAMZA closes the books.",
};

export function resolveH1(param: string | string[] | undefined): string {
  const key = Array.isArray(param) ? param[0] : param;
  if (key && key in H1_VARIANTS) return H1_VARIANTS[key as H1Variant];
  return H1_VARIANTS.default;
}

export const HERO_SUB =
  "RAMZA reads your store orders, payout files and bank statement, matches every transaction, and posts payments, gateway fees and VAT to books. No more month-end spreadsheets.";

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

/* ── Value calculator ─────────────────────────────────────────────────────
   Every figure this produces is arithmetic on what the visitor typed. There
   are no benchmarks, no "stores typically lose 2%", no industry averages.
   That is deliberate: a made-up recovery rate is the one number a finance
   buyer will check, and being caught inventing it costs more than the
   calculator earns. The price itself is set on the audit, so the calculator
   sizes the problem rather than quoting.

   When the rate card is settled, add it here and the panel can show a monthly
   figure alongside the cost of the current process. */
export const CALC_DEFAULTS = {
  ordersPerMonth: 1500,
  gateways: 4,
  hoursPerMonth: 12,
  hourlyCostAed: 120,
};

export const CALC_BOUNDS = {
  // Capped at 10k so a typical Gulf store sits in the usable middle of the
  // track rather than pinned to the left end of a 50k range.
  ordersPerMonth: { min: 50, max: 10000, step: 50 },
  gateways: { min: 1, max: 8, step: 1 },
  hoursPerMonth: { min: 1, max: 160, step: 1 },
  hourlyCostAed: { min: 20, max: 800, step: 10 },
};

export const CALC_HEADING = "What the current process costs you";
export const CALC_INTRO =
  "Four numbers you already know. Everything below is arithmetic on them, not an industry average.";
export const CALC_FOOTNOTE =
  "Your price is set on the free payout audit, against your real volume and gateway mix, and locked for 12 months. No card, no commitment to see it.";

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Do I need to change payment gateways?",
    a: "No. RAMZA works with the ones you already use: Stripe, Telr, Tabby, Tamara, Checkout.com and cash-on-delivery couriers.",
  },
  {
    q: "What about my bank statement data?",
    a: "Files are used only to reconcile your account, never shared, and never used to train anything. We sign an NDA before you send the first file, and you can ask us to delete everything we hold at any time.",
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
    a: "Under a week. Connecting the stores and pulling the first payout files takes a day; the rest is us reconciling your most recent month alongside you so you can see the numbers agree before you rely on them.",
  },
  {
    q: "Is this an app or a service?",
    a: "Both. The software does the matching and posting; we set it up and check the first month with you.",
  },
];

/* Senior accountant review. Wording checked against what is actually offered:
   a layered review by senior accountants, not a named person assigned to one
   client, so the page never says "dedicated" or "your accountant". */
export const REVIEW_HEADING = "Software does the matching. Senior accountants check it.";
export const REVIEW_INTRO =
  "Automation is right most of the time, and the month you need it is the month it isn't. Every close passes through a layered review before anyone relies on the numbers.";

export const REVIEW_LAYERS: { step: string; title: string; body: string }[] = [
  {
    step: "Layer 1",
    title: "The engine matches",
    body: "Payouts tied to bank credits, fees and VAT split to their accounts, FX between AED and SAR resolved. Anything it cannot tie with confidence is held, not guessed.",
  },
  {
    step: "Layer 2",
    title: "Exceptions are worked",
    body: "Partial captures, post-cutoff refunds, invoices with no order behind them. Each one is resolved by hand and the reason is written next to it.",
  },
  {
    step: "Layer 3",
    title: "A senior accountant signs off",
    body: "Before the month is called closed, a qualified accountant reviews the postings, the fee and VAT treatment, and every exception left open, then tells you what needs a decision.",
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

/* What the reconciliation is actually for. Two outcomes, each backed by the
   specific mechanics elsewhere on the page rather than by an adjective. */
export const OUTCOMES_HEADING = "Reconciled books are the deliverable";
export const OUTCOMES_INTRO =
  "Matching payouts is the work. These are the two things it buys you, and both of them have a deadline attached.";

export const OUTCOMES: {
  stamp: string;
  title: string;
  body: string;
  points: string[];
}[] = [
  {
    stamp: "Tax ready",
    title: "Tax-ready books",
    body: "Every gateway fee is posted to bank charges with the VAT on the fee recorded as input tax, so the return is built from the ledger instead of reconstructed from statements the week it is due.",
    points: [
      "Gateway fees and the VAT on them split out per payout",
      "AED and SAR held separately, FX difference booked",
      "Nothing parked in a suspense or residual account",
    ],
  },
  {
    stamp: "Investor ready",
    title: "Investor-ready financials",
    body: "Revenue is recognised against the order that earned it, not the day the gateway happened to settle, so a month closes once and stays closed when a payout lands late.",
    points: [
      "Revenue on order date, cash on payout date, both available",
      "Cross-month payouts split rather than dropped",
      "Every exception listed with the reason it was left open",
    ],
  },
];

export const VIDEO_INTRO_HEADING = "See a month close in under a minute";
export const VIDEO_INTRO_BODY =
  "A short walkthrough: payout files in, every line matched to the bank, fees and VAT split out, invoices closed in Zoho.";

export const PRIVACY_INTRO =
  "What we collect when you ask for a payout audit, why we hold it, and how to get it deleted. Plain terms, no defined-term index.";

/* --- the product frame ---------------------------------------------------
   Copy and synthetic rows for components/ramza/product-frame.tsx, the one
   section that shows the application interface rather than its accounting
   output. Figures are invented but internally consistent: bank credit minus
   payout net equals the variance on every row, and the totals in the tiles
   foot to the rows below them. A finance buyer checks that arithmetic, and a
   frame that does not add up is worse than no frame. */

export const PRODUCT_FRAME = {
  heading: "The month, on one screen",
  body:
    "Every gateway payout lined up against the bank credit that paid it. Matched rows settle green. A variance is the gap RAMZA is still chasing, not a number you have to go find.",
  disclaimer: "Illustrative figures. Five gateways, one bank account, one month.",
  windowTitle: "Reconciliation",
  period: "March 2026",
  footer: "18 payouts · 1,204 orders · AED 1,486,220.40 matched to the bank",
};

export const PRODUCT_TILES: { label: string; value: string; note?: string }[] = [
  { label: "Matched (AED)", value: "1,486,220.40", note: "16 of 18 payouts" },
  { label: "Awaiting bank", value: "84,310.00", note: "1 payout in transit" },
  { label: "Gateway fees", value: "41,905.62", note: "incl. VAT on fees" },
  { label: "Open variance", value: "1,240.00", note: "1 payout to review" },
];

export const PRODUCT_ROWS: {
  date: string;
  gateway: string;
  ref: string;
  bank: string;
  net: string;
  variance: string;
  status: string;
  matched: boolean;
}[] = [
  {
    date: "28 Mar",
    gateway: "Tabby",
    ref: "TBY-0318994",
    bank: "312,480.20",
    net: "312,480.20",
    variance: "0.00",
    status: "Matched",
    matched: true,
  },
  {
    date: "27 Mar",
    gateway: "Tamara",
    ref: "TMR-772140",
    bank: "268,905.00",
    net: "268,905.00",
    variance: "0.00",
    status: "Matched",
    matched: true,
  },
  {
    /* The SAR row is the one that earns its place: a KWD/SAR payout lands in
       AED at the bank's own wire rate, not the static FX table, and that gap
       is the single most common reason a Gulf payout is left unreconciled. */
    date: "26 Mar",
    gateway: "Telr (SAR)",
    ref: "TLR-2240871",
    bank: "195,332.40",
    net: "194,092.40",
    variance: "1,240.00",
    status: "FX variance",
    matched: false,
  },
  {
    date: "25 Mar",
    gateway: "Stripe",
    ref: "po_1Qx8mLB",
    bank: "148,770.60",
    net: "148,770.60",
    variance: "0.00",
    status: "Matched",
    matched: true,
  },
  {
    date: "24 Mar",
    gateway: "COD, Aramex",
    ref: "ARX-CO-44182",
    bank: "96,214.00",
    net: "96,214.00",
    variance: "0.00",
    status: "Matched",
    matched: true,
  },
];
