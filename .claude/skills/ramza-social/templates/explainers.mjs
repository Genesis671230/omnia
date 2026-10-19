/* Animated explainer reels (9:16, AI voiceover, word-synced captions). Every number and
 * date comes from config/rules.json (R) or facts.json (F). Each segment is one scene of
 * explainers/<id>.html, in order.
 *   say: narration. `{shown|spoken}` puts `shown` on screen while the voice reads
 *        `spoken` (numbers and dates in words); `*x*` marks a caption keyword (accent).
 *   dark: caption colours for a navy scene.
 * build-explainer.mjs voices each segment (ElevenLabs, with timestamps) and hands the
 * page window.TIMING = { segs:[{start,end,tokens:[{w,t0,t1,hl}]}], dur }. */
import { words, sayDate, showDate, sayAED, aed, aedM } from "./reels.mjs";

const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const daysTo = (iso) => Math.round((Date.parse(iso) - Date.parse(dubaiToday())) / 864e5);
const sayYear = (iso) => { const y = +iso.slice(0, 4); return `${words(Math.floor(y / 100))} ${words(y % 100)}`; };
const sayFull = (iso) => `${sayDate(iso)}, ${sayYear(iso)}`;
const sayPct = (x) => `${words(Math.round(x * 100))} percent`;
const pct = (x) => Math.round(x * 100) + "%";
const n = (x) => Number(x).toLocaleString("en-US");
const upper = (s) => s[0].toUpperCase() + s.slice(1);

