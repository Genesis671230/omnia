import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessDays, addMonths, businessDaysBetween, checkPenalty, lateFilingPenalty, monthsLate,
  nextDecYearEndDeadline, splitCountdown,
} from "../../lib/ramza/ct-penalty";

test("40 business days skip Saturdays and Sundays", () => {
  // Mon 1 Sep 2025 + 40 business days = 8 full weeks = Mon 27 Oct 2025
  assert.equal(addBusinessDays("2025-09-01", 40), "2025-10-27");
  // A notice on Friday: next business day is Monday
  assert.equal(addBusinessDays("2025-09-05", 1), "2025-09-08");
});

test("business days between, both directions", () => {
  assert.equal(businessDaysBetween("2025-09-01", "2025-09-08"), 5);
  assert.equal(businessDaysBetween("2025-09-08", "2025-09-01"), -5);
  assert.equal(businessDaysBetween("2025-09-01", "2025-09-01"), 0);
});

test("month-end stays month-end", () => {
  assert.equal(addMonths("2024-12-31", 7), "2025-07-31");
  assert.equal(addMonths("2025-06-30", 7), "2026-01-31");
  assert.equal(addMonths("2024-12-31", 9), "2025-09-30");
  assert.equal(addMonths("2025-01-15", 1), "2025-02-15");
});

test("late filing: 500/month for 12 months, then 1000", () => {
  assert.equal(lateFilingPenalty(0), 0);
  assert.equal(lateFilingPenalty(3), 1500);
  assert.equal(lateFilingPenalty(12), 6000);
  assert.equal(lateFilingPenalty(14), 8000);
  // part of a month counts as a month
  assert.equal(monthsLate("2025-09-30", "2025-10-01"), 1);
  assert.equal(monthsLate("2025-09-30", "2025-10-31"), 1);
  assert.equal(monthsLate("2025-09-30", "2025-11-01"), 2);
  assert.equal(monthsLate("2025-09-30", "2025-09-30"), 0);
});

test("late registration filed within 7 months → waived, no exposure", () => {
  const r = checkPenalty({ penaltyType: "late_registration", periodEnd: "2024-12-31", filedOn: "2025-07-20", today: "2025-08-01" });
  assert.equal(r.tone, "good");
  assert.equal(r.findings.find((f) => f.key === "waiver")?.tone, "good");
  assert.equal(r.estimatedAed, 0);
});

test("late registration, not filed, still inside the 7 months → act now", () => {
  const r = checkPenalty({ penaltyType: "late_registration", periodEnd: "2024-12-31", today: "2025-06-01" });
  const w = r.findings.find((f) => f.key === "waiver")!;
  assert.equal(w.tone, "act");
  assert.equal(w.deadline, "2025-07-31");
  assert.equal(r.tone, "act");
});

test("notice inside the reconsideration window → days left", () => {
  const r = checkPenalty({ penaltyType: "late_filing", issuedOn: "2025-09-01", today: "2025-09-08" });
  const f = r.findings.find((x) => x.key === "reconsideration")!;
  assert.equal(f.tone, "act");
  assert.equal(f.daysLeft, 35);
  assert.equal(f.deadline, "2025-10-27");
});

test("notice past the window → closed, other routes named", () => {
  const r = checkPenalty({ penaltyType: "other", issuedOn: "2025-01-01", today: "2025-09-01" });
  assert.equal(r.findings[0].tone, "closed");
  assert.equal(r.tone, "closed");
});

test("unfiled late return keeps growing and is estimated", () => {
  const r = checkPenalty({ penaltyType: "late_filing", periodEnd: "2024-12-31", today: "2025-12-15" });
  // due 30 Sep 2025 → 3 months or part by 15 Dec
  assert.equal(r.estimatedAed, 1500);
});

test("nothing entered → asks for dates", () => {
  const r = checkPenalty({ penaltyType: "not_sure", today: "2025-09-01" });
  assert.equal(r.tone, "info");
  assert.equal(r.findings.length, 0);
});


test("countdown targets 30 Sep for a 31 Dec year end, rolling to next year after it passes", () => {
  const d = nextDecYearEndDeadline(Date.parse("2026-09-28T10:00:00+04:00"));
  assert.equal(d.yearEnd, "2025-12-31");
  assert.equal(d.due, "2026-09-30");
  const after = nextDecYearEndDeadline(Date.parse("2026-10-01T00:00:01+04:00"));
  assert.equal(after.due, "2027-09-30");
  // 23:59 on the due day, Dubai time, still counts down to that day
  assert.equal(nextDecYearEndDeadline(Date.parse("2026-09-30T23:59:00+04:00")).due, "2026-09-30");
});

test("countdown split", () => {
  assert.deepEqual(splitCountdown(((2 * 24 + 10) * 3600 + 47 * 60 + 51) * 1000), { days: 2, hours: 10, minutes: 47, seconds: 51 });
  assert.deepEqual(splitCountdown(-5), { days: 0, hours: 0, minutes: 0, seconds: 0 });
});
