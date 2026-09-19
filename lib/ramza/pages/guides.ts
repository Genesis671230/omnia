import type { RamzaPage } from "./types";

/* Top-of-funnel explainers. These answer the question rather than selling,
   because a guide that turns into a pitch three paragraphs in gets closed,
   and because these are the pages an AI assistant will quote from. */

const UPDATED = "2026-09-19";

export const GUIDES: RamzaPage[] = [
  {
    path: "guides/gateway-settlement-reports",
    family: "guide",
    title: "What a gateway settlement report actually contains",
    description:
      "A plain explanation of settlement reports, payout batches, gross versus net, and why the deposit in your bank never equals the invoices behind it.",
    crumb: "Settlement reports",
    h1: "What a settlement report actually contains",
    lead:
      "Every payment gateway produces one, almost nobody reads one, and the gap between the two is where most e-commerce reconciliation problems begin.",
    sections: [
      {
        kind: "prose",
        heading: "Gross, net, and the bit in between",
        body: [
          "A settlement report lists the transactions a gateway is paying you for in a given cycle, what it charged for each, and what it is therefore transferring. The important columns are gross, the amount the customer paid, and net, the amount you receive.",
          "The difference is not a single number. It is typically a percentage fee, sometimes a fixed per-transaction charge, tax on those charges, and any adjustments carried over from a previous cycle such as a refund or a chargeback.",
          "That last category is what makes settlement reports genuinely hard. A refund processed this week can reduce a payout that otherwise relates entirely to last month, so the report you are reading describes two different accounting periods at once.",
        ],
      },
      {
        kind: "steps",
        heading: "How to read one",
        steps: [
          { title: "Find the payout total first", body: "One number on the report should equal one credit on your bank statement. If it does not, stop and find out why before going further." },
          { title: "Separate fees from adjustments", body: "Fees are an expense for this period. Adjustments belong to the period of the original transaction." },
          { title: "Check the tax treatment of the fee", body: "In the UAE the VAT on a gateway fee is generally recoverable input VAT. Netting the fee off revenue loses it." },
          { title: "Tie the gross back to orders", body: "Gross should reconcile to the invoices in your store. If it does not, the gap is usually a partially captured or cancelled order." },
        ],
      },
      {
        kind: "callout",
        tone: "note",
        heading: "The one check worth doing monthly",
        body:
          "Add up every payout total for the month and compare it to the sum of gateway credits on the bank statement. If those two numbers differ, something did not arrive, and finding out which payout it was gets harder every week you leave it.",
      },
    ],
    faq: [
      { q: "Why does my gateway dashboard disagree with my bank?", a: "Usually timing: a payout reported on the last day of the month often credits a day or two later. The rest of the time it is an adjustment carried from a previous cycle." },
      { q: "Should revenue be recorded gross or net?", a: "Gross. Revenue is what the customer was billed; the gateway fee is a cost of collecting it. Recording net understates both revenue and expenses." },
    ],
    related: ["guides/cod-reconciliation", "reconciliation/telr", "reconciliation/stripe"],
    updated: UPDATED,
  },

  {
    path: "guides/cod-reconciliation",
    family: "guide",
    title: "How to reconcile cash on delivery orders",
    description:
      "Why COD is the hardest line to reconcile for Gulf e-commerce, what goes wrong, and a monthly process for tying courier remittances back to delivered orders.",
    crumb: "COD reconciliation",
    h1: "How to reconcile cash on delivery",
    lead:
      "COD looks simple and reconciles badly. The order, the delivery, the collection and the remittance are four separate events, and only the last one touches your bank.",
    sections: [
      {
        kind: "prose",
        heading: "Why it drifts",
        body: [
          "When a customer pays cash at the door, the courier holds your money. It reaches you on the courier's remittance cycle, net of the shipping charge and usually a handling fee, aggregated across many deliveries.",
          "Meanwhile the order sits in your store marked as placed, and the invoice sits in your books marked as unpaid. Neither knows whether the parcel was delivered, refused, or is still in a warehouse.",
          "Refused and returned orders are the real leak. They never become cash, but unless somebody reconciles deliveries against remittances, they stay on the books as receivable revenue that will never be collected.",
        ],
      },
      {
        kind: "steps",
        heading: "A monthly process that works",
        steps: [
          { title: "Get the delivery report, not just the remittance", body: "The remittance says what you were paid. Only the delivery report says what was collected, and the difference between them is what you are looking for." },
          { title: "Match remittances to delivery dates, not order dates", body: "An order placed in March and delivered in April is April's cash. Matching on order date guarantees a permanent mismatch." },
          { title: "Book shipping and COD fees separately", body: "They are different expenses and may be taxed differently. One combined deduction cannot be verified later." },
          { title: "Write off what was never delivered", body: "Returned and refused orders should leave receivables in the month you find out, not at year end." },
        ],
      },
      {
        kind: "callout",
        tone: "caution",
        heading: "If you have never done this",
        body:
          "The first reconciliation usually uncovers a larger gap than expected, because it is the sum of every undelivered order since the last time anyone checked. That is worth knowing before you start, not after.",
      },
    ],
    faq: [
      { q: "How often should COD be reconciled?", a: "Monthly. Quarterly is survivable. Annually means finding a year of uncollected orders at once, with no way to chase any of them." },
      { q: "What if the courier's report and ours disagree?", a: "Reconcile at the order level and the disagreement resolves to specific parcels you can query. Reconciling on totals only tells you that you disagree." },
    ],
    related: ["guides/gateway-settlement-reports", "reconciliation/cod", "markets/uae"],
    updated: UPDATED,
  },
];