export function explainers(R, F) {
  const E = R.einvoicing, P = E.penalties, CT = R.ct, lf = CT.late_filing_penalty;
  const left = daysTo(E.large.asp_by);
  const ctDue = CT.deadlines[0];
  const rescue = R.pricing.one_off.late_filing_rescue_aed;
  const SBR = CT.small_business_relief;
  return [
    {
      id: "einvoicing-days-left",
      title: `${left} days to appoint your e-invoicing provider`,
      music: ["motivational-day-112790.mp3", 0.1],
      segments: [
        { dark: true, say: `{*${left} days.*|${upper(words(left))} days.} That's what's left for UAE businesses with {${aedM(E.large.revenue_gte_aed)}|${words(E.large.revenue_gte_aed / 1e6)} million dirhams} or more in revenue, to appoint an *e-invoicing* provider.` },
        { say: `The appointment is due {*${showDate(E.large.asp_by)}.*|${sayFull(E.large.asp_by)}.} E-invoicing goes *live* on {*${showDate(E.large.go_live)}.*|${sayFull(E.large.go_live)}.}` },
        { dark: true, say: `Miss the appointment, and it's {*${aed(P.asp_late_aed_per_month)}*|${sayAED(P.asp_late_aed_per_month)}} for every month, or part of a month.` },
        { say: `Then {*${aed(P.invoice_not_issued_aed)}*|${sayAED(P.invoice_not_issued_aed)}} for each e-invoice not issued, capped at {${aed(P.invoice_cap_aed_per_month)}|${sayAED(P.invoice_cap_aed_per_month)}} a month.` },
        { say: `Below {${aedM(E.large.revenue_gte_aed)}?|${words(E.large.revenue_gte_aed / 1e6)} million?} Your dates are {*${showDate(E.sme.asp_by)}*|${sayFull(E.sme.asp_by)}} and {*${showDate(E.sme.go_live)}.*|${sayDate(E.sme.go_live)}.}` },
        { say: `Three steps. *Map* where your invoices are created. *Sign* an accredited provider. Send one real *test* invoice.` },
        { dark: true, say: `Comment *READY,* and we'll send you the free readiness checklist.` },
      ],
      disclaimer: `RAMZA is not an accredited service provider; e-invoices go through an accredited partner. Penalties: ${P.legal_basis}. AI voiceover.`,
      caption: `${left} days to appoint an e-invoicing provider (UAE businesses with revenue ${aedM(E.large.revenue_gte_aed)}+).

${showDate(E.large.asp_by)}: appoint an accredited service provider.
${showDate(E.large.go_live)}: e-invoicing goes live.
Late appointment: ${aed(P.asp_late_aed_per_month)} for every month or part of a month.
Below ${aedM(E.large.revenue_gte_aed)}: ${showDate(E.sme.asp_by)} and ${showDate(E.sme.go_live)}.

Comment READY for the free readiness checklist.

RAMZA is not an accredited service provider; e-invoices go through an accredited partner. Source: ${P.legal_basis}. Voiceover is AI-generated.

#UAEeInvoicing #eInvoicingUAE #UAEBusiness #DubaiBusiness #Compliance #Accounting`,
    },
    {
      id: "one-bank-line",
      title: "One bank line. Dozens of orders.",
      music: ["the-upbeat-inspiring-corporate-142313.mp3", 0.08],
      segments: [
        { say: `This is *one line* on a bank statement. Behind it can sit *dozens* of orders, refunds and fees.` },
        { say: `Stripe and Shopify Payments can land under the *same name.* The bank line won't tell you which *gateway* paid.` },
        { dark: true, say: `Refunds are *netted* inside the payout. *Fees* and VAT come off before the money lands. So the amount matches *no single order.*` },
        { say: `RAMZA starts from the *bank,* reads every *payout file,* and matches each credit to the payout with *exactly* that amount, to the fils.` },
        { dark: true, say: `{${F.close_month}|${F.close_month.split(" ")[0]}}, on our own company's books. {*${n(F.close_credits)}*|${words(F.close_credits)}} bank credits. {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched to payouts and orders.` },
        { dark: true, say: `Comment *RECON,* for a free month-end check.` },
      ],
      disclaimer: `Omnia is RAMZA's founding company and first user; figures from the live RAMZA app, ${F.as_of}. Bars are illustrative. AI voiceover.`,
      caption: `One bank line. Dozens of orders, refunds and fees behind it.

Stripe and Shopify Payments can land under the same bank name. Refunds are netted inside payouts, fees and VAT come off before the money lands, so the credit matches no single order.

RAMZA starts from the bank and matches each credit to the payout with exactly that amount.

${F.close_month}, our own books: ${n(F.close_credits)} bank credits, ${F.close_matched_pct}% matched.

Comment RECON for a free month-end check.

Omnia is RAMZA's founding company and first user. Voiceover is AI-generated.

#Ecommerce #Shopify #Stripe #UAEBusiness #Reconciliation #Accounting`,
    },
    {
      id: "ct-late-filing-meter",
      title: "The corporate tax meter",
      music: ["inspired-ambient-141686.mp3", 0.12],
      segments: [
        { dark: true, say: `For UAE businesses with a *December* {2025|${sayYear(CT.deadlines[0].fy_end)}} year end, the corporate tax return was due {*${showDate(ctDue.due)}.*|${sayFull(ctDue.due)}.}` },
        { dark: true, say: `Still unfiled? The late filing penalty is {*${aed(lf.months_1_12_aed)}*|${sayAED(lf.months_1_12_aed)}} for every month, or part of a month. {*${aed(lf.month_13_plus_aed)}*|${sayAED(lf.month_13_plus_aed)}} from month *thirteen.*` },
        { say: `Unpaid tax adds {*${pct(CT.late_payment.rate_pa)}*|${sayPct(CT.late_payment.rate_pa)}} a year, charged *monthly.*` },
        { say: `The fix is *books* first. Close the year, prepare the *statements,* then *file* and pay. The sooner, the fewer months on the meter.` },
        { dark: true, say: `RAMZA's late filer rescue does all three, for {*${aed(rescue)}*|${sayAED(rescue)}} one-off. Filed by our *licensed* partner.` },
        { dark: true, say: `Comment *RESCUE,* or message us on WhatsApp.` },
      ],
      disclaimer: `Estimates from ${lf.legal_basis}; the tax authority assesses the actual penalty. RAMZA is not a registered tax agent; returns are filed by ${R.partner.filing_partner}. AI voiceover.`,
      caption: `The corporate tax return for December ${CT.deadlines[0].fy_end.slice(0, 4)} year-ends was due ${showDate(ctDue.due)}.

Late filing: ${aed(lf.months_1_12_aed)} for every month or part of a month, ${aed(lf.month_13_plus_aed)} from month 13. Unpaid tax: ${pct(CT.late_payment.rate_pa)} a year, charged monthly.

RAMZA's late-filer rescue closes the books and our licensed partner files: ${aed(rescue)} one-off.

Comment RESCUE or WhatsApp us.

Penalties are estimates from ${lf.legal_basis}; the tax authority assesses the actual amount. RAMZA is not a registered tax agent; returns are filed by ${R.partner.filing_partner}. Voiceover is AI-generated.

#UAECorporateTax #CorporateTaxUAE #UAEBusiness #DubaiBusiness #SME`,
    },

    /* ---- 2026-10-20 "agent" reels: app hooks, top-down desk, unbranded portal views,
       the RAMZA agent logo as the character that takes the work over. body.safe layout. ---- */
    {
      id: "agent-ten-days",
      title: `${left} days: e-invoicing provider deadline`,
      music: ["motivational-day-112790.mp3", 0.1],
      segments: [
        { say: `{*${left} days.*|${upper(words(left))} days.} UAE businesses with {${aedM(E.large.revenue_gte_aed)}|${words(E.large.revenue_gte_aed / 1e6)} million dirhams} or more in revenue must appoint an *e-invoicing* provider by {*${showDate(E.large.asp_by)}.*|${sayDate(E.large.asp_by)}.}` },
        { say: `Miss it, and the penalty is {*${aed(P.asp_late_aed_per_month)}*|${sayAED(P.asp_late_aed_per_month)}} for every month, or *part* of a month.` },
        { say: `From go-live, it's {*${aed(P.invoice_not_issued_aed)}*|${sayAED(P.invoice_not_issued_aed)}} for each e-invoice not issued. Up to {${aed(P.invoice_cap_aed_per_month)}|${sayAED(P.invoice_cap_aed_per_month)}} a month.` },
        { dark: true, say: `So let the *agent* take it. RAMZA *maps* where your invoices are made, connects an *accredited* provider, and sends one real *test* invoice.` },
        { dark: true, say: `Comment *READY,* for the free readiness checklist.` },
      ],
      disclaimer: `RAMZA is not an accredited service provider; e-invoices go through an accredited partner. Penalties: ${P.legal_basis}. Screens are illustrations. Noor is RAMZA's AI presenter; AI voiceover.`,
      caption: `${left} days left to appoint an e-invoicing provider, for UAE businesses with revenue of ${aedM(E.large.revenue_gte_aed)} or more. Deadline: ${showDate(E.large.asp_by)}.

Late appointment: ${aed(P.asp_late_aed_per_month)} for every month or part of a month.
After go-live (${showDate(E.large.go_live)}): ${aed(P.invoice_not_issued_aed)} per e-invoice not issued, capped at ${aed(P.invoice_cap_aed_per_month)} a month.

Comment READY for the free readiness checklist.

RAMZA is not an accredited service provider; e-invoices go through an accredited partner. Source: ${P.legal_basis}. Screens are illustrations. Noor is RAMZA's AI presenter and the voiceover is AI-generated.

#UAEeInvoicing #eInvoicingUAE #UAEBusiness #DubaiBusiness #Compliance #Accounting`,
    },
    {
      id: "agent-inbox-month-end",
      title: "Five payout emails. One bank line.",
      music: ["the-upbeat-inspiring-corporate-142313.mp3", 0.08],
      segments: [
        { say: `Month end. *Five* payout emails. Tabby, Tamara, Stripe, Telr, cash on delivery. And one *bank* statement that matches none of them.` },
        { say: `So someone opens a *spreadsheet,* and starts matching by hand. Line by line. For *days.*` },
        { dark: true, say: `Or the *agent* takes over. RAMZA reads every *payout* file, and every *bank* line.` },
        { say: `It matches each credit to its payout, books the *fees* and VAT, and closes the invoices in *Zoho* Books.` },
        { dark: true, say: `{${F.close_month}|${F.close_month.split(" ")[0]}}, on our own company's books. {*${n(F.close_credits)}*|${words(F.close_credits)}} bank credits. {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched.` },
        { dark: true, say: `Comment *RECON,* for a free month-end check.` },
      ],
      disclaimer: `Omnia is RAMZA's founding company and first user; figures from the live RAMZA app, ${F.as_of}. Emails and screens are illustrations. AI voiceover.`,
      caption: `Month end: five payout emails, one bank statement that matches none of them.

RAMZA reads every payout file and every bank line, matches each credit to its payout, books fees and VAT, and closes the invoices in Zoho Books.

${F.close_month}, on our own books: ${n(F.close_credits)} bank credits, ${F.close_matched_pct}% matched.

Comment RECON for a free month-end check.

Omnia is RAMZA's founding company and first user. Emails and screens are illustrations. Voiceover is AI-generated.

#Ecommerce #Shopify #Tabby #Tamara #Stripe #UAEBusiness #Reconciliation #ZohoBooks`,
    },
    {
      id: "agent-ct-meter",
      title: "The return was due. The meter is running.",
      music: ["inspired-ambient-141686.mp3", 0.12],
      segments: [
        { say: `For UAE businesses with a *December* year end, the corporate tax return was due {*${showDate(ctDue.due)}.*|${sayFull(ctDue.due)}.}` },
        { say: `Unfiled, the penalty is {*${aed(lf.months_1_12_aed)}*|${sayAED(lf.months_1_12_aed)}} for every month, or part of a month. {*${aed(lf.month_13_plus_aed)}*|${sayAED(lf.month_13_plus_aed)}} from month *thirteen.*` },
        { say: `Unpaid tax adds {*${pct(CT.late_payment.rate_pa)}*|${sayPct(CT.late_payment.rate_pa)}} a year, charged *monthly.*` },
        { dark: true, say: `The *agent* takes it from here. RAMZA closes the *books,* prepares the *statements,* and our *licensed* partner files.` },
        { say: `Late filer rescue: {*${aed(rescue)}*|${sayAED(rescue)}} one-off. The offer runs until {*${showDate(R.campaign.rescue_mode_until)}.*|${sayDate(R.campaign.rescue_mode_until)}.}` },
        { dark: true, say: `Comment *RESCUE,* or message us on WhatsApp.` },
      ],
      disclaimer: `Estimates from ${lf.legal_basis}; the tax authority assesses the actual penalty. RAMZA is not a registered tax agent; returns are filed by ${R.partner.filing_partner}. Screens are illustrations. Noor is RAMZA's AI presenter; AI voiceover.`,
      caption: `The corporate tax return for December ${CT.deadlines[0].fy_end.slice(0, 4)} year-ends was due ${showDate(ctDue.due)}.

Late filing: ${aed(lf.months_1_12_aed)} for every month or part of a month, ${aed(lf.month_13_plus_aed)} from month 13. Unpaid tax: ${pct(CT.late_payment.rate_pa)} a year, charged monthly.

RAMZA closes the books and prepares the statements; our licensed partner files. Late-filer rescue: ${aed(rescue)} one-off, offer until ${showDate(R.campaign.rescue_mode_until)}.

Comment RESCUE or WhatsApp us.

Penalties are estimates from ${lf.legal_basis}; the tax authority assesses the actual amount. RAMZA is not a registered tax agent; returns are filed by ${R.partner.filing_partner}. Screens are illustrations. Noor is RAMZA's AI presenter and the voiceover is AI-generated.

#UAECorporateTax #CorporateTaxUAE #UAEBusiness #DubaiBusiness #SME`,
    },
    {
      id: "agent-per-invoice",
      title: "AED 100 per invoice",
      music: ["motivational-day-112790.mp3", 0.1],
      segments: [
        { say: `{*${aed(P.invoice_not_issued_aed)}.*|${upper(sayAED(P.invoice_not_issued_aed))}.} That's the penalty for each *e-invoice* not issued, once e-invoicing is live in the UAE.` },
        { say: `Because from go-live, the *PDF* is no longer the invoice. The invoice is a *data* file.` },
        { dark: true, say: `It travels from your *provider* to your customer's provider, and a copy is *reported* to the tax authority.` },
        { say: `Businesses with {${aedM(E.large.revenue_gte_aed)}|${words(E.large.revenue_gte_aed / 1e6)} million dirhams} or more go live {*${showDate(E.large.go_live)}.*|${sayFull(E.large.go_live)}.} Everyone else, {*${showDate(E.sme.go_live)}.*|${sayFull(E.sme.go_live)}.}` },
        { dark: true, say: `RAMZA's agent checks your invoices first. Missing tax *numbers.* Freehand customer *names.* Wrong VAT *treatment.* Fixed before they fail.` },
        { dark: true, say: `Comment *READY,* for the free readiness check.` },
      ],
      disclaimer: `RAMZA is not an accredited service provider; e-invoices go through an accredited partner. Penalties: ${P.legal_basis}. Screens are illustrations. AI voiceover.`,
      caption: `${aed(P.invoice_not_issued_aed)} for each e-invoice not issued, capped at ${aed(P.invoice_cap_aed_per_month)} a month, once UAE e-invoicing is live.

From go-live the PDF is no longer the invoice: the invoice is a structured data file sent through an accredited provider, with a copy reported to the tax authority.

Go-live: ${showDate(E.large.go_live)} (revenue ${aedM(E.large.revenue_gte_aed)}+), ${showDate(E.sme.go_live)} for everyone else.

Comment READY for the free readiness check.

RAMZA is not an accredited service provider; e-invoices go through an accredited partner. Source: ${P.legal_basis}. Screens are illustrations. Voiceover is AI-generated.

#UAEeInvoicing #eInvoicingUAE #UAEBusiness #VAT #Accounting`,
    },
    {
      id: "agent-sbr-2029",
      title: "Small Business Relief, extended to 2029",
      music: ["inspired-ambient-141686.mp3", 0.12],
      segments: [
        { say: `If your UAE business earns {*${aedM(SBR.revenue_lte_aed)}*|${words(SBR.revenue_lte_aed / 1e6)} million dirhams} or less a year, there's corporate tax *relief.* And it was just *extended.*` },
        { say: `Small Business Relief now covers tax periods ending on or before {*${showDate(SBR.periods_end_on_or_before)}.*|${sayFull(SBR.periods_end_on_or_before)}.}` },
        { dark: true, say: `It doesn't cover *qualifying* free zone persons, or members of a *multinational* group.` },
        { say: `And you still *register,* and you still *file* a return to claim it.` },
        { dark: true, say: `RAMZA's agent keeps your *books* closed every month, so your revenue figure is *ready* when the return is.` },
        { dark: true, say: `Comment *RELIEF,* and we'll check if you qualify.` },
      ],
      disclaimer: `General information from ${SBR.legal_basis}. RAMZA is not a registered tax agent; returns are filed by ${R.partner.filing_partner}. Screens are illustrations. Noor is RAMZA's AI presenter; AI voiceover.`,
      caption: `Small Business Relief now covers UAE tax periods ending on or before ${showDate(SBR.periods_end_on_or_before)}, for revenue of ${aedM(SBR.revenue_lte_aed)} or less.

Not covered: qualifying free zone persons and members of multinational groups.
You still register for corporate tax and file a return to claim it.

Comment RELIEF and we'll check if you qualify.

General information from ${SBR.legal_basis}. RAMZA is not a registered tax agent; returns are filed by ${R.partner.filing_partner}. Screens are illustrations. Noor is RAMZA's AI presenter and the voiceover is AI-generated.

#UAECorporateTax #SmallBusinessRelief #UAEBusiness #DubaiBusiness #SME`,
    },
  ];
}
