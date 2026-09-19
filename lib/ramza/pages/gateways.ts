import type { RamzaPage } from "./types";

/* One page per gateway RAMZA reconciles. Highest commercial intent in the set:
   someone searching "Tabby payout reconciliation" is the exact buyer.

   Claims here stay inside what the product actually does and what is true of
   the gateway's settlement model generally. No fee percentages, no processing
   times, no gateway logos — those change per contract and per merchant, and a
   number that is wrong on a landing page is found out in the first call. */

const UPDATED = "2026-09-19";

export const GATEWAYS: RamzaPage[] = [
  {
    path: "reconciliation/tabby",
    family: "reconciliation",
    title: "Tabby payout reconciliation for Zoho Books",
    description:
      "Tabby settles net of its fee, so the deposit never equals the invoice. How RAMZA matches each Tabby payout to the bank credit and closes the invoices in Zoho Books.",
    crumb: "Tabby",
    h1: "Reconciling Tabby payouts",
    lead:
      "Tabby pays you in batches, net of its fee, days after the customer checked out. Nothing about that deposit looks like the invoice it settles. This is how RAMZA ties the two together without anyone opening a spreadsheet.",
    sections: [
      {
        kind: "prose",
        heading: "Why the Tabby deposit never matches the invoice",
        body: [
          "A Tabby order is approved at checkout, but the money reaches you later and in company: one bank credit covers many orders. Tabby deducts its fee before sending, so the amount that lands is smaller than the sum of the invoices it settles, and smaller by an amount nobody wrote down in your books.",
          "That leaves a bookkeeper with two problems at once. The invoices are still sitting open in Zoho because no payment equals their total. And there is a credit in the bank that reconciles to nothing, because the deduction was never recorded as an expense.",
          "Most teams solve it by exporting the Tabby settlement report each month and matching by hand in a spreadsheet. That works until a refund from last month lands inside this month's payout, at which point the spreadsheet is wrong and nobody notices for a quarter.",
        ],
      },
      {
        kind: "steps",
        heading: "How RAMZA reconciles it",
        intro: "Four steps, none of which need a person once the stores are connected.",
        steps: [
          {
            title: "Read the payout, order by order",
            body: "The Tabby settlement file is broken back down into the individual orders it covers, so each invoice is accounted for rather than the batch as a whole.",
          },
          {
            title: "Match the batch to one bank credit",
            body: "The net payout is tied to the credit that actually landed in your account, by amount and date. If the bank shows something different, the payout is flagged rather than force-matched.",
          },
          {
            title: "Split the fee out as an expense",
            body: "The difference between gross orders and net deposit is posted to bank charges, with the VAT on that fee recorded as input VAT rather than swallowed into the expense.",
          },
          {
            title: "Close the invoices in Zoho",
            body: "Each invoice is paid at its full total and flips to Paid. The books show the invoice at what the customer owed, the fee as a cost, and the bank at what arrived.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "caution",
        heading: "Refunds reopen a month you already closed",
        body:
          "A refund processed after a payout has settled comes out of a later payout. That later batch then reconciles to less than its orders, and the earlier month is quietly wrong. RAMZA carries the adjustment back to the payout it belongs to and reports it, instead of absorbing it into whichever month it happened to land in.",
      },
    ],
    faq: [
      {
        q: "Do I need to give RAMZA access to my Tabby account?",
        a: "No. You can upload the settlement files or forward the payout emails. A direct connection is optional, not required.",
      },
      {
        q: "What happens to a payout the bank has not credited yet?",
        a: "It stays as in transit and is not posted. It is visible on screen as outstanding, so the gap between Tabby's report and your bank balance is explained rather than missing.",
      },
      {
        q: "Does this work if we also sell through Tamara and COD?",
        a: "Yes. Tabby, Tamara, Telr, Stripe, Checkout.com and cash on delivery are reconciled against the same bank account and closed into the same Zoho Books file.",
      },
    ],
    related: ["reconciliation/tamara", "reconciliation/telr", "vs/spreadsheets"],
    updated: UPDATED,
  },

  {
    path: "reconciliation/tamara",
    family: "reconciliation",
    title: "Tamara payout reconciliation for Zoho Books",
    description:
      "Tamara settles in batches net of fees across UAE and KSA. How RAMZA matches each payout to the bank, handles the SAR leg, and closes invoices in Zoho Books.",
    crumb: "Tamara",
    h1: "Reconciling Tamara payouts",
    lead:
      "Tamara batches many orders into one deposit and takes its fee on the way through. If you sell into Saudi as well as the UAE, that deposit may also have crossed a currency before it reached you.",
    sections: [
      {
        kind: "prose",
        heading: "Two deductions, not one",
        body: [
          "Every Tamara payout carries the same gap a Tabby payout does: the fee comes off before the money moves, so the credit in the bank is smaller than the invoices behind it, and the difference has to land somewhere in the books.",
          "Selling into Saudi adds a second gap on top. A payout denominated in SAR arrives in an AED account at whatever rate the bank applied on the day, which is not the rate in your accounting system's FX table. The two differ by a small amount on every single payout, and that amount is why the account will not tie out to the riyal.",
          "Treated as one number, those two gaps are indistinguishable, and a bookkeeper chasing a variance cannot tell whether they are looking at a fee, an FX difference, or a genuine short payment.",
        ],
      },
      {
        kind: "steps",
        heading: "How RAMZA reconciles it",
        steps: [
          {
            title: "Separate the fee from the FX",
            body: "The gateway fee is posted as an expense with its VAT recorded. The currency difference is posted as an FX gain or loss. They are two different facts about the payout and the books show them that way.",
          },
          {
            title: "Use the rate the bank actually used",
            body: "The conversion is taken from the rate applied to the wire itself, not a static monthly table, so the AED figure in the books equals the AED figure on the statement.",
          },
          {
            title: "Match to the credit, then close",
            body: "Once fee and FX are accounted for, the remainder equals the bank credit. The invoices behind the batch are paid at full total in Zoho Books.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "note",
        heading: "The variance that is worth keeping",
        body:
          "When a payout still does not tie out after fee and FX are accounted for, that is a real discrepancy and it stays flagged. A reconciliation tool that closes everything is not a reconciliation tool, it is a tool for hiding the one payout you needed to ask about.",
      },
    ],
    faq: [
      {
        q: "We invoice in AED but get paid in SAR. Does that work?",
        a: "Yes. That is the case this handles specifically: the invoice stays in its own currency and the FX difference on the payout is posted separately rather than distorting the invoice total.",
      },
      {
        q: "Can we see which orders are inside one payout?",
        a: "Yes. Every payout opens to the orders it settles, so a variance can be traced to the order that caused it.",
      },
    ],
    related: ["reconciliation/tabby", "reconciliation/telr", "markets/ksa"],
    updated: UPDATED,
  },

  {
    path: "reconciliation/telr",
    family: "reconciliation",
    title: "Telr payout reconciliation and FX, for Zoho Books",
    description:
      "Telr settles across AED, SAR and KWD. How RAMZA matches Telr payouts to the bank using the rate the wire actually used, and posts fees and VAT to Zoho Books.",
    crumb: "Telr",
    h1: "Reconciling Telr payouts",
    lead:
      "Telr is where multi-currency stops being a footnote. A payout raised in SAR or KWD and credited to an AED account will not equal anything in your books unless the rate on the wire is the rate you post at.",
    sections: [
      {
        kind: "prose",
        heading: "The static FX table is the problem",
        body: [
          "Accounting systems hold a monthly rate per currency pair. Banks do not. The wire that credited your account used the rate available at that moment, plus whatever margin applied, and it recorded that rate in the transfer narration rather than anywhere convenient.",
          "Post the payout at the table rate and every payout lands a little wrong. Individually the amounts are small enough to ignore. Across a month of Telr settlements they add up to a balance that will not reconcile and a month-end that ends in someone typing a manual journal to make it close.",
          "That manual journal is the actual cost. It is not the minutes, it is that the books now contain a plug figure nobody can explain in six months.",
        ],
      },
      {
        kind: "steps",
        heading: "How RAMZA reconciles it",
        steps: [
          {
            title: "Take the rate from the wire",
            body: "The rate is read from the bank's own record of the transfer, so the converted figure equals the credit on the statement by construction rather than by luck.",
          },
          {
            title: "Post the difference as FX, not as a plug",
            body: "The gap between the payout's own currency and what arrived is booked as an FX gain or loss against the right account, with the payout it belongs to attached.",
          },
          {
            title: "Keep the fee and its VAT separate",
            body: "The Telr fee is an expense with recoverable VAT on it. Folding it into the FX difference loses the input VAT, so the two are posted apart.",
          },
        ],
      },
      {
        kind: "checklist",
        heading: "What this does and does not cover",
        items: [
          { title: "AED, SAR and KWD settlements", body: "Matched against an AED bank account at the rate the wire used.", state: "yes" },
          { title: "Gateway fee and VAT on the fee", body: "Posted as bank charges and input VAT respectively.", state: "yes" },
          { title: "Partial captures and refunds", body: "Carried back to the payout they belong to rather than the month they landed in.", state: "yes" },
          { title: "Setting your Telr pricing", body: "RAMZA reads what you were charged. It does not negotiate or predict your rate.", state: "no" },
        ],
      },
    ],
    faq: [
      {
        q: "Where does the exchange rate come from?",
        a: "From the bank's record of the incoming transfer, which is what makes the posted figure match the statement exactly. A static table in the accounting system will not.",
      },
      {
        q: "What if the narration does not carry a rate?",
        a: "The payout is flagged for review rather than posted at an assumed rate. Guessing is how an unexplainable balance gets created.",
      },
    ],
    related: ["reconciliation/tamara", "markets/ksa", "guides/gateway-settlement-reports"],
    updated: UPDATED,
  },

  {
    path: "reconciliation/stripe",
    family: "reconciliation",
    title: "Stripe payout reconciliation for Zoho Books",
    description:
      "Stripe pays out net of fees on a rolling schedule. How RAMZA matches each Stripe payout to the bank credit and posts fees and VAT into Zoho Books.",
    crumb: "Stripe",
    h1: "Reconciling Stripe payouts",
    lead:
      "Stripe's own dashboard reconciles Stripe. It does not reconcile your bank, and it does not know about the Tabby payout that landed the same morning.",
    sections: [
      {
        kind: "prose",
        heading: "The gap Stripe's dashboard leaves",
        body: [
          "Stripe reports accurately on Stripe: every charge, every fee, every payout, down to the cent. The trouble starts one step later, because your books do not contain a Stripe balance. They contain a bank account, and that bank account also receives Tabby, Tamara, Telr and courier remittances.",
          "So the question a bookkeeper actually has is not what Stripe paid, it is which credit on the statement was Stripe and which invoices it settled. That answer lives across two systems and a bank statement, which is why it usually ends up in a spreadsheet.",
        ],
      },
      {
        kind: "steps",
        heading: "How RAMZA reconciles it",
        steps: [
          {
            title: "Tie each payout to its bank credit",
            body: "Stripe payouts are matched against the statement alongside every other gateway, so one view answers what landed and what it settled.",
          },
            {
            title: "Post fees with VAT treated correctly",
            body: "Processing fees go to bank charges and the VAT on them to input VAT, rather than netting the fee off the revenue and losing both.",
          },
          {
            title: "Close the invoices at full value",
            body: "Invoices are paid at their total in Zoho Books. Revenue is what the customer was billed, not what survived the gateway.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Stripe already gives me a payout report. Why do I need this?",
        a: "Because the report stops at Stripe. It cannot tell you which line on your bank statement it corresponds to, and it cannot close the invoice in Zoho Books.",
      },
      {
        q: "Does it handle disputes and chargebacks?",
        a: "They are carried back to the payout they affect and surfaced, rather than left to silently reduce a later batch.",
      },
    ],
    related: ["reconciliation/tabby", "vs/synder", "vs/a2x"],
    updated: UPDATED,
  },

  {
    path: "reconciliation/cod",
    family: "reconciliation",
    title: "Cash on delivery reconciliation for UAE and KSA stores",
    description:
      "COD remittances arrive from the courier, net of shipping and COD fees, weeks after delivery. How RAMZA matches courier remittances to the bank and closes invoices in Zoho Books.",
    crumb: "Cash on delivery",
    h1: "Reconciling cash on delivery",
    lead:
      "COD is the hardest line to reconcile in the Gulf and the one most often left until the year-end audit. The courier collects, holds, deducts and remits, and only the last of those four events reaches your bank.",
    sections: [
      {
        kind: "prose",
        heading: "Four events, one bank credit",
        body: [
          "A COD order is delivered on one date, collected in cash on that date, held by the courier for a remittance cycle, and paid to you net of the shipping charge and a COD handling fee. By the time the money arrives, the order is weeks old and the amount bears no relationship to the invoice.",
          "Undelivered orders make it worse. A returned parcel never turns into cash, but the order still exists in the store and the invoice is still open, so the books carry revenue that is never going to be collected until someone goes looking.",
          "This is why COD tends to be reconciled annually rather than monthly. It is also why COD is where the money actually goes missing.",
        ],
      },
      {
        kind: "steps",
        heading: "How RAMZA reconciles it",
        steps: [
          {
            title: "Match the remittance to its deliveries",
            body: "Each courier remittance is broken back to the delivered orders it covers, so a credit weeks after the sale still finds the right invoices.",
          },
          {
            title: "Separate shipping from the COD fee",
            body: "The two deductions are different expenses with different VAT treatment and are posted separately rather than as one lump.",
          },
          {
            title: "Surface what was never collected",
            body: "Orders that were returned or never delivered are reported as uncollected instead of sitting as open invoices that quietly overstate revenue.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "caution",
        heading: "The number worth checking first",
        body:
          "If your COD has not been reconciled monthly, the gap between delivered orders and cash actually remitted is usually the largest single unexplained figure in the business. It is the first thing a payout audit looks at.",
      },
    ],
    faq: [
      {
        q: "Which couriers does this cover?",
        a: "Any courier that issues a remittance statement. The statement is what gets reconciled, so the approach does not depend on a particular integration.",
      },
      {
        q: "What about partial deliveries?",
        a: "They are matched at the order level, so a partially delivered order reconciles to what was actually collected rather than what was invoiced.",
      },
    ],
    related: ["reconciliation/tabby", "markets/uae", "guides/cod-reconciliation"],
    updated: UPDATED,
  },
];
