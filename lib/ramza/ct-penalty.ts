/* UAE Corporate Tax penalty checker — pure date + amount rules, no I/O.
 *
 * What it answers, from dates the visitor types in:
 *   1. Reconsideration window — a request to the FTA to reconsider a penalty
 *      must be filed within 40 BUSINESS days of being notified of it
 *      (Tax Procedures Law). Counted Mon–Fri (UAE weekend is Sat–Sun since
 *      2022). Public holidays extend the real window; we don't know them in
 *      advance, so the date we show is the conservative (earliest) one.
 *   2. Late-registration waiver — the FTA's 2025 initiative cancels the
 *      AED 10,000 late-registration penalty if the first Corporate Tax return
 *      (or annual declaration) is filed within 7 months of the end of the
 *      first tax period. Already paid? It is refunded as a credit.
 *   3. Late-filing estimate — a return is due 9 months after the tax period
 *      ends; late filing costs AED 500 for each month or part of a month for
 *      the first 12 months, then AED 1,000 a month.
 *
 * General information only — every result screen says so and routes to a
 * person. Dates are plain YYYY-MM-DD strings handled in UTC so a visitor's
 * timezone can never shift a deadline by a day. */

export type PenaltyType = "late_registration" | "late_filing" | "other" | "not_sure";

export type CheckerInput = {
  penaltyType: PenaltyType;
  /** Date on the FTA penalty notice. */
  issuedOn?: string | null;
  /** Last day of the company's first (or the relevant) tax period. */
  periodEnd?: string | null;
  /** When the return was filed; empty = not filed yet. */
  filedOn?: string | null;
  /** Today, YYYY-MM-DD (injected so results are testable). */
  today: string;
};

export type Tone = "good" | "act" | "closed" | "info";

export type Finding = { key: string; tone: Tone; title: string; detail: string; deadline?: string; daysLeft?: number };

export type CheckerResult = {
  headline: string;
  tone: Tone;
  findings: Finding[];
  /** Rough AED exposure we could estimate from the inputs (0 when unknown). */
  estimatedAed: number;
};

// Amounts and windows come from config/rules.json (lib/ramza/rules.ts).
import { CT } from "./rules";

export const RECONSIDERATION_BUSINESS_DAYS = CT.reconsiderationBusinessDays;
export const LATE_REGISTRATION_AED = CT.lateRegistrationAed;

/* ── date helpers (UTC, YYYY-MM-DD) ──────────────────────────────────────── */

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isWeekend = (ms: number) => {
  const w = new Date(ms).getUTCDay();
  return w === 0 || w === 6; // Sun, Sat
};

export function isValidDay(d: string | null | undefined): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(toMs(d));
}

/** The date `n` business days after `from` (the notice day itself is day 0). */
export function addBusinessDays(from: string, n: number): string {
  let ms = toMs(from);
  let left = n;
  while (left > 0) {
    ms += 86_400_000;
    if (!isWeekend(ms)) left -= 1;
  }
  return toDay(ms);
}

/** Business days from `from` (exclusive) to `to` (inclusive); negative if `to` is earlier. */
export function businessDaysBetween(from: string, to: string): number {
  const a = toMs(from), b = toMs(to);
  if (b === a) return 0;
  const step = b > a ? 86_400_000 : -86_400_000;
  let n = 0;
  for (let ms = a + step; step > 0 ? ms <= b : ms >= b; ms += step) if (!isWeekend(ms)) n += step > 0 ? 1 : -1;
  return n;
}

function lastDayOfMonth(y: number, m0: number) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** `months` after `d`. A month-end date stays a month-end (30 Jun + 7 → 31 Jan). */
export function addMonths(d: string, months: number): string {
  const dt = new Date(toMs(d));
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), day = dt.getUTCDate();
  const endOfMonth = day === lastDayOfMonth(y, m);
  const tm = m + months;
  const ty = y + Math.floor(tm / 12);
  const tm0 = ((tm % 12) + 12) % 12;
  const tday = endOfMonth ? lastDayOfMonth(ty, tm0) : Math.min(day, lastDayOfMonth(ty, tm0));
  return toDay(Date.UTC(ty, tm0, tday));
}

/** Months or part-months from `due` (exclusive) to `until`; 0 if not late. */
export function monthsLate(due: string, until: string): number {
  if (toMs(until) <= toMs(due)) return 0;
  let n = 0;
  while (toMs(addMonths(due, n)) < toMs(until)) n += 1;
  return n;
}

export function lateFilingPenalty(months: number): number {
  return Math.min(months, 12) * CT.lateFilingFirst12Aed + Math.max(months - 12, 0) * CT.lateFilingAfter12Aed;
}

