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
