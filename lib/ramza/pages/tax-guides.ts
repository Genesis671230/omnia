import { rules } from "../rules";
import type { RamzaPage } from "./types";

/* UAE tax and cash-flow explainers, written for the questions UAE founders
   actually search ("e-invoicing deadline", "small business relief 2029",
   "VAT registration threshold"). Each answers in the first paragraph — that is
   the passage search snippets and AI assistants quote — and every date,
   threshold and penalty is read from config/rules.json, so a regulatory change
   is a one-file edit there, never a hunt through prose. */

const UPDATED = "2026-10-18";

const E = rules.einvoicing;
const P = E.penalties;
const CT = rules.ct;
const SBR = CT.small_business_relief;
const VAT = rules.vat;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const aed = (n: number) => `AED ${n.toLocaleString("en-US")}`;
const aedM = (n: number) => `AED ${+(n / 1e6).toFixed(2)} million`;
const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
const year = (iso: string) => iso.slice(0, 4);

export const TAX_GUIDES: RamzaPage[] = [
  {
    path: "guides/uae-e-invoicing-deadlines",
    family: "guide",
    title: `UAE e-invoicing deadlines ${year(E.large.asp_by)}–${year(E.sme.go_live)}: dates and penalties`,
    description: `Revenue ${aedM(E.large.revenue_gte_aed)}+: appoint an e-invoicing provider by ${day(E.large.asp_by)}. Everyone else: by ${day(E.sme.asp_by)}. Dates, penalties, a 4-step plan.`,
    crumb: "E-invoicing deadlines",
    h1: "UAE e-invoicing deadlines, and what to do before yours",
    lead: `Businesses with annual revenue of ${aedM(E.large.revenue_gte_aed)} or more must appoint an accredited service provider by ${day(E.large.asp_by)} and issue e-invoices from ${day(E.large.go_live)}. Businesses below that line appoint a provider by ${day(E.sme.asp_by)} and go live on ${day(E.sme.go_live)}. Appointing late costs ${aed(P.asp_late_aed_per_month)} for every month or part of a month.`,
    sections: [
      {
        kind: "table",
        heading: "The four dates",
        columns: ["Date", "Who", "What"],
        rows: [
          [day(E.large.asp_by), `Revenue ${aedM(E.large.revenue_gte_aed)}+`, "Appoint an accredited service provider"],
          [day(E.large.go_live), `Revenue ${aedM(E.large.revenue_gte_aed)}+`, "E-invoicing becomes mandatory"],
          [day(E.sme.asp_by), `Revenue below ${aedM(E.large.revenue_gte_aed)}`, "Appoint an accredited service provider"],
          [day(E.sme.go_live), `Revenue below ${aedM(E.large.revenue_gte_aed)}`, "E-invoicing becomes mandatory"],
        ],
        footnote: `Scope: ${E.scope}.`,
      },
      {
        kind: "prose",
        heading: "What actually changes",
        body: [
          "Today most UAE invoices are a PDF attached to an email. Under the new system an invoice is a structured data file that travels from your provider to your customer's provider, with a copy reported to the tax authority. The PDF your customer sees can still exist, but it is no longer the invoice.",
          "That moves the hard part upstream. The data on the invoice has to be right when it is created: the customer's legal name and tax registration number, the tax treatment of each line, and a unique invoice number. A system that lets someone type a customer name freehand will produce invoices that fail validation.",
        ],
      },
      {
        kind: "table",
        heading: "The penalties",
        intro: `Set by ${P.legal_basis}.`,
        columns: ["Violation", "Penalty"],
        rows: [
          ["Accredited provider not appointed on time", `${aed(P.asp_late_aed_per_month)} per month or part of a month`],
          ["E-invoice not issued or not transmitted", `${aed(P.invoice_not_issued_aed)} per invoice, capped at ${aed(P.invoice_cap_aed_per_month)} a month`],
          ["E-credit note not issued", `${aed(P.credit_note_not_issued_aed)} per credit note, capped at ${aed(P.invoice_cap_aed_per_month)} a month`],
          ["System failure not reported in time", `${aed(P.system_failure_notice_aed_per_day)} per day`],
        ],
      },
      {
        kind: "steps",
        heading: "A four-step plan",
        steps: [
          { title: "List every place an invoice is created", body: "Accounting software, the online store, a point-of-sale system, a spreadsheet the sales team keeps. Each one has to feed the provider." },
          { title: "Clean the customer records", body: "Legal names and tax registration numbers for every business customer. This is the work that takes longest and the one most often left to the last week." },
          { title: "Appoint a provider before your deadline", body: "The penalty counts from the deadline itself, so a provider signed a week late costs a full month." },
          { title: "Send one real invoice end to end", body: "A test in a sandbox proves the connection. A real invoice to a real customer proves the data." },
        ],
      },
    ],
    faq: [
      { q: "Does e-invoicing apply to small businesses?", a: `Yes, if they issue invoices in scope. Businesses below ${aedM(E.large.revenue_gte_aed)} are in the second phase: provider by ${day(E.sme.asp_by)}, live on ${day(E.sme.go_live)}.` },
      { q: "Is a PDF invoice still valid?", a: "Not as the tax invoice once your phase is live. The invoice becomes the structured file sent through your accredited provider; a PDF can still be sent as a readable copy." },
      { q: "What happens if we appoint a provider late?", a: `A penalty of ${aed(P.asp_late_aed_per_month)} for each month or part of a month after the deadline, under ${P.legal_basis}.` },
    ],
    related: ["guides/uae-vat-registration-threshold", "guides/overdue-invoices", "guides/gateway-settlement-reports"],
    citations: [
      { claim: "Phase dates and provider deadlines", source: "Deloitte Middle East, UAE e-invoicing update", url: E.source, checked: E.verified_on },
      { claim: "E-invoicing penalties", source: P.legal_basis, url: P.source, checked: P.verified_on },
    ],
    updated: UPDATED,
  },

  {
    path: "guides/small-business-relief-uae",
    family: "guide",
    title: `UAE Small Business Relief extended to ${year(SBR.periods_end_on_or_before)}: who qualifies`,
    description: `Small Business Relief now covers tax periods ending on or before ${day(SBR.periods_end_on_or_before)} for revenue up to ${aedM(SBR.revenue_lte_aed)}. Who qualifies, who doesn't, and why the return is still due.`,
    crumb: "Small Business Relief",
    h1: `Small Business Relief, extended to ${year(SBR.periods_end_on_or_before)}`,
    lead: `A UAE resident business with revenue of ${aedM(SBR.revenue_lte_aed)} or less in a tax period can elect Small Business Relief and be treated as having no taxable income for that period. The relief now covers periods ending on or before ${day(SBR.periods_end_on_or_before)}. It is not an exemption from the system: the business must still register for corporate tax and file a return every year.`,
    sections: [
      {
        kind: "checklist",
        heading: "Who can use it",
        items: [
          { title: `Revenue at or under ${aedM(SBR.revenue_lte_aed)}`, body: "Measured for the tax period, and for every earlier period in which the relief is claimed.", state: "yes" },
          { title: "Resident businesses, including mainland companies and individuals in business", body: "The relief is elected in the corporate tax return for the period.", state: "yes" },
          { title: "Qualifying Free Zone Persons", body: "Excluded. Free zone businesses taking the 0% qualifying-income regime cannot also claim Small Business Relief.", state: "no" },
          { title: "Members of a multinational enterprise group", body: "Excluded, whatever the size of the UAE entity.", state: "no" },
        ],
      },
      {
        kind: "callout",
        tone: "caution",
        heading: "The mistake that costs money",
        body: `Treating relief as "nothing to do". The return is still due within ${CT.filing_months_after_period_end} months of the period end, and a late return costs ${aed(CT.late_filing_penalty.months_1_12_aed)} a month for the first twelve months even when the tax due is zero.`,
      },
      {
        kind: "prose",
        heading: "Why the books still matter",
        body: [
          "Revenue is the test, so revenue has to be right. A business that books gateway deposits as sales understates revenue by the fees; one that books invoices but never the refunds overstates it. Near the threshold, either mistake decides whether the relief applies.",
          "The relief also does not carry losses forward for the periods in which it is claimed, so a business that expects to grow past the threshold should think about which years to elect it.",
        ],
      },
    ],
    faq: [
      { q: "Do I need to register for corporate tax if I use Small Business Relief?", a: "Yes. Registration and an annual return are still required; the relief is claimed in the return." },
      { q: "Can a free zone company claim Small Business Relief?", a: "A free zone company that is a Qualifying Free Zone Person cannot. A free zone company that is not one may be able to, if it meets the revenue test." },
      { q: `When does Small Business Relief end?`, a: `It now applies to tax periods ending on or before ${day(SBR.periods_end_on_or_before)}, under ${SBR.legal_basis}.` },
    ],
    related: ["guides/uae-corporate-tax-rate", "guides/bookkeeping-habits", "guides/uae-vat-registration-threshold"],
    citations: [
      { claim: `Relief extended to periods ending on or before ${day(SBR.periods_end_on_or_before)}`, source: "UAE Ministry of Finance", url: SBR.source, checked: SBR.verified_on },
      { claim: "Exclusions for Qualifying Free Zone Persons and MNE group members", source: "FTA Small Business Relief guide", url: SBR.source_exclusions, checked: SBR.verified_on },
    ],
    updated: UPDATED,
  },

  {
    path: "guides/uae-vat-registration-threshold",
    family: "guide",
    title: `UAE VAT registration threshold: ${aed(VAT.registration.mandatory_over_aed)} explained`,
    description: `When a UAE business must register for VAT, when it may register voluntarily, and how the 12-month and 30-day tests work.`,
    crumb: "VAT registration threshold",
    h1: "When a UAE business must register for VAT",
    lead: `Registration is mandatory once taxable supplies and imports exceed ${aed(VAT.registration.mandatory_over_aed)} over the past twelve months, or are expected to exceed it in the next thirty days. Above ${aed(VAT.registration.voluntary_over_aed)}, a business may register voluntarily.`,
    sections: [
      {
        kind: "table",
        heading: "The two thresholds",
        columns: ["Taxable supplies + imports", "Status"],
        rows: [
          [`Over ${aed(VAT.registration.mandatory_over_aed)}`, "Must register"],
          [`Over ${aed(VAT.registration.voluntary_over_aed)}`, "May register voluntarily"],
          [`${aed(VAT.registration.voluntary_over_aed)} or less`, "Cannot register"],
        ],
        footnote: `Test: ${VAT.registration.basis}. Standard rate ${pct(VAT.standard_rate)}.`,
      },
      {
        kind: "prose",
        heading: "The test runs every month, not once a year",
        body: [
          "The twelve-month test is rolling. A business that crosses the threshold in its eighth month of trading has to register then, not at the year end. The thirty-day test catches the other case: a single large contract signed today that will take supplies over the line next month.",
          "That is why the registration question is really a bookkeeping question. If sales are recorded monthly, the threshold is a number you watch approach. If they are recorded at year end, it is a penalty you discover.",
        ],
      },
      {
        kind: "steps",
        heading: "Watching the threshold",
        steps: [
          { title: "Total taxable supplies each month", body: "Standard-rated and zero-rated supplies count; exempt supplies do not." },
          { title: "Keep a rolling twelve-month sum", body: "One line in a spreadsheet, updated when the month closes." },
          { title: "Flag large contracts as they're signed", body: "The thirty-day test is triggered by what you expect, not only what you've invoiced." },
        ],
      },
    ],
    faq: [
      { q: "Do zero-rated sales count towards the VAT threshold?", a: "Yes. Taxable supplies include zero-rated supplies; exempt supplies are excluded." },
      { q: "Should a small business register voluntarily?", a: "It can make sense when most customers are VAT-registered businesses or when there is significant input VAT to recover. It also brings filing obligations, so it is worth weighing both." },
    ],
    related: ["guides/uae-e-invoicing-deadlines", "guides/small-business-relief-uae", "guides/bookkeeping-habits"],
    citations: [
      { claim: "VAT registration thresholds and tests", source: "UAE Federal Tax Authority", url: VAT.registration.source, checked: VAT.registration.verified_on },
    ],
    updated: UPDATED,
  },

  {
    path: "guides/uae-corporate-tax-rate",
    family: "guide",
    title: `UAE corporate tax rate: 0% and ${pct(CT.rate.rate_above)} explained, with examples`,
    description: `How the UAE's two corporate tax bands work, a worked example, and why a business in the 0% band still files a return.`,
    crumb: "Corporate tax rate",
    h1: "The UAE corporate tax rate, worked through",
    lead: `UAE corporate tax is 0% on taxable income up to ${aed(CT.rate.zero_rate_up_to_aed)} and ${pct(CT.rate.rate_above)} on the part above it. A business with ${aed(CT.rate.zero_rate_up_to_aed + 100000)} of taxable income pays ${pct(CT.rate.rate_above)} on ${aed(100000)}: ${aed(100000 * CT.rate.rate_above)}.`,
    sections: [
      {
        kind: "table",
        heading: "Three worked examples",
        columns: ["Taxable income", "Taxed at 0%", `Taxed at ${pct(CT.rate.rate_above)}`, "Corporate tax"],
        rows: [CT.rate.zero_rate_up_to_aed - 75000, CT.rate.zero_rate_up_to_aed + 100000, 1000000].map((inc) => {
          const above = Math.max(0, inc - CT.rate.zero_rate_up_to_aed);
          return [aed(inc), aed(Math.min(inc, CT.rate.zero_rate_up_to_aed)), aed(above), aed(above * CT.rate.rate_above)];
        }),
      },
      {
        kind: "prose",
        heading: "Taxable income is not revenue",
        body: [
          "The bands apply to taxable income: accounting profit, adjusted for items the law treats differently, such as certain entertainment costs and non-deductible penalties. A business with high revenue and thin margins can sit entirely in the 0% band.",
          `A natural person running a business is only within corporate tax once turnover from that business exceeds ${aedM(CT.natural_person.turnover_gt_aed)} in a calendar year.`,
        ],
      },
      {
        kind: "callout",
        tone: "note",
        heading: "0% is still a return",
        body: `Every registered business files, whatever the tax. The return is due ${CT.filing_months_after_period_end} months after the end of the tax period, and a late one costs ${aed(CT.late_filing_penalty.months_1_12_aed)} a month for the first year.`,
      },
    ],
    faq: [
      { q: "Is the first AED 375,000 tax-free for every company?", a: `The 0% band applies to the first ${aed(CT.rate.zero_rate_up_to_aed)} of taxable income for resident businesses. Qualifying Free Zone Persons and large multinational groups follow different rules.` },
      { q: "When is the corporate tax return due?", a: `Within ${CT.filing_months_after_period_end} months of the end of the tax period, together with any tax payable.` },
    ],
    related: ["guides/small-business-relief-uae", "guides/overdue-invoices", "guides/uae-vat-registration-threshold"],
    citations: [
      { claim: "Natural person turnover threshold", source: CT.natural_person.legal_basis, url: CT.natural_person.source, checked: CT.natural_person.verified_on },
    ],
    updated: UPDATED,
  },

  {
    path: "guides/overdue-invoices",
    family: "guide",
    title: "How to keep on top of overdue invoices in a UAE business",
    description: "A simple weekly routine for knowing who owes you, chasing on day one, and matching every payment to its invoice the day it lands.",
    crumb: "Overdue invoices",
    h1: "Who owes you, in ten seconds",
    lead: "If answering \"who still owes us money?\" takes an afternoon of spreadsheets, the problem is not cash, it is the books. Three habits fix most of it: one overdue list, payments matched to invoices the day they arrive, and a reminder on the first day an invoice is late.",
    sections: [
      {
        kind: "steps",
        heading: "The weekly routine",
        steps: [
          { title: "Keep one overdue list", body: "Invoice number, customer, due date, days late, amount. One list, sorted by days late, that anyone in the business can open." },
          { title: "Match payments the day they land", body: "A payment sitting unmatched in the bank makes a paid invoice look overdue, and a reminder sent to a customer who has paid costs more goodwill than the late payment did." },
          { title: "Remind on day one", body: "A polite note the day after the due date is routine. The same note on day thirty is a dispute." },
          { title: "Escalate by age, not by amount", body: "Thirty days late is a phone call; sixty is a conversation about terms; ninety is a decision about whether to keep supplying." },
        ],
      },
      {
        kind: "prose",
        heading: "Why the bank and the spreadsheet disagree",
        body: [
          "For e-commerce and card businesses, the money that reaches the bank is rarely the invoice amount. Gateways pay out in batches, net of fees and VAT on the fees, sometimes days later and sometimes in another currency. Until each payout is broken back into the orders it pays for, the invoices behind it look unpaid.",
          "That is the gap a reconciliation closes: every bank line traced to the invoices it settles, with the fee booked as an expense instead of disappearing.",
        ],
      },
    ],
    faq: [
      { q: "Can we charge interest on late payments in the UAE?", a: "Only if the contract or terms of sale provide for it. Put it in the terms before the work, not in the reminder after." },
      { q: "How often should receivables be reviewed?", a: "Weekly for the overdue list, monthly for the full ageing report at month-end close." },
    ],
    related: ["guides/gateway-settlement-reports", "guides/bookkeeping-habits", "guides/uae-e-invoicing-deadlines"],
    updated: UPDATED,
  },

  {
    path: "guides/bookkeeping-habits",
    family: "guide",
    title: "Five bookkeeping habits for UAE small businesses",
    description: "The habits that stop your accountant hunting for receipts: same-day receipts, a business-only account, invoice references, gateway fees, and a monthly close.",
    crumb: "Bookkeeping habits",
    h1: "Five habits that end the hunt for missing receipts",
    lead: "Most of an accountant's time on a small business goes on finding things, not on accounting. Five habits remove most of that: photograph receipts the day you pay, keep a business-only bank account, put the invoice number in every transfer, record gateway payouts with their fees, and close each month in the first week of the next.",
    sections: [
      {
        kind: "compare",
        heading: "Instead of, do this",
        rows: [
          { dimension: "Receipts", ramza: "Photo in a shared folder the same day", other: "Kept in a drawer until quarter end", verdict: "ramza" },
          { dimension: "Bank account", ramza: "One account used only for the business", other: "One card for home and business", verdict: "ramza" },
          { dimension: "Transfer reference", ramza: "The invoice number", other: "\"Payment\"", verdict: "ramza" },
          { dimension: "Gateway payouts", ramza: "Sale, fee and VAT on the fee booked separately", other: "Deposit booked as the sale", verdict: "ramza" },
          { dimension: "Month end", ramza: "Reconciled in the first week of the next month", other: "Caught up once a year", verdict: "ramza" },
        ],
        footnote: "The left column is the habit; the right is what it replaces.",
      },
      {
        kind: "callout",
        tone: "note",
        heading: "Why it matters at tax time",
        body: `Corporate tax and VAT returns are built from the books. Small Business Relief depends on revenue staying at or under ${aedM(SBR.revenue_lte_aed)}, and VAT registration on supplies passing ${aed(VAT.registration.mandatory_over_aed)}; both are numbers you can only watch if the books are current.`,
      },
    ],
    faq: [
      { q: "How long should a UAE business keep its records?", a: "Keep them for the full statutory retention period and ask your accountant for the period that applies to your business; tax records are commonly required for several years after the period ends." },
      { q: "Is a spreadsheet enough for bookkeeping?", a: "For a very small business at the start, it can be. Once there are card or gateway payments, bank feeds and reconciliation save more time than they cost." },
    ],
    related: ["guides/overdue-invoices", "guides/small-business-relief-uae", "guides/cod-reconciliation"],
    updated: UPDATED,
  },
];
