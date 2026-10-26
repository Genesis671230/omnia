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
  /* worked example for agent-desk-one-payout: sales − fee − VAT on fee − refund = payout (balances) */
  const EX = { sales: "10,000.00", fee: "330.00", vat: "16.50", refund: "241.13", payout: "9,412.37", orders: 12,
    saySales: "ten thousand", sayPayout: "nine thousand, four hundred and twelve", gap: "587" };
  return [
    /* ── Reels v2 (agency playbook, 2026-10-25). Fact-locked rewrites: no figures outside rules.json /
       facts.json, e-invoicing scoped to B2B/B2G, RAMZA never "makes you compliant". ── */
    /* Real estate (2026-10-26): property managers, off-plan sellers, developers/contractors. Insight: one
       bank balance hides three kinds of money (yours / held for others / earned, not collected). Opens and
       loops on a full-colour search bar: buyers, investors and banks search the company before they pay.
       Worked example, balances: 1,910,000 + 2,940,000 = 4,850,000; held = escrow 2,610,000 + deposits
       330,000; to collect = retention 740,000 + overdue instalments 520,000. */
    {
      id: "v2-real-estate",
      title: "Your buyers google you first",
      voice: "nPczCjzI2devNBz1zQrb", // Brian
      music: ["inspired-ambient-141686.mp3", 0.1],
      tail: 1.6,
      data: { bank: 4850000, yours: 1910000, held: 2940000, escrow: 2610000, deposits: 330000, collect: 1260000, retention: 740000, overdue: 520000 },
      segments: [
        { say: `Before anyone pays you a single dirham, they *google* you.` },
        { say: `Buyers. Investors. Your bank. Even your *partners.*` },
        { say: `But the real answer isn't on Google. It's in your *books.*` },
        { dark: true, say: `In real estate, one bank balance hides three kinds of *money.*` },
        { say: `Money that's *yours.* Money you're only *holding.* And money you've earned, but not yet *collected.*` },
        { dark: true, say: `Manage properties? Rent cheques and deposits land in one account, and owners ask where their money *went.*` },
        { dark: true, say: `Sell off-plan? Instalments sit in *escrow.* A unit sold isn't cash you can *spend.*` },
        { dark: true, say: `Build? Retention, progress bills and variations hide your real *margin,* until the project *ends.*` },
        { dark: true, say: `Mix them up, and the numbers you show people stop *adding up.*` },
        { dark: true, say: `*RAMZA* is an AI agent that starts at the *bank.*` },
        { say: `Every line, matched to the *cheque,* the *instalment,* or the *invoice* behind it. Then booked where it *belongs.*` },
        { say: `Nothing posts to Zoho until you *approve.*` },
        { say: `So when someone asks how the business is doing, you open one *page.* Per project. Per property. To the *fils.*` },
        { say: `We'll set it up on your own bank statement, *free.* Comment *CLEAN.*` },
      ],
      disclaimer: `Worked example, illustrative figures. RAMZA reconciles and books; it is not an auditor, a tax agent or an escrow agent. Nothing posts to Zoho without your approval. AI voiceover.`,
      caption: `Before anyone pays you a dirham, they google you. Buyers, investors, your bank, your partners.

The real answer is in your books. And in real estate, one bank balance hides three kinds of money:
1. Money that's yours
2. Money you're only holding (escrow, security deposits, owners' rent)
3. Money you've earned but not collected (retention, overdue instalments)

Property managers: rent cheques and deposits land in one account.
Off-plan: a unit sold isn't cash you can spend.
Developers and contractors: retention and variations hide the real margin until handover.

RAMZA is an AI agent that starts at the bank: every line matched to the cheque, instalment or invoice behind it, booked where it belongs, and posted to Zoho only when you approve. One clean page per project and per property.

Comment CLEAN. We set it up on your own bank statement for free, and you pay only once it's closing your month.

Worked example, illustrative figures. AI voiceover.

#DubaiRealEstate #UAERealEstate #OffPlan #PropertyManagement #Developers #Bookkeeping`,
    },
    {
      id: "v2-heist",
      title: "The 587 heist",
      voice: "nPczCjzI2devNBz1zQrb", // Brian
      music: ["inspired-ambient-141686.mp3", 0.1],
      data: EX,
      segments: [
        { dark: true, say: `{*AED 587.*|Five hundred and eighty-seven dirhams.} Gone from one payout. Nobody *noticed.*` },
        { dark: true, say: `No hacker. No thief. It disappeared in *plain sight.*` },
        { dark: true, say: `Suspect one. The gateway *fee.*` },
        { dark: true, say: `Suspect two. VAT on that *fee.*` },
        { dark: true, say: `Suspect three. A refund nobody *logged.*` },
        { dark: true, say: `Add them up.`, hold: 0.5 },
        { say: `{*587.63.*|Five eighty-seven, sixty-three.} Case *closed.*` },
        { dark: true, say: `Tabby, Tamara and Stripe all pay out *net,* after fees and refunds. So the bank never matches the store.` },
        { say: `*RAMZA* is an AI agent that investigates every payout, line by line, before anything posts to Zoho.` },
        { dark: true, say: `Want a case file on your store? Comment *CASE.*` },
      ],
      disclaimer: `Worked example, illustrative figures. Nothing posts to Zoho without your approval. AI voiceover.`,
      caption: `Case file: AED 587. Gone from one payout. No hacker, no thief.

Suspect 1: the gateway fee (330.00)
Suspect 2: VAT on that fee (16.50)
Suspect 3: a refund nobody logged (241.13)
Total: 587.63. Case closed.

Tabby, Tamara and Stripe pay out net, after fees and refunds, so the bank never matches the store's sales report. RAMZA is an AI agent that investigates every payout line by line, and posts to Zoho only when you approve.

Comment CASE and we'll open a case file on your store: one month, free.

Worked example, illustrative figures. AI voiceover.

#DubaiBusiness #UAEEcommerce #Tabby #Tamara #Bookkeeping #MonthEndClose`,
    },
    {
      id: "v2-green-light",
      title: "The green light",
      voice: "nPczCjzI2devNBz1zQrb",
      music: ["inspired-ambient-141686.mp3", 0.14],
      tail: 1.4,
      data: { close_month: F.close_month, close_credits: F.close_credits, close_matched_pct: F.close_matched_pct },
      segments: [
        { dark: true, say: `The most satisfying thing a business owner can *watch.*` },
        { dark: true, say: `{*${n(F.close_credits)}*|${upper(words(F.close_credits))}} bank credits.`, hold: 6 },
        { dark: true, say: `${F.close_month.split(" ")[0]}. {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched by the agent.` },
        { say: `The rest wait for *one click* from you.` },
        { dark: true, say: `Want this every month? Comment *GREEN.*` },
      ],
      disclaimer: `A Dubai e-commerce brand RAMZA was built inside, ${F.close_month}, live RAMZA app ${F.as_of}. Rows recreated for privacy. AI voiceover.`,
      caption: `${n(F.close_credits)} bank credits turning green, one by one.

One Dubai e-commerce brand, ${F.close_month}: ${F.close_matched_pct}% of bank credits matched to their payouts by the RAMZA agent. The rest wait for one click from the owner. Nothing posts to Zoho without approval.

Comment GREEN and we'll run it on one month of yours. Free setup, pay once it closes your month.

AI voiceover. Rows recreated for privacy.

#OddlySatisfying #DubaiBusiness #UAEEcommerce #Bookkeeping #AIAgent`,
    },
    {
      id: "v2-radar",
      title: "The radar",
      voice: "nPczCjzI2devNBz1zQrb",
      music: ["inspired-ambient-141686.mp3", 0.1],
      data: { asp_late: P.asp_late_aed_per_month, large_go: E.large.go_live, sme_go: E.sme.go_live, large_rev: E.large.revenue_gte_aed },
      segments: [
        { dark: true, say: `*Flash.*` },
        { dark: true, say: `You didn't even feel it. But the fine is *already* issued.` },
        { dark: true, say: `Now imagine that, for every *invoice* a business sends.` },
        { dark: true, say: `Because that's what the UAE is *building.*` },
        { dark: true, say: `E-invoicing. Every B2B invoice goes through an accredited provider, and on to the tax authority. In *real time.*` },
        { dark: true, say: `No provider appointed by the deadline? {*${aed(P.asp_late_aed_per_month)}.*|${sayAED(P.asp_late_aed_per_month)}.} Every *month.*` },
        { dark: true, say: `Over {${aedM(E.large.revenue_gte_aed).replace(/m$/, "M")}|${words(E.large.revenue_gte_aed / 1e6)} million dirhams} in revenue, live {*${showDate(E.large.go_live).replace(/^1 /, "")}.*|in ${sayDate(E.large.go_live).replace(/^the first of /i, "")}, ${sayYear(E.large.go_live)}.} Everyone else in scope, {*${showDate(E.sme.go_live).replace(/^1 /, "")}.*|${sayDate(E.sme.go_live).replace(/^the first of /i, "")}, ${sayYear(E.sme.go_live)}.}` },
        { say: `So here's the move. Get the books *clean* now. RAMZA reconciles every payout, and checks your e-invoicing *readiness.*` },
        { dark: true, say: `Drive clean. Comment *READY,* and we'll check where you stand. Free.` },
      ],
      disclaimer: `E-invoicing applies to B2B and B2G invoices in scope; dates and penalties per the UAE e-invoicing rules, checked ${E.verified_on}. RAMZA is not an accredited service provider: it reconciles your books and checks readiness. AI voiceover.`,
      caption: `The radar is being installed.

UAE e-invoicing: every B2B invoice goes through an accredited provider and on to the tax authority.
• Revenue ${aedM(E.large.revenue_gte_aed)}+: appoint a provider by ${showDate(E.large.asp_by)}, live ${showDate(E.large.go_live)}
• Everyone else in scope: appoint by ${showDate(E.sme.asp_by)}, live ${showDate(E.sme.go_live)}
• No provider appointed in time: ${aed(P.asp_late_aed_per_month)} per month

Clean books first. RAMZA reconciles every payout and checks your e-invoicing readiness. Comment READY and we'll check where you stand, free.

RAMZA is not an accredited service provider. AI voiceover.

#UAEeInvoicing #DubaiBusiness #UAEVAT #SME #Ecommerce`,
    },
    {
      id: "v2-taxi-meter",
      title: "The taxi meter",
      voice: "nPczCjzI2devNBz1zQrb",
      music: ["inspired-ambient-141686.mp3", 0.1],
      data: { lines: F.bank_lines_not_in_zoho, lines_aed: F.bank_lines_not_in_zoho_aed, close_month: F.close_month, close_credits: F.close_credits, close_matched_pct: F.close_matched_pct },
      segments: [
        { dark: true, say: `This meter *never* stops.` },
        { dark: true, say: `Every payout that doesn't match the bank adds to the *fare.*` },
        { dark: true, say: `It's called month-end. Payouts matched to the bank, by *hand,* line by line.` },
        { dark: true, say: `One Dubai brand had {*${F.bank_lines_not_in_zoho}*|${words(F.bank_lines_not_in_zoho)}} bank lines not yet in the books. {*${aedM(F.bank_lines_not_in_zoho_aed).replace(/m$/, "M")}.*|${(F.bank_lines_not_in_zoho_aed / 1e6).toFixed(2).replace(/0$/, "").split(".").map((x, k) => (k ? x.split("").map((d) => words(+d)).join(" ") : words(+x))).join(" point ")} million dirhams.}` },
        { dark: true, say: `Then an AI agent switched the meter *off.*`, hold: 0.4 },
        { say: `${F.close_month.split(" ")[0]}: {${n(F.close_credits)}|${words(F.close_credits)}} bank credits, {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched by the agent. Nothing posts without *approval.*` },
        { dark: true, say: `How many lines are waiting in your bank? Comment *METER.*` },
      ],
      disclaimer: `A Dubai e-commerce brand RAMZA was built inside, live RAMZA app ${F.as_of}. Bank lines not yet booked, not money lost. AI voiceover.`,
      caption: `Month-end by hand is a meter that never stops.

One Dubai brand had ${F.bank_lines_not_in_zoho} bank lines (${aedM(F.bank_lines_not_in_zoho_aed)}) not yet in its books. Then the RAMZA agent took over: ${F.close_month}, ${n(F.close_credits)} bank credits, ${F.close_matched_pct}% matched by the agent, and nothing posted to Zoho without approval.

Comment METER and we'll count the lines waiting in yours. Free setup, pay once it closes your month.

AI voiceover.

#DubaiBusiness #UAEEcommerce #MonthEndClose #Bookkeeping #AIAgent`,
    },
    {
      id: "v2-two-shops",
      title: "Two shops, same street",
      voice: "nPczCjzI2devNBz1zQrb",
      music: ["motivational-day-112790.mp3", 0.09],
      segments: [
        { dark: true, say: `Two shops. Same street. Same sales. One of them is about to pull *ahead.*` },
        { dark: true, say: `Shop A closes the month by *hand.* Shop B has an *AI agent.*` },
        { dark: true, say: `Day one. Shop A starts matching payouts. Shop B already knows last month's *profit.*` },
        { dark: true, say: `Day three. Shop A finds a mistake, and starts *again.* Shop B launches a new *collection.*` },
        { dark: true, say: `Day ten. Shop A still hasn't closed. Shop B puts its ad money behind what *sells.*` },
        { dark: true, say: `Same street. Same sales. A different *future.*` },
        { say: `AI isn't coming for your business. Your *competitor* using AI is.` },
        { dark: true, say: `Which shop are you? Comment *A* or *B.*` },
      ],
      disclaimer: `Illustrative story. AI voiceover.`,
      caption: `Two shops. Same street. Same sales.

Shop A closes the month by hand: matching payouts on day 1, starting again on day 3, still open on day 10.
Shop B has an AI agent: it knows last month's profit on day 1 and puts its ad money behind what sells.

AI isn't coming for your business. Your competitor using AI is.

Which shop are you? Comment A or B.

Illustrative story. AI voiceover.

#DubaiBusiness #UAEEcommerce #AIAgent #SmallBusiness #Founders`,
    },
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
      id: "agent-office-month-end",
      title: "Five people, one spreadsheet. Or one agent.",
      music: ["the-upbeat-inspiring-corporate-142313.mp3", 0.08],
      segments: [
        { say: `Month end. *Four* accountants. One *auditor.* And every *payout,* checked by hand, one by one.` },
        { say: `Open the email. Download the *file.* Find the order. Find the *invoice.* Tick. *Next.*` },
        { say: `Then the auditor checks it all *again.* Day one becomes day *six.* Five salaries, on one *spreadsheet.*` },
        { dark: true, say: `Now hand it to the *agent.* RAMZA opens *Gmail,* finds every payout email, and reads the *files* inside.` },
        { say: `It matches each payout to the *bank,* checks every *invoice,* books the fees and VAT, and flags only what needs a *human.*` },
        { dark: true, say: `{${F.close_month}|${F.close_month.split(" ")[0]}}, on our own company's books. {*${n(F.close_credits)}*|${words(F.close_credits)}} bank credits. {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched.` },
        { say: `Your team stops *ticking* rows, and starts *reviewing* what matters.` },
        { dark: true, say: `Give the agent {*${R.offer.free_trial.days} days.*|${words(R.offer.free_trial.days)} days.} Comment *AGENT,* and it closes last month for you, *free.*` },
      ],
      disclaimer: `Office scenes are a dramatization. Omnia is RAMZA's founding company and first user; figures from the live RAMZA app, ${F.as_of}. Screens are illustrations. AI voiceover.`,
      caption: `Month end: four accountants and an auditor, checking every payout by hand. Email, file, order, invoice, tick. Next.

RAMZA's agent opens Gmail, reads every payout file, matches each payout to the bank, checks the invoices, books fees and VAT, and flags only what needs a human. Your team reviews exceptions instead of ticking rows.

${F.close_month}, on our own books: ${n(F.close_credits)} bank credits, ${F.close_matched_pct}% matched.

${R.offer.free_trial.headline} Comment AGENT, or message us on WhatsApp.

Office scenes are a dramatization. Omnia is RAMZA's founding company and first user. Screens are illustrations. Voiceover is AI-generated.

#UAEBusiness #DubaiBusiness #Accounting #Ecommerce #Reconciliation #ZohoBooks #AIAgent`,
    },
    {
      id: "news-month-end-bleed",
      title: "This week's headlines, and where the money goes",
      music: ["inspired-ambient-141686.mp3", 0.1],
      segments: [
        { dark: true, say: `This week's headlines. *Gulf News:* the UAE's e-invoicing deadline *nears.*` },
        { dark: true, say: `Large UAE businesses must appoint a provider by {*${showDate(E.large.asp_by)}.*|${sayDate(E.large.asp_by)}.} Late, {*${aed(P.asp_late_aed_per_month)}*|${sayAED(P.asp_late_aed_per_month)}} a month.` },
        { dark: true, say: `And *CFO* dot com: *half* of finance teams still take over a *week* to close the books.` },
        { dark: true, say: `{*20 to 50 hours*|Twenty to fifty hours} a month, just on *reconciliation.*` },
        { dark: true, say: `For an online store, here's where that week *goes.*` },
        { dark: true, say: `Payouts land *net* of fees. Cash on delivery comes in *short.* Refunds hide *inside* the payout.` },
        { dark: true, say: `So invoices stay *open,* and someone matches it all by *hand.*` },
        { dark: true, say: `RAMZA's agent does the match. It reads every payout file, matches the *bank,* books fees and VAT, and closes the *invoices.*` },
        { dark: true, say: `For e-invoicing, it *maps* where your invoices are made, and connects an *accredited* provider.` },
        { dark: true, say: `On our own books, it found {*${n(F.bank_lines_not_in_zoho)}*|${words(F.bank_lines_not_in_zoho)}} bank lines, {*${aedM(F.bank_lines_not_in_zoho_aed)},*|${(F.bank_lines_not_in_zoho_aed / 1e6).toFixed(2).replace(/^(\d+)\.(\d)(\d)$/, (_, a, x, y) => `${words(+a)} point ${words(+x)} ${words(+y)}`)} million dirhams,} not yet in Zoho.` },
        { dark: true, say: `Give the agent {*${R.offer.free_trial.days} days.*|${words(R.offer.free_trial.days)} days.} Comment *AGENT,* and it closes last month for you, *free.*` },
      ],
      disclaimer: `Headlines: Gulf News (updated 30 Sep 2026), Economy Middle East (22 Oct 2026), CFO.com (23 Apr 2025, Ledge survey), shown for commentary. Omnia is RAMZA's founding company and first user; figures from the live RAMZA app, ${F.as_of}. RAMZA is not an accredited e-invoicing service provider. Stock photos; screens are illustrations. AI voiceover.`,
      caption: `This week's headlines: the UAE e-invoicing deadline nears, and half of finance teams still take over a week to close the books.

UAE businesses with ${aedM(E.large.revenue_gte_aed)}+ revenue must appoint an accredited e-invoicing provider by ${showDate(E.large.asp_by)}. Late: ${aed(P.asp_late_aed_per_month)} per month or part of a month.

For an online store, the close week goes on payouts that land net of fees, COD that comes in short, refunds hidden inside payouts, and invoices that stay open until someone matches them by hand.

RAMZA's agent reads every payout file, matches the bank, books fees and VAT, and closes the invoices. For e-invoicing it maps where your invoices are made and connects an accredited provider.

On our own books, it found ${n(F.bank_lines_not_in_zoho)} bank lines worth ${aedM(F.bank_lines_not_in_zoho_aed)} not yet in Zoho.

${R.offer.free_trial.headline} Comment AGENT, or message us on WhatsApp.

Sources: Gulf News, Economy Middle East, CFO.com (Ledge survey). Omnia is RAMZA's founding company and first user. RAMZA is not an accredited e-invoicing service provider. Stock photos; screens are illustrations. Voiceover is AI-generated.

#UAEBusiness #DubaiBusiness #EInvoicing #Ecommerce #Accounting #Reconciliation #AIAgent`,
    },
    {
      id: "agent-building-one-payout",
      title: "One payout. Five people. Six days.",
      music: ["motivational-day-112790.mp3", 0.09],
      segments: [
        { say: `One payout. *Five* people. *Six* days. Watch it travel through a company at *month* end.` },
        { say: `It lands in the *inbox.* Someone downloads the file, and *prints* it.` },
        { say: `Down to *finance.* Four accountants check the *order,* the *fee,* the *VAT,* and the *invoice.* By hand.` },
        { say: `Then the *auditor* checks it all *again,* and sends it back *up.*` },
        { say: `And the owner waits for one answer. Did the *money* arrive?` },
        { say: `Now, the *agent.* RAMZA reads the payout files in *Gmail,* matches each one to the *bank,* and checks every *invoice.*` },
        { say: `Your team reviews only what it *flags.* And the owner sees the *answer,* on one screen.` },
        { dark: true, say: `{${F.close_month}|${F.close_month.split(" ")[0]}}, on our own company's books. {*${n(F.close_credits)}*|${words(F.close_credits)}} bank credits. {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched.` },
        { dark: true, say: `Give the agent {*${R.offer.free_trial.days} days.*|${words(R.offer.free_trial.days)} days.} Comment *AGENT,* and it closes last month for you, *free.*` },
      ],
      disclaimer: `The company and its people are a dramatization. Omnia is RAMZA's founding company and first user; figures from the live RAMZA app, ${F.as_of}. Screens are illustrations. AI voiceover.`,
      caption: `One payout. Five people. Six days.

At month end, a single payout email gets printed, checked by four accountants (order, fee, VAT, invoice), re-checked by the auditor, and sent back up. The owner waits for one answer: did the money arrive?

RAMZA's agent reads the payout files in Gmail, matches each one to the bank, and checks every invoice. Your team reviews only what it flags.

${F.close_month}, on our own books: ${n(F.close_credits)} bank credits, ${F.close_matched_pct}% matched.

${R.offer.free_trial.headline} Comment AGENT, or message us on WhatsApp.

The company shown is a dramatization. Omnia is RAMZA's founding company and first user. Screens are illustrations. Voiceover is AI-generated.

#UAEBusiness #DubaiBusiness #Accounting #Ecommerce #Reconciliation #Finance #AIAgent`,
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
    {
      /* launch film (Skale-style grammar, ramza-director/direction.md "Launch-film grammar"): no caption
         bar, the words are the picture; one accent (agent blue); own page, not RL. */
      id: "launch-film",
      title: "Meet RAMZA",
      voice: "nPczCjzI2devNBz1zQrb", // Brian
      music: ["the-upbeat-inspiring-corporate-142313.mp3", 0.12],
      data: { ...EX, close_month: F.close_month, close_credits: F.close_credits, close_matched_pct: F.close_matched_pct },
      segments: [
        { say: `You're selling *more* than ever.` },
        { dark: true, say: `Orders. Refunds. Payouts. Every single day.` },
        { say: `But your books are still kept like it's {*1920.*|nineteen twenty.}` },
        { dark: true, say: `By hand. Line by line. Gateway by gateway.` },
        { say: `The store sold {*${EX.sales.replace(".00", "")}.*|${EX.saySales}.} The bank got {*${EX.payout.split(".")[0]}.*|${EX.sayPayout}.} Where did {*${EX.gap}*|${words(+EX.gap)}} go?` },
        { dark: true, say: `Meet *RAMZA.*` },
        { say: `An AI agent that closes your month, starting from the *bank.*` },
        { say: `The fee. VAT on the fee. One refund. {${EX.orders}|${upper(words(EX.orders))}} orders. Every dirham, *found.*` },
        { dark: true, say: `One Dubai brand. ${F.close_month.split(" ")[0]}. {*${n(F.close_credits)}*|${words(F.close_credits)}} bank credits. {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched by the agent.` },
        { say: `And nothing posts to Zoho, until *you* approve.` },
        { dark: true, say: `You sell. *RAMZA* closes the books. Free setup. Pay once it closes your month.` },
      ],
      disclaimer: `Worked example, illustrative figures. Proof: a Dubai e-commerce brand RAMZA was built inside, live RAMZA app, ${F.as_of}. Nothing posts to Zoho without your approval. AI voiceover.`,
      caption: `Your store runs on AI. Your books still run like it's 1920.

Meet RAMZA, an AI agent that closes your month starting from the bank:
1. Reads every bank line
2. Matches it to the gateway payout, to the fils
3. Books the fee, the VAT on the fee and the refunds
4. Marks every order's invoice paid
5. Posts to Zoho only when you approve

One Dubai brand, ${F.close_month}: ${n(F.close_credits)} bank credits, ${F.close_matched_pct}% matched by the agent.

Free setup on your own transactions. Pay only once it closes your month. Comment CLOSE.

Worked example, illustrative figures. AI voiceover.

#UAEBusiness #DubaiBusiness #Ecommerce #Bookkeeping #AIAccounting #MonthEndClose`,
    },
    {
      id: "agent-desk-one-payout",
      title: "Watch an AI agent close one payout",
      music: ["motivational-day-112790.mp3", 0.09],
      segments: [
        { say: `{*${EX.gap}*|${upper(words(+EX.gap))}} dirhams vanished from *one* payout. Watch an *AI* agent find every fils.` },
        { say: `The gateway kept its *fee,* plus *VAT* on the fee. One *refund* went back to a customer. What's left is the *payout.*` },
        { say: `By hand, that's every *report,* every *order,* typed into the *books.* For every *gateway.*` },
        { say: `The agent starts at the *bank.* It reads the line, and finds the payout file that *matches* it, to the fils.` },
        { say: `It splits the payout into {*${EX.orders}*|${words(EX.orders)}} orders, and marks each *invoice* paid.` },
        { say: `Then it writes the *journal.* Bank. Fee. *VAT* on the fee. The refund. Debits equal *credits.*` },
        { say: `Nothing posts until you *approve.* One tap, and it's in *Zoho.*` },
        { dark: true, say: `One Dubai brand, ${F.close_month.split(" ")[0]}. {*${n(F.close_credits)}*|${words(F.close_credits)}} bank credits. {*${F.close_matched_pct}%*|${words(F.close_matched_pct)} percent} matched by the agent.` },
        { dark: true, say: `Free setup on your own transactions. Pay only once it closes your month. Comment *CLOSE.*` },
      ],
      disclaimer: `Worked example, illustrative figures. Proof: a Dubai e-commerce brand RAMZA was built inside, live RAMZA app, ${F.as_of}. Nothing posts to Zoho without your approval. AI voiceover.`,
      caption: `The bank shows AED ${EX.payout}. The store sold AED ${EX.sales}. Where did the rest go?

The gateway kept its fee (${EX.fee}) plus VAT on the fee (${EX.vat}), and one refund (${EX.refund}) went back to a customer.

Here is what RAMZA's agent does with that payout:
1. Reads the bank line
2. Finds the payout file that matches it, to the fils
3. Splits it into ${EX.orders} orders and marks each invoice paid
4. Writes the journal: bank, fee, VAT on fee, refund. Debits equal credits
5. Waits for your approval, then posts to Zoho

${F.close_month}, one Dubai e-commerce brand: ${n(F.close_credits)} bank credits, ${F.close_matched_pct}% matched by the agent.

${R.offer.free_trial.free_setup.headline} Comment CLOSE.

Worked example with illustrative figures. Voiceover is AI-generated.

#UAEBusiness #DubaiBusiness #Ecommerce #Accounting #Bookkeeping #Reconciliation #AIAgent`,
    },
  ];
}
