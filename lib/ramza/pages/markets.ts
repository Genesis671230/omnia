import type { RamzaPage } from "./types";

/* UAE and KSA pages. Regulatory specifics are deliberately thin here: VAT and
   e-invoicing rules change, and a landing page that states a rate or a
   deadline is a liability the day it goes stale. These pages describe the
   payment and banking landscape, which is what the buyer is searching for,
   and send regulatory questions to the regulator. */

const UPDATED = "2026-09-19";

export const MARKETS: RamzaPage[] = [
  {
    path: "markets/uae",
    family: "market",
    title: "Payout reconciliation for UAE e-commerce stores",
    description:
      "How UAE online stores reconcile Tabby, Tamara, Telr, Stripe and COD payouts to an AED bank account and close invoices in Zoho Books.",
    crumb: "UAE",
    h1: "Payout reconciliation in the UAE",
    lead:
      "A typical Dubai store takes payment four or five different ways and receives it into one AED account. That asymmetry is the whole reconciliation problem.",
    sections: [
      {
        kind: "prose",
        heading: "What the UAE payment mix looks like",
        body: [
          "Card payments through Telr, Checkout.com or Stripe. Buy now pay later through Tabby and Tamara, which between them can account for a large share of basket value. Cash on delivery through a courier, still significant despite years of predictions otherwise.",
          "Each of those settles on its own cycle, net of its own fees, in its own file format. They all land in the same bank account, in AED, as credits that carry a reference nobody outside the gateway can decode.",
          "The reconciliation question is therefore not how much did we sell. It is which of these credits corresponds to which orders, and what was taken out on the way.",
        ],
      },
      {
        kind: "steps",
        heading: "What RAMZA does with it",
        steps: [
          { title: "One view across every gateway", body: "Card, BNPL and COD settlements are reconciled against the same AED account, so the month closes once rather than five times." },
          { title: "Fees and their VAT, posted properly", body: "Gateway fees go to bank charges with input VAT recorded, rather than being netted off revenue." },
          { title: "Invoices closed in Zoho Books", body: "Each invoice is paid at its full total, so receivables reflect what customers actually owed." },
        ],
      },
      {
        kind: "callout",
        tone: "caution",
        heading: "On tax questions",
        body:
          "RAMZA records fees and the VAT on them so your books are complete and traceable. It is not tax advice, and it does not file on your behalf. For treatment specific to your business, ask your accountant or the Federal Tax Authority directly.",
      },
    ],
    faq: [
      { q: "Do you work with stores outside Dubai?", a: "Yes. Anywhere in the UAE, and Saudi Arabia as well." },
      { q: "Which bank do we need to be with?", a: "Any. The statement is what gets reconciled, not the bank's API." },
    ],
    related: ["markets/ksa", "reconciliation/cod", "reconciliation/tabby"],
    updated: UPDATED,
  },

  {
    path: "markets/ksa",
    family: "market",
    title: "Payout reconciliation for Saudi e-commerce stores",
    description:
      "How KSA stores reconcile SAR payouts from Tabby, Tamara and Telr, handle the AED and SAR FX difference, and close invoices in Zoho Books.",
    crumb: "KSA",
    h1: "Payout reconciliation in Saudi Arabia",
    lead:
      "Selling into Saudi from a UAE entity, or holding both, adds one variable that breaks every spreadsheet: the payout and the bank account are not in the same currency.",
    sections: [
      {
        kind: "prose",
        heading: "The riyal is where reconciliation goes wrong",
        body: [
          "A payout raised in SAR and credited to an AED account is converted by the bank at the rate available at that moment. Your accounting system holds a different rate, usually a monthly one. The two are never quite equal.",
          "Per payout the difference is small. Across a month of settlements it becomes a balance that will not close, and the usual fix is a manual journal that makes the number right and the explanation impossible.",
          "The reconciliation has to use the rate the money actually moved at. Anything else is an approximation that compounds.",
        ],
      },
      {
        kind: "checklist",
        heading: "What this covers",
        items: [
          { title: "SAR payouts into an AED account", body: "Matched at the rate the wire used, so the posted figure equals the statement.", state: "yes" },
          { title: "FX gain and loss posted separately", body: "Kept apart from the gateway fee, because they are different facts with different treatment.", state: "yes" },
          { title: "KWD and other Gulf currencies", body: "Handled the same way where the bank records the rate on the transfer.", state: "yes" },
          { title: "ZATCA e-invoicing submission", body: "RAMZA reconciles payouts and posts to Zoho Books. It does not submit e-invoices.", state: "no" },
        ],
      },
    ],
    faq: [
      { q: "We hold both AED and SAR accounts. Does that help?", a: "It removes the conversion for SAR payouts into the SAR account, and RAMZA reconciles both accounts either way." },
      { q: "Do you handle ZATCA compliance?", a: "No. RAMZA is reconciliation and posting. E-invoicing submission is a separate obligation and you should treat it as such." },
    ],
    related: ["markets/uae", "reconciliation/telr", "reconciliation/tamara"],
    updated: UPDATED,
  },
];
