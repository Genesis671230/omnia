// tests/parsers/bank-dedupe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeKey } from "@/lib/parsers/bank-dedupe";
import type { ParsedBankLine } from "@/lib/parsers/bank";

function line(overrides: Partial<ParsedBankLine> = {}): ParsedBankLine {
  return {
    lineId: "C001",
    date: "2026-07-08",
    narration: "Inward Telex Payment/ON TRACK DELIVERY/invoice 16958/FT26189F9JF7 FT26189F9JF7",
    reference: "FT26189F9JF7",
    amount: 4090,
    direction: "credit",
    ...overrides,
  };
}

test("dedupeKey: a genuine wire reference identifies the row independent of amount", () => {
  const corrupted = line({ amount: 7 }); // pre-fix regex misread of the reference tail
  const healed = line({ amount: 4090 }); // post-fix, correctly parsed
  assert.equal(dedupeKey(corrupted), dedupeKey(healed));
});

test("dedupeKey: a genuine wire reference identifies the row independent of narration truncation", () => {
  const truncated = line({ narration: "invoice 16958/FT26189F9JF7 FT26189F9J" }); // old bug ate the last char
  const full = line({ narration: "invoice 16958/FT26189F9JF7 FT26189F9JF7" });
  assert.equal(dedupeKey(truncated), dedupeKey(full));
});

test("dedupeKey: different wire references never collide", () => {
  const a = line({ reference: "FT26189F9JF7" });
  const b = line({ reference: "DSZ26196LJDMGKKL" });
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});

test("dedupeKey: same date+direction+reference on different days never collide", () => {
  const a = line({ date: "2026-07-08" });
  const b = line({ date: "2026-07-09" });
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});

test("dedupeKey: no wire reference falls back to amount + narration prefix (no bank-assigned id to trust)", () => {
  const a = line({ reference: "INV16958", narration: "COD remittance/invoice 16958", amount: 150 });
  const b = line({ reference: "INV16958", narration: "COD remittance/invoice 16958", amount: 275 });
  assert.notEqual(dedupeKey(a), dedupeKey(b), "distinct amounts must stay distinct without a wire id to disambiguate");

  const c = line({ reference: "", narration: "COD remittance, no ref at all", amount: 150 });
  const d = line({ reference: "", narration: "COD remittance, no ref at all", amount: 150 });
  assert.equal(dedupeKey(c), dedupeKey(d), "identical no-ref transactions still dedupe");
});

test("dedupeKey: debit siblings sharing one wire reference never collapse into each other", () => {
  // a single outward transfer legitimately produces three debit rows under
  // the SAME reference: the transfer itself, its account-transfer-charges
  // fee, and the tax on that fee — e.g. FT26195SG8YG as 50000 / 1 / 0.05.
  const transfer = line({ direction: "debit", reference: "FT26195SG8YG", amount: 50000, narration: "Outward Telex Payment/FT26195SG8YG" });
  const fee = line({ direction: "debit", reference: "FT26195SG8YG", amount: 1, narration: "Account Transfer Charges/IBMB/FT26195SG8YG" });
  const tax = line({ direction: "debit", reference: "FT26195SG8YG", amount: 0.05, narration: "Tax Amount Payable/AC-FT26195SG8YG" });
  const keys = new Set([dedupeKey(transfer), dedupeKey(fee), dedupeKey(tax)]);
  assert.equal(keys.size, 3, "all three real debit rows must keep distinct keys");
});
