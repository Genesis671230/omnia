import type { RamzaPage } from "./types";

/* Honest side-by-side pages. Every claim about another product carries a
   Citation with the date the source was last read, and the claim is phrased
   as what that source publishes rather than as an absolute. "Synder does not
   support Tabby" is a claim about their roadmap we cannot see; "Tabby is not
   on Synder's published integration list" is a claim about a page anyone can
   open, which is the only kind worth putting on a website. */

const UPDATED = "2026-09-19";
const CHECKED = "2026-09-18";

export const COMPARISONS: RamzaPage[] = [
  {
    path: "vs/spreadsheets",
    family: "vs",
    title: "RAMZA vs reconciling payouts in a spreadsheet",
    description:
      "An honest comparison of manual payout reconciliation against RAMZA, including the cases where a spreadsheet is genuinely the right answer.",
    crumb: "vs spreadsheets",
    h1: "RAMZA vs a spreadsheet",
    lead:
      "Most Gulf e-commerce finance teams reconcile payouts in Excel, and for a while that is the correct decision. This is where it stops being correct.",
    sections: [
      {
        kind: "prose",
        heading: "The spreadsheet is not the problem",
        body: [
          "A spreadsheet is fast, free, and understood by everyone who has to touch it. For one gateway, one currency and a few dozen orders a month, building software to replace it would be an indulgence.",
          "What breaks it is not volume, it is combinations. Add a second gateway and you have two settlement formats. Add Saudi and you have a currency. Add a refund that crosses a month boundary and last month's tab is now wrong, with no error message to tell you.",
        ],
      },
      {
        kind: "compare",
        heading: "Where each one wins",
        rows: [
          { dimension: "Setup cost", ramza: "Connect stores, send payout files", other: "None, it already exists", verdict: "other" },
          { dimension: "One gateway, one currency", ramza: "Works, but is more than you need", other: "Perfectly adequate", verdict: "other" },
          { dimension: "Five gateways, two currencies", ramza: "One view across all of them", other: "One tab each, reconciled by eye", verdict: "ramza" },
          { dimension: "Cross-month refunds", ramza: "Carried back to the original payout", other: "Silently wrong until someone checks", verdict: "ramza" },
          { dimension: "FX on SAR and KWD", ramza: "Rate taken from the wire itself", other: "Static table, small error every time", verdict: "ramza" },
          { dimension: "Posting to Zoho Books", ramza: "Automatic, at invoice total", other: "Manual journals", verdict: "ramza" },
          { dimension: "Audit trail", ramza: "Every match traceable to an order", other: "Whatever the last editor remembers", verdict: "ramza" },
          { dimension: "Flexibility for odd cases", ramza: "Structured, so odd cases get flagged", other: "You can type anything anywhere", verdict: "other" },
        ],
        footnote:
          "If your answer to the first three rows is that a spreadsheet is fine, it probably is. Come back when you add the second currency.",
      },
      {
        kind: "callout",
        tone: "note",
        heading: "The honest test",
        body:
          "Open last month's reconciliation tab and find the cell that makes it balance. If it is a formula that traces to a payout, the spreadsheet is working. If it is a number somebody typed, it is not reconciliation, it is a plug.",
      },
    ],
    faq: [
      {
        q: "Can we keep the spreadsheet as a check?",
        a: "Yes, and for the first month you should. Run both and compare. If they disagree, we would like to know which one was right.",
      },
    ],
    related: ["vs/synder", "vs/a2x", "reconciliation/tabby"],
    updated: UPDATED,
  },

  {
    path: "vs/synder",
    family: "vs",
    title: "Synder alternative for Gulf e-commerce payouts",
    description:
      "Synder automates accounting for Stripe, PayPal, Shopify and Square into QuickBooks and Xero. A comparison for stores settling through Tabby, Tamara or Telr into Zoho Books.",
    crumb: "vs Synder",
    h1: "RAMZA vs Synder",
    lead:
      "Synder is a mature, well-reviewed product, and if you sell in the US through Stripe and keep your books in QuickBooks it is a reasonable choice. The comparison that matters is what happens when your gateways are Gulf gateways.",
    sections: [
      {
        kind: "prose",
        heading: "Different stacks, not better and worse",
        body: [
          "Synder's published material describes automation for Stripe, PayPal, Shopify, Amazon and Square, posting into QuickBooks Online, Xero, Oracle NetSuite and Sage Intacct. That is a coherent product aimed at a coherent market.",
          "It is not the Gulf stack. A store in Dubai or Riyadh typically settles through some combination of Tabby, Tamara, Telr, Checkout.com, Stripe and a courier's COD remittance, and increasingly keeps its books in Zoho Books. Neither the BNPL gateways nor Zoho Books appear on Synder's published integration list.",
          "So the question is not which product is better built. It is whether the product covers the gateways your money actually arrives through.",
        ],
      },
      {
        kind: "compare",
        heading: "Coverage, side by side",
        rows: [
          { dimension: "Stripe", ramza: "Supported", other: "Supported, and a core focus", verdict: "even" },
          { dimension: "PayPal, Square, Amazon", ramza: "Not a focus", other: "Supported", verdict: "other" },
          { dimension: "Tabby, Tamara", ramza: "Core case", other: "Not on the published list", verdict: "ramza" },
          { dimension: "Telr, Checkout.com", ramza: "Supported", other: "Not on the published list", verdict: "ramza" },
          { dimension: "COD courier remittance", ramza: "Supported", other: "Not on the published list", verdict: "ramza" },
          { dimension: "QuickBooks, Xero, NetSuite", ramza: "Not supported", other: "Supported", verdict: "other" },
          { dimension: "Zoho Books", ramza: "Core case", other: "Not on the published list", verdict: "ramza" },
          { dimension: "AED and SAR FX on payouts", ramza: "Rate taken from the wire", other: "Not described for this case", verdict: "ramza" },
          { dimension: "Track record and reviews", ramza: "New, and pre-launch", other: "Long-established, thousands of reviews", verdict: "other" },
        ],
        footnote:
          "Coverage claims describe each product's published integration list as read on the date in Sources below, not what either may support on request.",
      },
      {
        kind: "callout",
        tone: "note",
        heading: "When Synder is the right answer",
        body:
          "If your books are in QuickBooks or Xero and your payments come through Stripe, PayPal or Square, Synder covers your stack and has years of reviews behind it. We would rather say so than pretend otherwise.",
      },
    ],
    faq: [
      {
        q: "Could Synder handle Tabby with custom work?",
        a: "Possibly. We can only compare what each product publishes. If that changes, this page changes with it, and the date it was last checked is at the bottom.",
      },
      {
        q: "Do you support QuickBooks or Xero?",
        a: "Not today. RAMZA posts to Zoho Books. If your books are in QuickBooks, Synder is the better fit right now.",
      },
    ],
    citations: [
      {
        claim: "Synder's published sales channels include Stripe, PayPal, Shopify, Amazon and Square",
        source: "Synder homepage",
        url: "https://synder.com/",
        checked: CHECKED,
      },
      {
        claim: "Synder's published accounting integrations are QuickBooks Online, Xero, Oracle NetSuite and Sage Intacct",
        source: "Synder homepage",
        url: "https://synder.com/",
        checked: CHECKED,
      },
    ],
    related: ["vs/a2x", "vs/spreadsheets", "reconciliation/stripe"],
    updated: UPDATED,
  },

  {
    path: "vs/a2x",
    family: "vs",
    title: "A2X alternative for Gulf e-commerce payouts",
    description:
      "A2X reconciles Shopify and Amazon settlements into Xero and QuickBooks. A comparison for UAE and KSA stores settling through Tabby, Tamara, Telr and COD into Zoho Books.",
    crumb: "vs A2X",
    h1: "RAMZA vs A2X",
    lead:
      "A2X has been doing settlement-level ecommerce accounting since 2014 and does it well. It is also built around a specific pair of channels and a specific pair of ledgers.",
    sections: [
      {
        kind: "prose",
        heading: "A settlement tool for Shopify and Amazon",
        body: [
          "A2X's model is to take a marketplace settlement, break it into its components, and post a summarised journal into the ledger so that the deposit reconciles. For Shopify and Amazon sellers on Xero or QuickBooks, that is exactly the right shape of tool and it has a long track record.",
          "The Gulf version of this problem has a different set of inputs. The settlements come from BNPL providers and local gateways rather than marketplaces, a meaningful share of revenue arrives as cash through a courier, and the ledger is often Zoho Books.",
          "There is also a difference in what the two produce. A2X posts summarised journals that make the deposit reconcile. RAMZA closes the individual invoices, so an invoice in Zoho shows as paid rather than revenue being restated in summary.",
        ],
      },
      {
        kind: "compare",
        heading: "Coverage, side by side",
        rows: [
          { dimension: "Shopify settlements", ramza: "Orders read from Shopify", other: "Core case, since 2014", verdict: "other" },
          { dimension: "Amazon settlements", ramza: "Not supported", other: "Core case", verdict: "other" },
          { dimension: "Tabby, Tamara, Telr", ramza: "Core case", other: "Not on the published list", verdict: "ramza" },
          { dimension: "COD courier remittance", ramza: "Supported", other: "Not on the published list", verdict: "ramza" },
          { dimension: "Xero, QuickBooks", ramza: "Not supported", other: "Core case", verdict: "other" },
          { dimension: "Zoho Books", ramza: "Core case", other: "Not on the published list", verdict: "ramza" },
          { dimension: "What lands in the ledger", ramza: "Individual invoices closed as paid", other: "Summarised settlement journals", verdict: "even" },
          { dimension: "Maturity", ramza: "New, and pre-launch", other: "Established, large customer base", verdict: "other" },
        ],
        footnote:
          "Coverage describes each product's published integrations as read on the date in Sources below.",
      },
      {
        kind: "callout",
        tone: "note",
        heading: "When A2X is the right answer",
        body:
          "Selling on Shopify or Amazon with books in Xero or QuickBooks, and no BNPL or COD in the mix: A2X is a proven fit and we would point you there.",
      },
    ],
    faq: [
      {
        q: "Is summarised journal posting worse than closing invoices?",
        a: "No, it is a different choice. Summarised journals keep the ledger tidy; closing invoices keeps accounts receivable honest. Which you want depends on whether anyone chases unpaid invoices.",
      },
    ],
    citations: [
      {
        claim: "A2X's published integrations centre on Shopify and Amazon, posting into Xero and QuickBooks",
        source: "A2X homepage",
        url: "https://www.a2xaccounting.com/",
        checked: CHECKED,
      },
    ],
    related: ["vs/synder", "vs/spreadsheets", "reconciliation/cod"],
    updated: UPDATED,
  },
];
