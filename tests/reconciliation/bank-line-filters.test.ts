import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesBankTxnQuery, matchesPostStatus } from "@/lib/reconciliation/bank-line-filters";

test("matchesBankTxnQuery: AND across tokens over description, reference, amount, gateway, kind", () => {
  const line = { id: "1", description: "Outward SWIFT Charges", reference: "DSZ26201CGC0JHK0", amount: 50, gatewayGuess: null, kind: "fee" };
  assert.equal(matchesBankTxnQuery(line, "swift fee"), true);
  assert.equal(matchesBankTxnQuery(line, "swift salary"), false);
  assert.equal(matchesBankTxnQuery(line, "50"), true);
  assert.equal(matchesBankTxnQuery(line, ""), true);
});

test("matchesPostStatus: not_posted means no posting record at all", () => {
  const postings = { "1": { status: "posted" } };
  assert.equal(matchesPostStatus("1", postings, "posted"), true);
  assert.equal(matchesPostStatus("2", postings, "not_posted"), true);
  assert.equal(matchesPostStatus("1", postings, "not_posted"), false);
  assert.equal(matchesPostStatus("1", postings, "failed"), false);
});

test("matchesPostStatus: 'all' always matches, even with no postings loaded", () => {
  assert.equal(matchesPostStatus("anything", {}, "all"), true);
});
