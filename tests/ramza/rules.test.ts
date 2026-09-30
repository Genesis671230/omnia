import { test } from "node:test";
import assert from "node:assert/strict";
import { CT, billableTxn, priceForTxn, rules, rulesMode } from "../../lib/ramza/rules";
import { addMonths, lateFilingPenalty } from "../../lib/ramza/ct-penalty";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

test("every listed CT deadline is the year end plus the filing window", () => {
  for (const d of rules.ct.deadlines) {
    assert.match(d.fy_end, DAY);
    assert.equal(addMonths(d.fy_end, CT.filingMonths), d.due, `${d.fy_end} → ${d.due}`);
  }
});

test("the campaign switches deadline → rescue → evergreen on the right Dubai days", () => {
  assert.equal(rulesMode("2026-09-30"), "deadline");
  assert.equal(rulesMode("2026-10-01"), "rescue");
  assert.equal(rulesMode("2026-10-31"), "rescue");
  assert.equal(rulesMode("2026-11-01"), "evergreen");
  // the rescue window ends the day before the penalty would double
  assert.equal(addMonths(rules.ct.deadlines[0].due, 1), rules.campaign.rescue_mode_until);
});

test("the checker's penalty follows rules.json", () => {
  assert.equal(lateFilingPenalty(1), CT.lateFilingFirst12Aed);
  assert.equal(lateFilingPenalty(13), 12 * CT.lateFilingFirst12Aed + CT.lateFilingAfter12Aed);
});

test("regulatory values carry a source and a verified date", () => {
  for (const [name, v] of Object.entries({
    late_filing: rules.ct.late_filing_penalty,
    waiver: rules.ct.late_registration_waiver,
    einvoicing: rules.einvoicing,
  })) {
    assert.match(v.source, /^https:\/\//, `${name} source`);
    assert.match(v.verified_on, DAY, `${name} verified_on`);
  }
});

test("gateway lines bill N-to-1 on top of bank lines", () => {
  const n = rules.pricing.gateway_lines_per_txn;
  assert.equal(billableTxn(40, 0), 40);
  assert.equal(billableTxn(40, 1), 41);
  assert.equal(billableTxn(40, n), 41);
  assert.equal(billableTxn(40, n + 1), 42);
  assert.equal(billableTxn(Number.NaN, -5), 0);
});

test("an undecided price is null — never a made-up number", () => {
  for (const t of rules.pricing.tiers) assert.equal(priceForTxn(t.max_txn), t.aed_month);
  assert.equal(priceForTxn(10_000), null); // above the largest tier → quote
});
