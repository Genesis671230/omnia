import { rules } from "../rules";
import type { Citation, RamzaPage } from "./types";

/* The Zoho Books cluster. People choosing or running Zoho Books in the UAE
   search "zoho books vs quickbooks", "zoho books features", "zoho books
   integrations" and now "claude zoho books". RAMZA works inside Zoho Books
   every day, which is the authority these pages lean on: what Zoho does well,
   where the gaps are (Gulf gateway payouts), and how to close them.

   Rules for this file: every claim about Zoho, Intuit or anyone else carries a
   Citation and is phrased as what that source publishes; prices are quoted with
   the date we read them; RAMZA is independent of Zoho and says so. */

const UPDATED = "2026-10-26";
const CHECKED = "2026-10-26";

const FREE_SETUP = rules.offer.free_trial.free_setup.headline;

const ZOHO_PRICING: Citation = {
  claim: "Zoho Books UAE plans, prices, limits and VAT / e-invoicing features",
  source: "Zoho Books UAE pricing page",
  url: "https://www.zoho.com/ae/books/pricing/",
  checked: CHECKED,
};
const ZOHO_MCP: Citation = {
  claim: "Connecting Zoho Books to Claude: default connector and Zoho MCP",
  source: "Zoho Books help: Zoho Books MCP",
  url: "https://www.zoho.com/books/help/mcp/zoho-books-mcp.html",
  checked: CHECKED,
};
const ZOHO_GATEWAYS: Citation = {
  claim: "Payment gateways Zoho Books integrates with for online invoice payments",
  source: "Zoho Books UAE help: integrations",
  url: "https://www.zoho.com/ae/books/help/settings/integrations.html",
  checked: CHECKED,
};
const QBO_PLANS: Citation = {
  claim: "QuickBooks Online UAE plans, user limits and 30-day trial",
  source: "QuickBooks UAE pricing page",
  url: "https://quickbooks.intuit.com/ae/pricing/",
  checked: CHECKED,
};
const QBO_VAT: Citation = {
  claim: "QuickBooks Online UAE VAT tracking, pre-filled with the 5% rate",
  source: "QuickBooks UAE: VAT tracking",
  url: "https://quickbooks.intuit.com/ae/vat-tracking/",
  checked: CHECKED,
};

