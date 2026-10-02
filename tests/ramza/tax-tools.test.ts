import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCtFromIncorporation, checkCtRelief, checkEInvoicing, checkVat, ctRegistrationDeadline, firstTaxPeriodEnd } from "../../lib/ramza/tax-tools";

test("registration deadline follows FTA Decision 3/2024", () => {
  assert.equal(ctRegistrationDeadline("2019-02-14"), "2024-05-31");   // Feb licence
  assert.equal(ctRegistrationDeadline("2021-07-03"), "2024-09-30");   // Jul
  assert.equal(ctRegistrationDeadline("2015-11-20"), "2024-11-30");   // Nov
  assert.equal(ctRegistrationDeadline("2022-12-01"), "2024-12-31");   // Dec
  assert.equal(ctRegistrationDeadline("2020-05-05", false), "2024-05-31"); // no licence
  assert.equal(ctRegistrationDeadline("2025-01-15"), "2025-04-15");   // 3 months after incorporation
});

test("the first CT period starts no earlier than 1 Jun 2023", () => {
  assert.equal(firstTaxPeriodEnd("2018-03-01", 12), "2023-12-31");
  assert.equal(firstTaxPeriodEnd("2025-01-15", 12), "2025-12-31");
  assert.equal(firstTaxPeriodEnd("2025-08-10", 6), "2026-06-30");
});

test("late registration, waiver window and late filing are estimated together", () => {
  // Incorporated Feb 2025, Dec year end, never registered or filed, checked 1 Oct 2026.
  const r = checkCtFromIncorporation({ incorporated: "2025-02-10", fyEndMonth: 12, today: "2026-10-01" })!;
  assert.equal(r.registrationDue, "2025-05-10");
  assert.equal(r.firstReturnDue, "2026-09-30");
  assert.equal(r.waiverBy, "2026-07-31");
  assert.equal(r.estimatedAed, 10000 + 500); // waiver closed; 1 month late filing
  // Filed within the waiver window → no registration penalty.
  const w = checkCtFromIncorporation({ incorporated: "2025-02-10", fyEndMonth: 12, registeredOn: "2025-09-01", firstReturnFiledOn: "2026-07-20", today: "2026-10-01" })!;
  assert.equal(w.estimatedAed, 0);
});

test("relief: individual under AED 1m, SBR under AED 3m, blocked for qualifying free zone", () => {
  assert.equal(checkCtRelief({ kind: "individual", revenueAed: 900000, periodEnd: "2026-12-31" }).verdict, "not_subject");
  assert.equal(checkCtRelief({ kind: "company", revenueAed: 2500000, periodEnd: "2027-12-31" }).verdict, "sbr");
  assert.equal(checkCtRelief({ kind: "company", revenueAed: 2500000, periodEnd: "2030-12-31" }).verdict, "taxable");
  assert.equal(checkCtRelief({ kind: "free_zone", revenueAed: 2000000, periodEnd: "2026-12-31", qualifyingFreeZone: true }).verdict, "taxable");
  assert.equal(checkCtRelief({ kind: "company", revenueAed: 5000000, periodEnd: "2026-12-31", taxableProfitAed: 475000 }).estimatedCtAed, 9000);
});

test("VAT: mandatory, voluntary, none; late registration exposure", () => {
  assert.equal(checkVat({ suppliesLast12Aed: 100000, registered: false, today: "2026-10-01" }).verdict, "none");
  assert.equal(checkVat({ suppliesLast12Aed: 200000, registered: false, today: "2026-10-01" }).verdict, "voluntary");
  const m = checkVat({ suppliesLast12Aed: 400000, registered: false, crossedOn: "2026-08-01", today: "2026-10-01" });
  assert.equal(m.verdict, "mandatory");
  assert.equal(m.exposureAed, 10000);
  assert.equal(checkVat({ suppliesLast12Aed: 400000, registered: false, crossedOn: "2026-09-20", today: "2026-10-01" }).exposureAed, 0);
});

test("e-invoicing phase by revenue", () => {
  const big = checkEInvoicing(60000000, "2026-10-01");
  assert.equal(big.phase, "large");
  assert.equal(big.goLive, "2027-01-01");
  assert.equal(checkEInvoicing(5000000, "2026-10-01").goLive, "2027-07-01");
});
