// RAMZA free tools — pure, deterministic, every number from config/rules.json.
//
//   checkCtFromIncorporation  incorporation date + year-end → registration
//                             deadline, first return due, penalties to date
//   checkCtRelief             Small Business Relief / natural-person threshold
//                             / 0% band — "relief", never called "exempt"
//   checkVat                  registration duty + late-registration exposure
//   checkEInvoicing           which phase, ASP appointment, go-live
//
// These are estimates from the public rules — RAMZA can't see anyone's
// EmaraTax account, and copy must say so.

import { rules, ctOn } from "./rules";
import { addMonths, lateFilingPenalty, monthsLate } from "./ct-penalty";

const R = rules as typeof rules & {
  ct: typeof rules.ct & {
    registration: { by_licence_month_due: Record<string, string>; no_licence_at_2024_03_01_due: string; decision_effective: string; months_after_incorporation: number };
    small_business_relief: { revenue_lte_aed: number; periods_start_on_or_after: string; periods_end_on_or_before: string };
    natural_person: { turnover_gt_aed: number };
  };
  vat: typeof rules.vat & {
    registration: { mandatory_over_aed: number; voluntary_over_aed: number };
    penalties: { late_registration_aed: number; late_filing_first_aed: number; late_filing_repeat_24m_aed: number; late_payment_rate_pa: number };
  };
};

export const TAX = {
  ctLateRegistrationAed: rules.ct.late_registration_aed,
  ctFilingMonths: rules.ct.filing_months_after_period_end,
  waiverMonths: rules.ct.late_registration_waiver.months_after_first_period_end,
  sbrRevenueAed: R.ct.small_business_relief.revenue_lte_aed,
  sbrUntil: R.ct.small_business_relief.periods_end_on_or_before,
  naturalPersonTurnoverAed: R.ct.natural_person.turnover_gt_aed,
  zeroBandAed: rules.ct.rate.zero_rate_up_to_aed,
  ctRate: rules.ct.rate.rate_above,
  vatMandatoryAed: R.vat.registration.mandatory_over_aed,
  vatVoluntaryAed: R.vat.registration.voluntary_over_aed,
  vatLateRegistrationAed: R.vat.penalties.late_registration_aed,
  vatLateFilingFirstAed: R.vat.penalties.late_filing_first_aed,
  vatLateFilingRepeatAed: R.vat.penalties.late_filing_repeat_24m_aed,
  vatLatePaymentPa: R.vat.penalties.late_payment_rate_pa,
  einvoicing: rules.einvoicing,
} as const;

