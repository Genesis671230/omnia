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

test("matchesPostStatus buckets the Zoho ledger status", () => {
  const postings = {
    a: { status: "verified" }, b: { status: "posted" }, c: { status: "not_in_zoho" },
    d: { status: "missing_in_zoho" }, e: { status: "amount_differs" }, f: { status: "failed" },
  };
  const ids = (f: Parameters<typeof matchesPostStatus>[2]) => ["a", "b", "c", "d", "e", "f", "g"].filter((id) => matchesPostStatus(id, postings, f));
  assert.deepEqual(ids("in_zoho"), ["a", "b"]);
  assert.deepEqual(ids("not_in_zoho"), ["c", "d"]);
  assert.deepEqual(ids("needs_review"), ["e"]);
  assert.deepEqual(ids("failed"), ["f"]);
  assert.deepEqual(ids("not_checked"), ["g"]);
});

test("matchesBankTxnQuery also finds a line by what Zoho booked it as", () => {
  const line = { id: "1", description: "Account Transfer Charges/ IBMB", reference: "FT26244T2HH8", amount: 1, gatewayGuess: null, kind: "fee" };
  const zoho = { status: "verified", zoho: { reference: "FT26244T2HH8", account: "Bank Fees and Charges", amount: 1.05 } };
  assert.equal(matchesBankTxnQuery(line, "bank fees", zoho), true);
  assert.equal(matchesBankTxnQuery(line, "1.05", zoho), true);
  assert.equal(matchesBankTxnQuery(line, "bank fees"), false);
});

test("matchesPostStatus: 'all' always matches, even with no postings loaded", () => {
  assert.equal(matchesPostStatus("anything", {}, "all"), true);
});
