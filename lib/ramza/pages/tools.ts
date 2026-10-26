import { rules } from "../rules";
import type { RamzaPage } from "./types";

/* Free calculators, one URL each. "uae vat calculator" and "corporate tax
   calculator uae" are searched far more than anything RAMZA sells, and the
   pages that rank for them are thin forms. Each page here answers in the lead,
   renders the calculator, then explains the rule it applies, with every figure
   read from config/rules.json. */

const UPDATED = "2026-10-26";

const CT = rules.ct;
const VAT = rules.vat;
const E = rules.einvoicing;
const SBR = CT.small_business_relief;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const aed = (n: number) => `AED ${n.toLocaleString("en-US")}`;
const aedM = (n: number) => `AED ${+(n / 1e6).toFixed(2)} million`;
const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
const ctOn = (p: number) => Math.max(0, p - CT.rate.zero_rate_up_to_aed) * CT.rate.rate_above;

export const TOOL_PAGES: RamzaPage[] = [
  {
    path: "tools/vat-calculator-uae",
    family: "tool",
    tool: "vatcalc",
    title: `UAE VAT calculator: add or remove ${pct(VAT.standard_rate)} VAT (free)`,
    description: `Free UAE VAT calculator. Add ${pct(VAT.standard_rate)} VAT to a net price or remove it from a VAT-inclusive total, split to the fils, with the formula and the zero-rated and exempt exceptions.`,
    crumb: "VAT calculator",
    h1: `UAE VAT calculator: add or remove ${pct(VAT.standard_rate)}`,
    lead: `UAE VAT is ${pct(VAT.standard_rate)} on most goods and services. To add it, multiply the net price by ${1 + VAT.standard_rate}. To remove it from a VAT-inclusive total, divide by ${1 + VAT.standard_rate}: the difference is the VAT. Type an amount below and the split appears to the fils.`,
    sections: [
      {
        kind: "table",
        heading: "The two formulas",
        columns: ["You have", "You want", "Formula", `Example (${aed(1000)} / ${aed(1000 * (1 + VAT.standard_rate))})`],
        rows: [
          ["Net price", "Price with VAT", `net × ${1 + VAT.standard_rate}`, `${aed(1000)} → ${aed(1000 * (1 + VAT.standard_rate))}`],
          ["Net price", "VAT amount", `net × ${VAT.standard_rate}`, `${aed(1000)} → ${aed(1000 * VAT.standard_rate)}`],
          ["Price with VAT", "Net price", `total ÷ ${1 + VAT.standard_rate}`, `${aed(1000 * (1 + VAT.standard_rate))} → ${aed(1000)}`],
          ["Price with VAT", "VAT amount", `total − (total ÷ ${1 + VAT.standard_rate})`, `${aed(1000 * (1 + VAT.standard_rate))} → ${aed(1000 * VAT.standard_rate)}`],
        ],
        footnote: "A common mistake is taking 5% of the VAT-inclusive total. That overstates the VAT: on AED 1,050 it gives AED 52.50 instead of AED 50.",
      },
      {
        kind: "prose",
        heading: "When 5% does not apply",
        body: [
          "Zero-rated supplies carry VAT at 0%, and you can still recover the VAT you paid on costs. The main ones are most exports of goods and services outside the GCC, international transport, the first supply of a new residential building, some education and healthcare services, and investment-grade precious metals.",
          "Exempt supplies carry no VAT, and the VAT on related costs is generally not recoverable. The main ones are bare land, local passenger transport, residential rent after the first supply, and some financial services.",
          "If a sale might fall into either group, check it with your accountant before invoicing. The calculator assumes the standard rate.",
        ],
      },
      {
        kind: "callout",
        tone: "note",
        heading: "Where the VAT goes wrong in e-commerce",
        body: "Payment gateways such as Tabby, Tamara, Telr and Stripe charge 5% VAT on their own fee, and the payout that reaches your bank is net of both. That VAT on the fee is input VAT you can usually recover, but only if each fee is booked separately. RAMZA books it from the payout file.",
      },
    ],
    faq: [
      { q: "What is the VAT rate in the UAE?", a: `The standard rate is ${pct(VAT.standard_rate)}, under Federal Decree-Law No. 8 of 2017. Some supplies are zero-rated (0%) or exempt.` },
      { q: "How do I remove VAT from a price in the UAE?", a: `Divide the VAT-inclusive price by ${1 + VAT.standard_rate} to get the net price. The VAT is the total minus the net. On ${aed(1050)}, the net is ${aed(1000)} and the VAT is ${aed(50)}.` },
      { q: "Do I need to register for VAT?", a: `Registration is mandatory once taxable supplies and imports exceed ${aed(VAT.registration.mandatory_over_aed)} in the past 12 months (or are expected to in the next 30 days), and voluntary above ${aed(VAT.registration.voluntary_over_aed)}. Use the VAT registration check to see where you stand.` },
    ],
    related: ["tools/vat-registration-check", "guides/uae-vat-registration-threshold", "tools/corporate-tax-calculator-uae", "zoho/zoho-books-uae-features"],
    citations: [
      { claim: `UAE standard VAT rate of ${pct(VAT.standard_rate)}`, source: "UAE Federal Tax Authority, VAT", url: "https://tax.gov.ae/en/taxes/Vat.aspx", checked: "2026-10-26" },
    ],
    updated: UPDATED,
  },

  {
    path: "tools/vat-registration-check",
    family: "tool",
    tool: "vat",
    title: `UAE VAT registration check: ${aed(VAT.registration.mandatory_over_aed)} threshold calculator`,
    description: `Do you have to register for UAE VAT? Enter your last 12 months of taxable sales: mandatory above ${aed(VAT.registration.mandatory_over_aed)}, voluntary above ${aed(VAT.registration.voluntary_over_aed)}, and what registering late costs.`,
    crumb: "VAT registration check",
    h1: "Do I need to register for VAT in the UAE?",
    lead: `You must register for UAE VAT when your taxable supplies and imports pass ${aed(VAT.registration.mandatory_over_aed)} in the past 12 months, or are expected to in the next 30 days. You may register voluntarily from ${aed(VAT.registration.voluntary_over_aed)}. Registering late carries a ${aed(VAT.penalties.late_registration_aed)} penalty.`,
    sections: [
      {
        kind: "steps",
        heading: "How to read the threshold",
        steps: [
          { title: "Use a rolling 12 months", body: "The test is any 12-month window ending at the end of a month, not the calendar or financial year. Re-check it every month while you are close to the line." },
          { title: "Count taxable supplies", body: "Standard-rated and zero-rated sales count, and so do imports. Exempt supplies do not." },
          { title: "Apply within 30 days", body: "Once you pass the mandatory threshold, the application is due within 30 days. The penalty is triggered by applying late, even if the VAT itself would have been small." },
        ],
      },
    ],
    faq: [
      { q: "Is the threshold based on revenue or profit?", a: "On taxable supplies and imports, so it is closer to revenue. Profit does not matter for VAT registration." },
      { q: "What is the penalty for late VAT registration?", a: `${aed(VAT.penalties.late_registration_aed)}, under the administrative penalties as amended by Cabinet Decision No. 129 of 2025.` },
    ],
    related: ["tools/vat-calculator-uae", "guides/uae-vat-registration-threshold", "tools/corporate-tax-calculator-uae"],
    citations: [
      { claim: "VAT registration thresholds", source: "UAE Federal Tax Authority, VAT registration", url: VAT.registration.source, checked: VAT.registration.verified_on },
    ],
    updated: UPDATED,
  },

  {
    path: "tools/corporate-tax-calculator-uae",
    family: "tool",
    tool: "relief",
    title: `UAE Corporate Tax calculator: ${pct(CT.rate.rate_above)} above ${aed(CT.rate.zero_rate_up_to_aed)} and Small Business Relief`,
    description: `Free UAE Corporate Tax calculator. 0% on the first ${aed(CT.rate.zero_rate_up_to_aed)} of taxable profit, ${pct(CT.rate.rate_above)} above it, and whether Small Business Relief (revenue up to ${aedM(SBR.revenue_lte_aed)}) means you pay nothing.`,
    crumb: "Corporate Tax calculator",
    h1: "UAE Corporate Tax calculator",
    lead: `UAE Corporate Tax is 0% on the first ${aed(CT.rate.zero_rate_up_to_aed)} of taxable profit and ${pct(CT.rate.rate_above)} on everything above it. If your revenue is ${aedM(SBR.revenue_lte_aed)} or less, Small Business Relief can bring the tax to zero for periods ending by ${day(SBR.periods_end_on_or_before)}. You still register and file either way.`,
    sections: [
      {
        kind: "table",
        heading: "Worked examples",
        columns: ["Taxable profit", "Taxed at 0%", `Taxed at ${pct(CT.rate.rate_above)}`, "Corporate Tax"],
        rows: [300000, 500000, 1000000, 5000000].map((p) => [
          aed(p),
          aed(Math.min(p, CT.rate.zero_rate_up_to_aed)),
          aed(Math.max(0, p - CT.rate.zero_rate_up_to_aed)),
          aed(ctOn(p)),
        ]),
        footnote: "Assumes the company is not claiming Small Business Relief and is not a Qualifying Free Zone Person. Taxable profit is accounting profit after the adjustments in the law, not revenue.",
      },
      {
        kind: "callout",
        tone: "caution",
        heading: "The number is only as good as the books",
        body: "Taxable profit starts from your financial statements. If gateway fees, refunds or exchange differences are missing from the books, the profit, and the tax on it, are wrong. A clean month-end close comes before the tax calculation, not after it.",
      },
    ],
    faq: [
      { q: "What is the Corporate Tax rate in the UAE?", a: `0% on taxable income up to ${aed(CT.rate.zero_rate_up_to_aed)} and ${pct(CT.rate.rate_above)} above it, under Federal Decree-Law No. 47 of 2022.` },
      { q: "Who qualifies for Small Business Relief?", a: `Resident persons with revenue of ${aedM(SBR.revenue_lte_aed)} or less in the period and in each earlier period, for tax periods ending on or before ${day(SBR.periods_end_on_or_before)}. Qualifying Free Zone Persons and members of multinational groups cannot use it.` },
      { q: "Do I still file if I pay no Corporate Tax?", a: "Yes. Registration and an annual return are required even when the tax due is zero, and late-filing penalties still apply." },
    ],
    related: ["tools/corporate-tax-penalty-calculator", "guides/uae-corporate-tax-rate", "guides/small-business-relief-uae", "tools/vat-calculator-uae"],
    citations: [
      { claim: "Corporate Tax rates and the 0% band", source: "UAE Ministry of Finance, Corporate Tax", url: "https://mof.gov.ae/en/public-finance/tax/corporate-tax/", checked: "2026-10-26" },
    ],
    updated: UPDATED,
  },

  {
    path: "tools/corporate-tax-penalty-calculator",
    family: "tool",
    tool: "ct",
    title: "UAE Corporate Tax penalty calculator: late registration and late filing",
    description: `Estimate UAE Corporate Tax penalties from your incorporation date: your registration deadline, first return due date, the ${aed(CT.late_registration_aed)} late-registration penalty and monthly late-filing penalties.`,
    crumb: "CT penalty calculator",
    h1: "UAE Corporate Tax penalty calculator",
    lead: `Enter the date your company was incorporated and when its financial year ends. The calculator shows your registration deadline, when your first return is due (${CT.filing_months_after_period_end} months after the period ends), and an estimate of penalties so far: ${aed(CT.late_registration_aed)} for late registration, and ${aed(CT.late_filing_penalty.months_1_12_aed)} a month for a late return, rising to ${aed(CT.late_filing_penalty.month_13_plus_aed)} a month from month 13.`,
    sections: [
      {
        kind: "callout",
        tone: "note",
        heading: "This is an estimate",
        body: "It applies the published rules to the dates you enter. RAMZA cannot see your EmaraTax account, so an assessment the authority has already issued may differ. RAMZA is not a registered tax agent; returns are filed through a licensed partner.",
      },
    ],
    faq: [
      { q: "When is the first Corporate Tax return due?", a: `Within ${CT.filing_months_after_period_end} months of the end of the tax period. For a December year end, that is 30 September of the following year.` },
      { q: "What is the penalty for filing the Corporate Tax return late?", a: `${aed(CT.late_filing_penalty.months_1_12_aed)} for each month or part of a month for the first 12 months, then ${aed(CT.late_filing_penalty.month_13_plus_aed)} a month, under Cabinet Decision No. 75 of 2023.` },
    ],
    related: ["tools/corporate-tax-calculator-uae", "guides/uae-corporate-tax-rate", "tools/e-invoicing-deadline-check"],
    citations: [
      { claim: "Corporate Tax late-filing penalty schedule", source: CT.late_filing_penalty.legal_basis, url: CT.late_filing_penalty.source, checked: CT.late_filing_penalty.verified_on },
    ],
    updated: UPDATED,
  },

  {
    path: "tools/e-invoicing-deadline-check",
    family: "tool",
    tool: "einv",
    title: "UAE e-invoicing deadline checker: your phase, provider date and go-live",
    description: `Which UAE e-invoicing phase are you in? Enter your revenue: ${aedM(E.large.revenue_gte_aed)}+ appoint a provider by ${day(E.large.asp_by)}, everyone else in scope by ${day(E.sme.asp_by)}, with the penalty for missing it.`,
    crumb: "E-invoicing deadline check",
    h1: "UAE e-invoicing deadline checker",
    lead: `UAE e-invoicing covers B2B and B2G invoices. Businesses with revenue of ${aedM(E.large.revenue_gte_aed)} or more must appoint an accredited service provider by ${day(E.large.asp_by)} and go live on ${day(E.large.go_live)}. Everyone else in scope appoints one by ${day(E.sme.asp_by)} and goes live on ${day(E.sme.go_live)}. Enter your revenue to see your dates and days left.`,
    sections: [
      {
        kind: "steps",
        heading: "Four things to do before your date",
        steps: [
          { title: "Confirm you are in scope", body: "E-invoicing applies to B2B and B2G invoices. Sales to consumers are outside the first phases." },
          { title: "Clean the customer master data", body: "Every B2B customer needs a correct legal name, TRN and address. Missing TRNs are the most common reason an e-invoice is rejected." },
          { title: "Appoint an accredited service provider", body: "Invoices are exchanged through accredited providers. Check whether your accounting software already offers one; Zoho Books sells an e-invoicing add-on." },
          { title: "Clear the backlog", body: "Open invoices, unapplied payments and unreconciled payouts follow you into the new system. Close them first." },
        ],
      },
    ],
    faq: [
      { q: "Is RAMZA an accredited e-invoicing provider?", a: "No. RAMZA cleans and reconciles your books and checks your readiness; the invoices themselves go through an accredited service provider." },
      { q: "Does e-invoicing apply to online stores selling to consumers?", a: "The current phases cover B2B and B2G invoices. A store selling only to consumers should check its B2B sales, if any, before assuming it is out of scope." },
    ],
    related: ["guides/uae-e-invoicing-deadlines", "zoho/zoho-books-uae-features", "tools/vat-calculator-uae"],
    citations: [
      { claim: "E-invoicing phases and dates", source: "Deloitte Middle East, UAE e-invoicing timeline", url: E.source, checked: E.verified_on },
    ],
    updated: UPDATED,
  },
];