export type Tone = "good" | "warn" | "bad" | "info";
export type ToolLine = { tone: Tone; title: string; detail: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const lastDay = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;

/* ── CT from incorporation ─────────────────────────────────────────────── */

/** Registration deadline for a resident juridical person (FTA Decision 3/2024). */
export function ctRegistrationDeadline(incorporated: string, licensed = true): string {
  const r = R.ct.registration;
  if (incorporated >= r.decision_effective) return addMonths(incorporated, r.months_after_incorporation);
  if (!licensed) return r.no_licence_at_2024_03_01_due;
  return r.by_licence_month_due[String(Number(incorporated.slice(5, 7)))];
}

/** End of the first financial year after incorporation, for a year ending on the
 *  last day of `fyEndMonth` (1–12). CT applies to periods starting on/after
 *  1 Jun 2023, so an older company's first CT period is the one starting then. */
export function firstTaxPeriodEnd(incorporated: string, fyEndMonth: number): string {
  const start = incorporated > "2023-06-01" ? incorporated : "2023-06-01";
  let y = Number(start.slice(0, 4));
  let end = `${y}-${String(fyEndMonth).padStart(2, "0")}-${lastDay(y, fyEndMonth)}`;
  if (end < start) { y += 1; end = `${y}-${String(fyEndMonth).padStart(2, "0")}-${lastDay(y, fyEndMonth)}`; }
  return end;
}

export type CtIncInput = {
  incorporated: string;
  fyEndMonth: number;
  licensed?: boolean;
  registeredOn?: string | null;
  firstReturnFiledOn?: string | null;
  today: string;
};

export type CtIncResult = {
  registrationDue: string;
  firstPeriodEnd: string;
  firstReturnDue: string;
  waiverBy: string;
  estimatedAed: number;
  lines: ToolLine[];
};

export function checkCtFromIncorporation(i: CtIncInput): CtIncResult | null {
  if (!DAY.test(i.incorporated) || i.fyEndMonth < 1 || i.fyEndMonth > 12 || i.incorporated > i.today) return null;
  const registrationDue = ctRegistrationDeadline(i.incorporated, i.licensed ?? true);
  const firstPeriodEnd = firstTaxPeriodEnd(i.incorporated, i.fyEndMonth);
  const firstReturnDue = addMonths(firstPeriodEnd, TAX.ctFilingMonths);
  const waiverBy = addMonths(firstPeriodEnd, TAX.waiverMonths);
  const lines: ToolLine[] = [];
  let estimated = 0;

  // Registration.
  const reg = i.registeredOn && DAY.test(i.registeredOn) ? i.registeredOn : null;
  const registeredLate = reg ? reg > registrationDue : i.today > registrationDue;
  if (!registeredLate) {
    lines.push(reg
      ? { tone: "good", title: "Registered on time", detail: `Your deadline was ${fmtDay(registrationDue)}.` }
      : { tone: "warn", title: `Register by ${fmtDay(registrationDue)}`, detail: `${daysBetween(i.today, registrationDue)} days left. Missing it costs ${aed(TAX.ctLateRegistrationAed)}.` });
  } else {
    // The waiver: first return filed within N months of the first period's end.
    const filed = i.firstReturnFiledOn && DAY.test(i.firstReturnFiledOn) ? i.firstReturnFiledOn : null;
    const waived = filed ? filed <= waiverBy : false;
    const waiverOpen = !filed && i.today <= waiverBy;
    if (!waived) estimated += TAX.ctLateRegistrationAed;
    lines.push({
      tone: waived ? "good" : "bad",
      title: `Registration deadline was ${fmtDay(registrationDue)} — ${reg ? `registered ${fmtDay(reg)}` : "not registered yet"}`,
      detail: waived
        ? `The ${aed(TAX.ctLateRegistrationAed)} late-registration penalty is waived: your first return was filed by ${fmtDay(waiverBy)}.`
        : waiverOpen
          ? `Penalty ${aed(TAX.ctLateRegistrationAed)} — but it can be waived if the first return is filed by ${fmtDay(waiverBy)} (${daysBetween(i.today, waiverBy)} days).`
          : `Penalty ${aed(TAX.ctLateRegistrationAed)}. The waiver window (first return within ${TAX.waiverMonths} months of the first period) ${filed ? "was missed" : `closed ${fmtDay(waiverBy)}`}.`,
    });
  }

  // First return.
  const filed = i.firstReturnFiledOn && DAY.test(i.firstReturnFiledOn) ? i.firstReturnFiledOn : null;
  const lateMonths = monthsLate(firstReturnDue, filed ?? i.today);
  if (lateMonths > 0) {
    const p = lateFilingPenalty(lateMonths);
    estimated += p;
    lines.push({ tone: "bad", title: `First return was due ${fmtDay(firstReturnDue)}`, detail: `${lateMonths} month${lateMonths === 1 ? "" : "s"} late${filed ? "" : " so far"} → about ${aed(p)} in late-filing penalties${filed ? "" : ", growing every month until it's filed"}.` });
  } else if (filed) {
    lines.push({ tone: "good", title: "First return filed on time", detail: `Due ${fmtDay(firstReturnDue)}.` });
  } else {
    lines.push({ tone: firstPeriodEnd < i.today ? "warn" : "info", title: `First return due ${fmtDay(firstReturnDue)}`, detail: `For the tax period ending ${fmtDay(firstPeriodEnd)}. ${daysBetween(i.today, firstReturnDue)} days left.` });
  }
  return { registrationDue, firstPeriodEnd, firstReturnDue, waiverBy, estimatedAed: estimated, lines };
}

/* ── CT relief check ───────────────────────────────────────────────────── */

export type CtReliefInput = {
  kind: "company" | "free_zone" | "individual";
  revenueAed: number;
  /** Tax period end (YYYY-MM-DD). */
  periodEnd: string;
  qualifyingFreeZone?: boolean;
  mneGroup?: boolean;
  taxableProfitAed?: number | null;
};

export type CtReliefResult = { verdict: "not_subject" | "sbr" | "taxable"; headline: string; lines: ToolLine[]; estimatedCtAed: number | null };

export function checkCtRelief(i: CtReliefInput): CtReliefResult {
  const lines: ToolLine[] = [];
  if (i.kind === "individual" && i.revenueAed <= TAX.naturalPersonTurnoverAed) {
    return {
      verdict: "not_subject", headline: "Not subject to Corporate Tax this year",
      estimatedCtAed: null,
      lines: [{ tone: "good", title: `Business turnover up to ${aed(TAX.naturalPersonTurnoverAed)}`, detail: `An individual's business is only in Corporate Tax once its turnover passes ${aed(TAX.naturalPersonTurnoverAed)} in a calendar year — no registration needed below it. Wages and personal investment or real-estate income never count.` }],
    };
  }
  const sbrPeriod = i.periodEnd <= TAX.sbrUntil;
  const blocked = i.qualifyingFreeZone ? "Qualifying Free Zone Persons can't use it" : i.mneGroup ? "members of a multinational group can't use it" : null;
  if (i.revenueAed <= TAX.sbrRevenueAed && sbrPeriod && !blocked) {
    lines.push({ tone: "good", title: "Small Business Relief fits", detail: `Revenue up to ${aed(TAX.sbrRevenueAed)} for periods ending by ${fmtDay(TAX.sbrUntil)}: elect it and you're treated as having no taxable income — so no Corporate Tax to pay.` });
    lines.push({ tone: "warn", title: "You still register and file", detail: "The relief is claimed in the return — registration, a yearly return and records are still required, and late-filing penalties still apply." });
    return { verdict: "sbr", headline: "No Corporate Tax to pay — with Small Business Relief", lines, estimatedCtAed: 0 };
  }
  if (i.revenueAed <= TAX.sbrRevenueAed && blocked) lines.push({ tone: "info", title: "Small Business Relief doesn't apply", detail: `Revenue is under ${aed(TAX.sbrRevenueAed)}, but ${blocked}.` });
  else if (i.revenueAed <= TAX.sbrRevenueAed && !sbrPeriod) lines.push({ tone: "info", title: "Outside the relief period", detail: `Small Business Relief covers periods ending by ${fmtDay(TAX.sbrUntil)}.` });
  else lines.push({ tone: "info", title: `Revenue above ${aed(TAX.sbrRevenueAed)}`, detail: "Small Business Relief needs revenue at or under the threshold." });
  if (i.kind === "free_zone") lines.push({ tone: "info", title: "Free zone: 0% may still apply", detail: "A Qualifying Free Zone Person pays 0% on qualifying income — it depends on substance, activities and audited accounts. We check this case by case." });
  const est = i.taxableProfitAed != null && i.taxableProfitAed >= 0 ? ctOn(i.taxableProfitAed) : null;
  lines.push({ tone: "warn", title: `${Math.round(TAX.ctRate * 100)}% above ${aed(TAX.zeroBandAed)} of taxable profit`, detail: est == null ? `0% on the first ${aed(TAX.zeroBandAed)} of taxable profit, ${Math.round(TAX.ctRate * 100)}% above it. Add your profit for an estimate.` : `On ${aed(i.taxableProfitAed!)} of taxable profit: about ${aed(est)} Corporate Tax.` });
  return { verdict: "taxable", headline: "Corporate Tax applies", lines, estimatedCtAed: est };
}

/* ── VAT ───────────────────────────────────────────────────────────────── */

export type VatInput = { suppliesLast12Aed: number; registered: boolean; crossedOn?: string | null; today: string };
export type VatResult = { verdict: "mandatory" | "voluntary" | "none"; lines: ToolLine[]; exposureAed: number };

export function checkVat(i: VatInput): VatResult {
  const lines: ToolLine[] = [];
  let exposure = 0;
  const verdict = i.suppliesLast12Aed > TAX.vatMandatoryAed ? "mandatory" : i.suppliesLast12Aed > TAX.vatVoluntaryAed ? "voluntary" : "none";
  if (verdict === "mandatory") {
    if (i.registered) lines.push({ tone: "good", title: "Registered — returns are what matter now", detail: `Late return: ${aed(TAX.vatLateFilingFirstAed)} the first time, ${aed(TAX.vatLateFilingRepeatAed)} if repeated within 24 months. Late payment: ${Math.round(TAX.vatLatePaymentPa * 100)}% a year on the unpaid tax.` });
    else {
      const due = i.crossedOn && DAY.test(i.crossedOn) ? addMonths(i.crossedOn, 0) : null;
      const deadline = due ? new Date(Date.parse(`${due}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10) : null;
      const late = deadline ? i.today > deadline : true;
      if (late) exposure += TAX.vatLateRegistrationAed;
      lines.push({ tone: late ? "bad" : "warn", title: `VAT registration is mandatory above ${aed(TAX.vatMandatoryAed)}`,
        detail: deadline
          ? late ? `Apply within 30 days of crossing it — that was ${fmtDay(deadline)}. Late registration: ${aed(TAX.vatLateRegistrationAed)}.` : `Apply by ${fmtDay(deadline)} (30 days after crossing). Missing it: ${aed(TAX.vatLateRegistrationAed)}.`
          : `Apply within 30 days of crossing the threshold. Late registration: ${aed(TAX.vatLateRegistrationAed)}.` });
    }
  } else if (verdict === "voluntary") {
    lines.push({ tone: "info", title: "You may register voluntarily", detail: `Between ${aed(TAX.vatVoluntaryAed)} and ${aed(TAX.vatMandatoryAed)}: optional — worth it if you buy a lot with VAT and want to reclaim it.` });
  } else {
    lines.push({ tone: "good", title: "No VAT registration needed yet", detail: `Under ${aed(TAX.vatVoluntaryAed)} of taxable supplies in 12 months. Watch the next 30 days too — expected supplies count.` });
  }
  return { verdict, lines, exposureAed: exposure };
}

/* ── e-invoicing ───────────────────────────────────────────────────────── */

export type EInvResult = {
  phase: "large" | "sme"; aspBy: string; goLive: string; daysToAsp: number; daysToGoLive: number;
  /** Penalty estimate to date (AED) given the answers; 0 when nothing is late yet. */
  exposureAed: number;
  /** What one month of non-compliance would cost once a date is missed. */
  monthlyRiskAed: number;
  lines: ToolLine[];
};

export type EInvOptions = { aspAppointed?: boolean; b2bInvoicesPerMonth?: number | null };

/** Months (or part months) from the day after `due` to `today`, 0 if not late. */
function monthsOrPartLate(due: string, today: string): number {
  if (today <= due) return 0;
  return Math.max(monthsLate(due, today), 1);
}

export function checkEInvoicing(revenueAed: number, today: string, o: EInvOptions = {}): EInvResult {
  const e = TAX.einvoicing;
  const pen = e.penalties;
  const large = revenueAed >= e.large.revenue_gte_aed;
  const p = large ? e.large : e.sme;
  const daysToAsp = daysBetween(today, p.asp_by);
  const daysToGoLive = daysBetween(today, p.go_live);
  const appointed = !!o.aspAppointed;
  const invoices = Math.max(Math.round(o.b2bInvoicesPerMonth ?? 0), 0);
  const invoiceMonthly = Math.min(invoices * pen.invoice_not_issued_aed, pen.invoice_cap_aed_per_month);
  const monthlyRiskAed = (appointed ? 0 : pen.asp_late_aed_per_month) + invoiceMonthly;

  let exposure = 0;
  const lines: ToolLine[] = [];
  if (appointed) {
    lines.push({ tone: "good", title: "Accredited Service Provider appointed", detail: `Next: map your invoice data and test with the ASP before ${fmtDay(p.go_live)}.` });
  } else {
    const late = monthsOrPartLate(p.asp_by, today);
    exposure += late * pen.asp_late_aed_per_month;
    lines.push({
      tone: late ? "bad" : daysToAsp < 60 ? "warn" : "info",
      title: `Appoint an Accredited Service Provider by ${fmtDay(p.asp_by)}`,
      detail: late
        ? `That date has passed. Late appointment: ${aed(pen.asp_late_aed_per_month)} for each month or part month — about ${aed(exposure)} so far.`
        : `${daysToAsp} days left. Missing it: ${aed(pen.asp_late_aed_per_month)} for each month or part month of delay.`,
    });
  }
  const liveMonths = monthsOrPartLate(p.go_live, today);
  if (invoices && liveMonths && !appointed) exposure += liveMonths * invoiceMonthly;
  lines.push({
    tone: "info",
    title: `E-invoices go live ${fmtDay(p.go_live)}`,
    detail: `${large ? `Revenue of ${aed(e.large.revenue_gte_aed)} or more` : "Businesses below the large-company threshold"}. Applies to B2B and B2G invoices.`,
  });
  lines.push({
    tone: invoices ? "warn" : "info",
    title: `Each invoice not sent as an e-invoice: ${aed(pen.invoice_not_issued_aed)}`,
    detail: invoices
      ? `At ~${invoices.toLocaleString("en-US")} B2B invoices a month that is ${aed(invoiceMonthly)} a month (capped at ${aed(pen.invoice_cap_aed_per_month)}; credit notes count separately).`
      : `Capped at ${aed(pen.invoice_cap_aed_per_month)} a month; credit notes count separately. Source: ${pen.legal_basis}.`,
  });
  return { phase: large ? "large" : "sme", aspBy: p.asp_by, goLive: p.go_live, daysToAsp, daysToGoLive, exposureAed: exposure, monthlyRiskAed, lines };
}