const fmtDay = (d: string) =>
  new Date(toMs(d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const aed = (n: number) => `AED ${n.toLocaleString("en-US")}`;

/* ── the checker ─────────────────────────────────────────────────────────── */

export function checkPenalty(input: CheckerInput): CheckerResult {
  const { penaltyType, today } = input;
  const findings: Finding[] = [];
  let estimated = 0;

  // 1. Reconsideration window — applies to any penalty with a notice date.
  if (isValidDay(input.issuedOn)) {
    const deadline = addBusinessDays(input.issuedOn, RECONSIDERATION_BUSINESS_DAYS);
    const left = businessDaysBetween(today, deadline);
    findings.push(
      left >= 0
        ? {
            key: "reconsideration", tone: "act", deadline, daysLeft: left,
            title: `${left} business day${left === 1 ? "" : "s"} left to ask the FTA to reconsider`,
            detail: `A reconsideration request must reach the FTA by about ${fmtDay(deadline)} — ${RECONSIDERATION_BUSINESS_DAYS} business days from the notice. It needs a clear reason and supporting documents, submitted through EmaraTax.`,
          }
        : {
            key: "reconsideration", tone: "closed", deadline, daysLeft: left,
            title: `The ${RECONSIDERATION_BUSINESS_DAYS}-business-day reconsideration window has passed`,
            detail: `It closed around ${fmtDay(deadline)}. Other routes can still apply — a penalty waiver request once the underlying issue is fixed, or an instalment plan — depending on the case.`,
          },
    );
  }

  // 2. Late-registration waiver (7 months after the first tax period).
  if (penaltyType === "late_registration" || penaltyType === "not_sure") {
    if (penaltyType === "late_registration") estimated += LATE_REGISTRATION_AED;
    if (isValidDay(input.periodEnd)) {
      const waiverBy = addMonths(input.periodEnd, CT.waiverMonths);
      const filed = isValidDay(input.filedOn) ? input.filedOn : null;
      if (filed && toMs(filed) <= toMs(waiverBy)) {
        if (penaltyType === "late_registration") estimated -= LATE_REGISTRATION_AED;
        findings.push({
          key: "waiver", tone: "good", deadline: waiverBy,
          title: `The ${aed(LATE_REGISTRATION_AED)} late-registration penalty should be waived`,
          detail: `The return was filed on ${fmtDay(filed)}, within ${CT.waiverMonths} months of the tax period ending (by ${fmtDay(waiverBy)}). The waiver is applied automatically; if it was already paid, it comes back as a credit you can ask to refund.`,
        });
      } else if (!filed && toMs(today) <= toMs(waiverBy)) {
        const days = Math.round((toMs(waiverBy) - toMs(today)) / 86_400_000);
        findings.push({
          key: "waiver", tone: "act", deadline: waiverBy, daysLeft: days,
          title: `File by ${fmtDay(waiverBy)} and the ${aed(LATE_REGISTRATION_AED)} penalty can be cancelled`,
          detail: `Filing the first Corporate Tax return within ${CT.waiverMonths} months of the tax period ending triggers the FTA's automatic waiver of the late-registration penalty. ${days} calendar days left.`,
        });
      } else {
        findings.push({
          key: "waiver", tone: "closed", deadline: waiverBy,
          title: "The automatic late-registration waiver no longer applies",
          detail: `The return needed to be filed by ${fmtDay(waiverBy)}${filed ? ` and was filed on ${fmtDay(filed)}` : " and hasn't been filed yet"}. A reconsideration or waiver request may still be possible.`,
        });
      }
    }
  }

  // 3. Late filing estimate (return due 9 months after the period ends).
  if ((penaltyType === "late_filing" || penaltyType === "late_registration" || penaltyType === "not_sure") && isValidDay(input.periodEnd)) {
    const due = addMonths(input.periodEnd, CT.filingMonths);
    const until = isValidDay(input.filedOn) ? input.filedOn : today;
    const m = monthsLate(due, until);
    if (m > 0) {
      const amount = lateFilingPenalty(m);
      estimated += amount;
      findings.push({
        key: "late_filing", tone: isValidDay(input.filedOn) ? "info" : "act", deadline: due,
        title: `About ${aed(amount)} in late-filing penalties${isValidDay(input.filedOn) ? "" : " so far"}`,
        detail: `The return was due ${fmtDay(due)}. That's ${m} month${m === 1 ? "" : "s"} late: ${aed(CT.lateFilingFirst12Aed)} a month for the first 12 months, ${aed(CT.lateFilingAfter12Aed)} a month after.${isValidDay(input.filedOn) ? "" : " It keeps growing every month until the return is filed."}`,
      });
    } else if (!isValidDay(input.filedOn) && toMs(today) <= toMs(due)) {
      findings.push({
        key: "late_filing", tone: "good", deadline: due,
        title: `Return not due yet — due ${fmtDay(due)}`,
        detail: "File on time and no late-filing penalty applies.",
      });
    }
  }

  const closed = findings.some((f) => f.tone === "closed");
  const act = findings.find((f) => f.tone === "act");
  const good = findings.length > 0 && findings.every((f) => f.tone === "good");

  let headline: string, tone: Tone;
  if (findings.length === 0) {
    headline = "Add the notice date and your tax period to see your deadlines";
    tone = "info";
  } else if (good) {
    headline = "You look clear — no penalty should stand";
    tone = "good";
  } else if (act) {
    headline = act.daysLeft != null ? `There's still time — ${act.title.toLowerCase()}` : act.title;
    tone = "act";
  } else if (closed) {
    headline = "The quick routes have closed, but you may still have options";
    tone = "closed";
  } else {
    headline = findings[0].title;
    tone = findings[0].tone;
  }

  return { headline, tone, findings, estimatedAed: Math.max(estimated, 0) };
}

/* ── filing countdown ─────────────────────────────────────────────────────
   For the most common (31 December) year end, the return is due 30 September
   of the following year. The countdown targets the next such deadline that
   hasn't passed yet, at 23:59:59 Dubai time (UTC+4). */

export type FilingDeadline = { yearEnd: string; due: string; dueMs: number };

export function nextDecYearEndDeadline(nowMs: number): FilingDeadline {
  const y = new Date(nowMs + 4 * 3600_000).getUTCFullYear();
  for (const dueYear of [y, y + 1]) {
    const dueMs = Date.UTC(dueYear, 8, 30, 23, 59, 59) - 4 * 3600_000; // 30 Sep 23:59:59 GST
    if (dueMs >= nowMs) return { yearEnd: `${dueYear - 1}-12-31`, due: `${dueYear}-09-30`, dueMs };
  }
  throw new Error("unreachable");
}

export function splitCountdown(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const s = Math.max(Math.floor(ms / 1000), 0);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}
