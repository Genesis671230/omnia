# Progress ledger — Settlement Confirmation + Zoho Books Publish

Plan: docs/superpowers/plans/2026-07-18-settlement-confirmation-zoho-publish.md
Branch: recon-gateway-hardening
Baseline commit: 47d4187 (plan committed; prior orders-pagination-perf plan
paused after its Task 2 — Tasks 3-8 of that plan remain to resume later,
history in `git log -p -- .superpowers/sdd/progress.md`)

Task 1: complete (commits 47d4187..5a0592b, review approved after one fix).
Real bug found+fixed: `getByToken` discarded the settlement_document_links
select's error, so a failed lookup silently returned settlementRecordIds:
[] — `confirm()` would then mark the document confirmed while leaving every
linked settlement_records row unconfirmed forever, no error anywhere.
Brief-level note for Task 2/4 implementers: the brief's Interfaces line for
`SettlementDocumentsRepository.create` says it returns
`{ id, confirmToken }` but the actual code (and what got built) returns
the full `SettlementDocumentWithLinks` with field `confirm_token` (snake_case)
— read the file, not the brief's summary line.

Task 4: complete (commits 212cd1f..ea47196, review approved after one fix).
Real security bug found+fixed: the public unauthenticated /confirm/:token/
document route served the uploaded file's uploader-controlled `mime` field
(client's file.type at upload) with Content-Disposition inline — a "payout
evidence" file uploaded with mime text/html or image/svg+xml would execute
in-browser for anyone holding the link, no auth. Fixed with a fixed
inline-safe MIME allowlist (pdf/png/jpeg/gif/webp), else forces attachment
download. Minor (not fixed, logged for final review): confirm() is
read-then-write, not atomic — a true concurrent double-POST race could
attribute confirmed_by inconsistently between settlement_documents and
settlement_records (cosmetic only, evidence_confirmed ends up true either
way).

Task 3: complete (commits d930739..212cd1f, review approved after one fix).
Two haiku implementer-subagent dispatches hit the account's session rate
limit before doing any work (one made zero edits, one didn't even read the
brief) — controller implemented Task 3 directly instead of retrying.
Real bug found+fixed by review: POST /api/settlements/documents parsed
request.json() with no .catch(), so a malformed body 500'd instead of
returning this route's own 400 — fixed to match the .catch(() => ({}))
pattern already used by orders/ship and orders/status; also patched the
plan's own Task 4/5 code samples for consistency since they had the same
gap.

Task 2: complete (commits 5a0592b..f73f203, review approved, zero issues).
Implementer subagent hit a session rate limit right after finishing
(committed + wrote its report, cut off before replying) — controller
verified the commit is scoped correctly (only engine.ts + the new test
file). Unrelated note: `lib/invoice.ts` appeared modified in the working
tree during this task (a `totalLabel` field + exported `winAnsiSafe`) —
not touched by this plan's work, left uncommitted and untouched; flagged
to the user as likely concurrent/external work.

---

# Progress ledger — Bulk Bank Transactions to Zoho

Plan: docs/superpowers/plans/2026-07-23-bulk-bank-transactions-to-zoho.md
Branch: recon-gateway-hardening
Baseline commit: d271cbd274f35496969334c44e4281d69204270b (plan committed)

Task 1: complete (commits d271cbd..5c31814, review approved, zero blocking issues).
Minor note carried to Task 2 review: XLSX.read isn't defended against a
malformed/corrupt buffer inside xlsxToCsvText — intentionally left to the
upload route's error handling, not this task's scope.

Task 2: complete (commits 5c31814..9c7430e, review approved after one fix).
Real gap found+fixed: the upload route had no top-level try/catch, so a
corrupt/malformed PDF or XLSX would throw uncaught and surface as a raw
framework 500 (and a client-side JSON.parse SyntaxError on top of that)
instead of the route's normal clean {error} JSON shape. Fixed by wrapping
the PDF/XLSX/fallback text-extraction block in a try/catch returning 400.
Minor (not fixed, logged for final review): the 400 body forwards the raw
library exception message verbatim to the client — low risk (unpdf/xlsx
both throw real Error instances) but not sanitized.

Task 3: complete (commits 9c7430e..0f75a39, review approved, zero issues).
Reviewer flagged the "applied live" claim as unverifiable from a diff;
controller independently confirmed via a live Supabase query that
bank_lines.zoho_description, zoho_bank_txn_postings, and
zoho_account_config.default_income_account_id/expense_account_by_kind all
exist in the live database. Safe for Tasks 5/8/9 to rely on.

Task 4: complete (commits 0f75a39..9d4f463, review approved, zero blocking issues).
buildPayoutPostings and its tests confirmed byte-for-byte untouched. Minor
note carried forward: buildBankLinePosting checks amount>0 before rounding
(inherited from the plan's own pseudocode, not an implementer deviation) —
a sub-cent amount like 0.004 would pass the guard and round to 0.00. Low
real-world risk (bank_lines amounts come from parsed statement cents).

Task 5: complete (commits 9d4f463..86f5ea5, review approved, zero blocking issues).
Minor note (inherited from the brief's own select-column list, not an
implementer defect): BankLineWithZoho requires tenant_id: string but
listAll/getByIds don't select that column, so the `as` cast doesn't
actually satisfy tenant_id at runtime. Only matters if a later task reads
.tenant_id off these rows — none of Tasks 8/9/10 in this plan do.

Task 6: complete (commits 86f5ea5..e108841, review approved, zero issues).

Task 7: complete (commits e108841..c8921fa, review approved, zero blocking issues).
Minor note: the full-file replacement (as prescribed by the plan/brief
itself) dropped several explanatory comments from the original route
(why blanks are dropped before saving, why both bank+chart-of-accounts
lists are fetched). Documentation-only, no functional impact; inherited
from the brief's own replacement text, not an implementer omission.

Task 8: complete (commits c8921fa..26528d6, review approved after one fix).
Real gap found+fixed: PATCH /api/reconcile/bank-line/:id silently coerced a
missing/null/wrong-typed zohoDescription into "" via String(x ?? ""),
which would silently blank a bookkeeper's saved description on a malformed
request with no error. Fixed to reject non-string values with 400 while
still allowing a legitimate explicit "" (clearing the description).
Minor (not fixed, logged for final review): a raw JSON body of literal
`null` still throws unhandled outside the route's try/catch (pre-existing,
not introduced by this fix — body.zohoDescription access on a null body
throws before the new typeof guard even runs).

Task 9: complete (commits 26528d6..81be536, review approved, zero blocking issues).
All 5 idempotency/isolation checks verified line-by-line: dry-run makes
zero external calls, local fast-path precedes buildBankLinePosting only
when !dryRun, per-line try/catch isolates failures, failed rows recorded
defensively, accessToken fetched once outside the loop. Minor notes for
final review: (e as Error).message would silently become undefined on a
non-Error throw (none currently reachable); failed-row amount isn't
.toFixed(2)-rounded like the posted-row path; unmatched bankLineIds are
silently dropped from results with no explicit signal to the caller.

Task 10: complete (commits 81be536..994fcc7, review approved, zero blocking issues).
Both pre-existing settings cards confirmed untouched in behavior; new card's
fields verified byte-for-byte against the live Task 7 API route. Minor note:
no manual browser check was done (build-only verification) — worth an
eyeball pass during Task 12's end-to-end check.

Task 11: complete (commits 994fcc7..bfac878, review approved, zero blocking issues).
Implementer found and fixed a real gap in the PLAN'S OWN prescribed wiring
(not their own mistake): recon-view.tsx's buckets object never got a
`transactions` key, so buckets[tab] would be undefined and groupLines()
would throw the moment a user clicked the new tab. Fixed with one line
mirroring the existing `insights: searched` no-op entry — verified correct
and minimal by the reviewer via independent trace of the crash path.
Minor notes for final review: toggleSelect uses stale-closure setState
form instead of functional updater (latent, not currently exploitable);
BankTxnRow's description draft only seeds on mount, no external-sync path.