export const ZOHO_PAGES: RamzaPage[] = [
  {
    path: "zoho/zoho-books-vs-quickbooks-uae",
    family: "zoho",
    title: "Zoho Books vs QuickBooks in the UAE (2026): VAT, e-invoicing, price",
    description:
      "Zoho Books vs QuickBooks Online for UAE businesses: VAT filing, e-invoicing, Corporate Tax, AED pricing, users and integrations, with sources and the cases where QuickBooks is the better choice.",
    crumb: "Zoho Books vs QuickBooks",
    h1: "Zoho Books vs QuickBooks for UAE businesses",
    lead:
      "For most UAE small and mid-sized businesses, Zoho Books is the better fit: it publishes AED pricing, a free plan, direct VAT filing and an e-invoicing add-on for the UAE. QuickBooks Online is the stronger choice if your accountant, group or US entity already runs on it, or if you need its wider third-party app ecosystem.",
    sections: [
      {
        kind: "table",
        heading: "Side by side",
        intro: "What each vendor publishes for the UAE, read on the date at the bottom of the page.",
        columns: ["", "Zoho Books (UAE)", "QuickBooks Online (UAE)"],
        rows: [
          ["Free plan", "Yes, while yearly revenue stays under AED 200,000 (1 user + 1 accountant)", "No; 30-day free trial"],
          ["Entry paid plan", "Standard: AED 60/month billed yearly, AED 69 monthly, 3 users", "Simple Start: 1 user (price shown live on the UAE site)"],
          ["Users on the top plan", "15 (Ultimate)", "25 (Advanced)"],
          ["UAE VAT", "VAT tracking, VAT returns and audit reports; direct VAT filing listed on the Standard plan", "VAT tracking pre-filled with the 5% rate; VAT agency set up by hand"],
          ["UAE e-invoicing", "E-invoicing add-on from the Professional plan, first 100 transactions free", "Not offered natively on the UAE site at the time of checking; third-party connectors exist"],
          ["Corporate Tax", "Corporate Tax compliance listed from the Professional plan", "No UAE Corporate Tax feature listed"],
          ["Ecosystem", "Strongest with other Zoho apps (CRM, Inventory, Commerce)", "Larger global marketplace of third-party apps"],
          ["AI assistants", "Official Zoho Books connector in Claude, plus Zoho MCP", "Intuit's own assistant inside QuickBooks"],
        ],
        footnote: "Prices exclude VAT and change; check both pricing pages before you buy.",
      },
      {
        kind: "prose",
        heading: "When QuickBooks is the right answer",
        body: [
          "If your group reports in QuickBooks, if your external accountant works only in it, or if you have a US or UK entity on QuickBooks already, one system across entities is worth more than any feature on this page.",
          "QuickBooks also has a larger marketplace of third-party apps. If a tool you depend on only integrates with QuickBooks, that decides it.",
        ],
      },
      {
        kind: "prose",
        heading: "When Zoho Books is the right answer",
        body: [
          "For a UAE-first business, Zoho publishes the UAE-specific features in its own pricing: VAT returns, direct VAT filing, an e-invoicing add-on and Corporate Tax support. The free plan covers very small businesses, and the paid plans are priced in AED.",
          "If you already use Zoho CRM, Zoho Inventory or Zoho Commerce, the data flows without a connector.",
        ],
      },
      {
        kind: "callout",
        tone: "note",
        heading: "The gap neither one closes for online stores",
        body:
          "Neither product reconciles Tabby, Tamara, Telr or cash-on-delivery payouts to your bank. A payout arrives net of fees, VAT on fees and refunds, so it never matches the sales total. RAMZA does that matching and posts the result to Zoho Books after you approve it.",
      },
    ],
    faq: [
      { q: "Is Zoho Books or QuickBooks better in the UAE?", a: "For most UAE-only small businesses, Zoho Books: AED pricing, a free plan, direct VAT filing and an e-invoicing add-on. QuickBooks is better when your group or accountant already uses it." },
      { q: "Does QuickBooks support UAE VAT?", a: "QuickBooks Online's UAE site offers VAT tracking pre-filled with the 5% rate. The VAT agency is configured by hand rather than through a direct filing integration." },
      { q: "Does Zoho Books support UAE e-invoicing?", a: "Zoho lists an e-invoicing add-on on its UAE Professional plan and above, with the first 100 transactions free and paid packs after that." },
      { q: "Can I move from QuickBooks to Zoho Books?", a: "Yes. Zoho Books has a migration path for QuickBooks data. Move at a year end or month end, and reconcile the opening balances before you switch off the old system." },
    ],
    related: ["zoho/zoho-books-uae-features", "zoho/best-accounting-software-uae", "zoho/zoho-books-integrations-uae", "tools/vat-calculator-uae"],
    citations: [ZOHO_PRICING, QBO_PLANS, QBO_VAT],
    updated: UPDATED,
  },

  {
    path: "zoho/zoho-books-uae-features",
    family: "zoho",
    title: "Zoho Books UAE: plans, prices in AED and VAT features (2026)",
    description:
      "Every Zoho Books UAE plan from Free to Ultimate: AED price, users, invoice limits, VAT filing, e-invoicing add-on and Corporate Tax features, and what Zoho Books leaves for you to do.",
    crumb: "Zoho Books UAE features",
    h1: "Zoho Books in the UAE: plans, prices and features",
    lead:
      "Zoho Books has six UAE plans, from a free plan for businesses with yearly revenue under AED 200,000 to Ultimate at AED 660 a month billed yearly. VAT returns and direct VAT filing start on Standard; the e-invoicing add-on and Corporate Tax features start on Professional.",
    sections: [
      {
        kind: "table",
        heading: "Zoho Books UAE plans",
        columns: ["Plan", "AED/month (yearly)", "AED/month (monthly)", "Users", "Invoices a year"],
        rows: [
          ["Free", "0", "0", "1 + accountant", "1,000"],
          ["Standard", "60", "69", "3", "5,000"],
          ["Professional", "90", "129", "5", "10,000"],
          ["Premium", "120", "159", "10", "25,000"],
          ["Elite", "280", "349", "10", "100,000"],
          ["Ultimate", "660", "799", "15", "100,000"],
        ],
        footnote: "Prices exclude VAT. Extra users are AED 8 a month billed yearly (AED 10 monthly). The free plan stays free while the year's revenue is under AED 200,000.",
      },
      {
        kind: "checklist",
        heading: "UAE compliance features",
        items: [
          { title: "VAT tracking and VAT returns", body: "From Standard, with audit reports.", state: "yes" },
          { title: "Direct VAT filing", body: "Listed as new on the Standard plan.", state: "yes" },
          { title: "E-invoicing", body: "Add-on from Professional; first 100 transactions free, then packs from AED 41 per 100.", state: "partial" },
          { title: "Corporate Tax", body: "Corporate Tax compliance listed from Professional.", state: "yes" },
          { title: "Gulf gateway payout reconciliation", body: "Tabby, Tamara, Telr and COD payouts are not reconciled to the bank automatically.", state: "no" },
        ],
      },
      {
        kind: "prose",
        heading: "What Zoho Books leaves to you",
        body: [
          "Zoho Books is a ledger: it records what you tell it. When a gateway pays out AED 9,412 for AED 10,000 of sales, someone still has to split that payout into the orders, the fee, the VAT on the fee and the refunds, and mark each invoice paid. For a store on several gateways, that is most of month-end.",
          "That split is the job RAMZA does. It reads the bank line, finds the payout file behind it, prepares the entries in Zoho Books and posts them only when you approve.",
        ],
      },
    ],
    faq: [
      { q: "Is Zoho Books free in the UAE?", a: "Yes, for businesses whose yearly revenue is under AED 200,000, with one user plus an accountant and up to 1,000 invoices a year." },
      { q: "Which Zoho Books plan do I need for e-invoicing?", a: "Professional or above. Zoho lists e-invoicing as an add-on there, with the first 100 transactions free." },
      { q: "Is RAMZA part of Zoho?", a: "No. RAMZA is an independent AI agent that works with your Zoho Books organisation. It is not affiliated with or endorsed by Zoho." },
    ],
    related: ["zoho/zoho-books-vs-quickbooks-uae", "zoho/zoho-books-integrations-uae", "zoho/claude-zoho-books", "tools/e-invoicing-deadline-check"],
    citations: [ZOHO_PRICING],
    updated: UPDATED,
  },

  {
    path: "zoho/zoho-books-integrations-uae",
    family: "zoho",
    title: "Zoho Books integrations for UAE stores: Tabby, Tamara, Telr, Stripe, Shopify",
    description:
      "Which payment gateways and stores connect to Zoho Books in the UAE: native gateways, Shopify connectors, Zapier and Zoho MCP, and how to bring Tabby, Tamara, Telr and COD payouts into the books.",
    crumb: "Zoho Books integrations",
    h1: "Zoho Books integrations for UAE online stores",
    lead:
      "Zoho Books connects natively to payment gateways such as Stripe and PayPal for collecting invoice payments, and to Shopify through third-party connectors. Tabby, Tamara, Telr and cash-on-delivery payouts have no native Zoho Books integration on Zoho's published list, so their settlements are usually booked by hand. RAMZA reads those payouts and posts them to Zoho Books.",
    sections: [
      {
        kind: "table",
        heading: "What connects, and how",
        columns: ["Source", "How it reaches Zoho Books", "What still needs doing"],
        rows: [
          ["Stripe, PayPal", "Native payment gateways for invoice payments", "Payout fees, VAT on fees and refunds still need booking"],
          ["Shopify", "Third-party connectors that sync orders, refunds and payouts", "Matching payouts to the bank"],
          ["Tabby", "No native integration listed", "Settlement report → orders, fees, VAT, refunds → bank line"],
          ["Tamara", "No native integration listed", "Same as Tabby, on its own settlement cycle"],
          ["Telr", "No native integration listed", "Batched card settlements per day"],
          ["Cash on delivery", "No integration; courier remittance files", "Courier fee per order, delivered vs returned"],
          ["Zapier and similar", "Event triggers into Zoho Books", "Good for simple records; no payout matching"],
          ["Claude and other AI tools", "Zoho Books connector and Zoho MCP", "Acts on instructions; you decide what to post"],
        ],
      },
      {
        kind: "steps",
        heading: "How a gateway payout should land in Zoho Books",
        steps: [
          { title: "Start at the bank line", body: "The bank credit is the only figure you know is real. Everything else is matched to it." },
          { title: "Find the payout file", body: "Each gateway publishes a settlement report listing the orders, fees and refunds inside that credit." },
          { title: "Apply each order to its invoice", body: "Payment at the invoice total, so each invoice closes in full." },
          { title: "Book the fee and the VAT on the fee", body: "The fee is an expense; the VAT on it is usually recoverable input VAT." },
          { title: "Book refunds and FX", body: "Refunds against their credit notes; any currency difference to exchange gain or loss." },
        ],
      },
    ],
    faq: [
      { q: "Does Zoho Books integrate with Tabby or Tamara?", a: "Neither appears in Zoho Books' published integration list for the UAE at the time of checking. Their payouts are booked from the settlement reports, by hand or with a tool such as RAMZA." },
      { q: "Can Zapier reconcile gateway payouts in Zoho Books?", a: "Zapier can create records when something happens, but it does not match a net payout to the orders, fees and refunds inside it." },
    ],
    related: ["reconciliation/tabby", "reconciliation/tamara", "reconciliation/telr", "zoho/claude-zoho-books", "zoho/zoho-books-uae-features"],
    citations: [ZOHO_GATEWAYS, ZOHO_MCP],
    updated: UPDATED,
  },

  {
    path: "zoho/claude-zoho-books",
    family: "zoho",
    title: "How to connect Claude to Zoho Books (connector and Zoho MCP)",
    description:
      "Step-by-step: connect Claude to your Zoho Books organisation with the official connector or a Zoho MCP server, what Claude can do there, the safety settings to use, and when you need an accounting agent instead.",
    crumb: "Claude + Zoho Books",
    h1: "How to connect Claude to Zoho Books",
    lead:
      "Zoho Books is in Claude's connector directory. In Claude, open Customize → Connectors, browse for Zoho Books, click Connect and pick your data centre region. The default connector covers a subset of actions; for more, build a server in Zoho MCP and add it to Claude as a custom connector.",
    sections: [
      {
        kind: "steps",
        heading: "Connect with the default connector",
        steps: [
          { title: "Open connectors", body: "In Claude: Customize → Connectors → + → Browse connectors." },
          { title: "Find Zoho Books", body: "Search for Zoho Books and click Connect." },
          { title: "Pick your region", body: "Choose the data centre your Zoho account lives in, then Continue and sign in." },
          { title: "Ask before you act", body: "Zoho asks you to get your organisation admin's approval before performing actions through the MCP server." },
        ],
      },
      {
        kind: "prose",
        heading: "When you need Zoho MCP instead",
        body: [
          "The default connector supports only the actions on its tool list. To give Claude more tools, or to combine Zoho Books with Zoho CRM or other apps, configure a server in Zoho MCP and connect it to Claude as a custom connector. The same server works with other MCP clients.",
          "Add only the tools you need. A connector that can create invoices and record payments can also create wrong ones.",
        ],
      },
      {
        kind: "table",
        heading: "What Claude can do in Zoho Books",
        columns: ["Area", "Examples Zoho lists"],
        rows: [
          ["Record finances", "Create and send invoices, record expenses, reconcile bank transactions"],
          ["Receivables", "Track overdue invoices, send reminders, check outstanding amounts"],
          ["Business data", "Add or update customers, vendors and items"],
          ["Insights", "Revenue, profit and loss and expense summaries"],
        ],
      },
      {
        kind: "callout",
        tone: "caution",
        heading: "A chat assistant is not a month-end close",
        body:
          "Claude with the Zoho Books connector does what you ask, one instruction at a time. It does not know that a Tabby payout of AED 9,412 contains twelve orders, a fee, VAT on the fee and a refund. RAMZA is an accounting agent built for that: it starts from the bank, finds the payout file, prepares every entry and posts nothing to Zoho until you approve.",
      },
    ],
    faq: [
      { q: "Is there an official Zoho Books connector for Claude?", a: "Yes. Zoho documents a Zoho Books connector in Claude's connector directory, plus Zoho MCP for custom servers." },
      { q: "Can Claude reconcile my bank in Zoho Books?", a: "Zoho lists reconciling bank transactions among the connector's capabilities. Matching a net gateway payout to the orders, fees and refunds inside it needs the payout file, which is the part RAMZA automates." },
      { q: "Is it safe to let Claude post to Zoho Books?", a: "Use the narrowest set of tools, get admin approval as Zoho advises, and review entries before they post. RAMZA posts only lines you approve." },
    ],
    related: ["zoho/zoho-books-integrations-uae", "zoho/zoho-books-uae-features", "zoho/zoho-books-vs-quickbooks-uae"],
    citations: [ZOHO_MCP],
    updated: UPDATED,
  },

  {
    path: "zoho/best-accounting-software-uae",
    family: "zoho",
    title: "Best accounting software in the UAE (2026): Zoho Books, QuickBooks, Xero, Wafeq, Tally",
    description:
      "An independent shortlist of accounting software for UAE businesses in 2026, by what each is best for: VAT, e-invoicing readiness, Arabic, price and e-commerce payouts, with sources.",
    crumb: "Best accounting software UAE",
    h1: "Best accounting software for UAE businesses in 2026",
    lead:
      "Zoho Books is the default choice for most UAE small and mid-sized businesses: AED pricing, a free plan, direct VAT filing and an e-invoicing add-on. Wafeq suits businesses that want a UAE-built, bilingual product; QuickBooks and Xero suit groups that already use them abroad; Tally Prime suits stock-heavy trading companies that prefer desktop software.",
    sections: [
      {
        kind: "table",
        heading: "Shortlist",
        columns: ["Software", "Best for", "Watch out for"],
        rows: [
          ["Zoho Books", "Most UAE SMEs; teams already on Zoho apps", "Gulf gateway payouts need booking by hand"],
          ["Wafeq", "UAE-built, Arabic-English invoicing", "Smaller app ecosystem"],
          ["QuickBooks Online", "Groups and accountants already on QuickBooks", "UAE VAT agency set up by hand; e-invoicing via third parties"],
          ["Xero", "Groups already on Xero abroad", "Check UAE VAT filing and e-invoicing support before choosing"],
          ["Tally Prime", "Trading and inventory-heavy companies", "Desktop-first rather than cloud"],
        ],
        footnote: "Before you buy, check each vendor's current UAE pricing and its e-invoicing plan, and check accreditation claims against the Federal Tax Authority's own registers.",
      },
      {
        kind: "checklist",
        heading: "How to choose",
        items: [
          { title: "E-invoicing path", body: "Does the software offer, or connect to, an accredited service provider before your deadline?", state: "partial" },
          { title: "VAT return", body: "Does it produce the VAT return from the ledger, with an audit trail?", state: "partial" },
          { title: "Your accountant", body: "Which system does your accountant or auditor work in every day?", state: "partial" },
          { title: "Your payment gateways", body: "How will Tabby, Tamara, Telr, Stripe and COD payouts reach the books?", state: "partial" },
        ],
      },
      {
        kind: "callout",
        tone: "note",
        heading: "Where RAMZA fits",
        body: `RAMZA is not accounting software. It is an AI agent that works inside Zoho Books and closes your month from the bank: payouts matched, fees and VAT booked, invoices marked paid, all after your approval. ${FREE_SETUP}`,
      },
    ],
    faq: [
      { q: "What is the most used accounting software in the UAE?", a: "No official usage figures are published. Zoho Books, QuickBooks, Xero and Tally are the names UAE comparison guides list most often, with Wafeq as the main UAE-built option." },
      { q: "Do I need FTA-accredited accounting software?", a: "VAT and Corporate Tax rules require proper records and returns, not a particular brand. For e-invoicing you will need an accredited service provider; check the software's route to one." },
    ],
    related: ["zoho/zoho-books-vs-quickbooks-uae", "zoho/zoho-books-uae-features", "tools/vat-calculator-uae", "tools/e-invoicing-deadline-check"],
    citations: [
      ZOHO_PRICING,
      QBO_VAT,
      { claim: "Wafeq bilingual invoicing and UAE VAT features", source: "Wafeq: choosing FTA-compliant VAT software", url: "https://www.wafeq.com/en-ae/tax-and-reporting/how-to-choose-the-right-fta-compliant-vat-accounting-software-for-your-uae-business", checked: CHECKED },
      { claim: "UAE accounting software comparison including Tally and Xero", source: "Audit Firms Dubai, accounting software comparison", url: "https://auditfirmsdubai.ae/en/resources/blog/best-accounting-software-uae-2025-comparison", checked: CHECKED },
    ],
    updated: UPDATED,
  },
];
