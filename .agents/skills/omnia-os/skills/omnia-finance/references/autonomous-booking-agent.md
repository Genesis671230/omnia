# Building the autonomous payout-booking agent

Blueprint for an agent that takes a bank credit from "arrived" to "booked, verified, clearing account at zero" with **no routine human checking** — a person only sees genuine exceptions, each with a reason code and the evidence. Read `payout-playbooks.md` first: this file is the *process*; that one is the *accounting*.

The principle that makes removing manual checks safe: **replace human judgement with machine-checkable evidence, and verify every write by reading it back.** The founder's "Confirm settlement" click exists because nothing else proved the numbers. An agent may skip that click only when it holds proof at least as strong — and it must record that proof.

---

## 1. Status: what exists vs. what the agent adds

Already built (use it, don't rebuild):
- Parsers for Tabby/Tamara/Telr/Stripe/Checkout files, incl. VAT-on-top and bracket negatives — `lib/parsers/payouts.ts`
- Bank → payout → orders matching, pinned payouts, manual ref links, partial confirmation — `lib/reconciliation/engine.ts`
- Pure booking math + invoice picking + credit-note bodies — `lib/finance/settlement-posting.ts` (tests: `tests/finance/settlement-posting.test.ts`)
- Idempotent Zoho booking (payment → fee → FX), dry run, retries — `lib/finance/publish-settlements.ts`
- Refund credit notes — `lib/finance/publish-refunds.ts`
- Payout-level clearing → bank transfer — `app/api/integrations/zoho/post-payout/route.ts`
- Zoho throttle/quota — `lib/integrations/zoho-throttle.ts`
- Scheduler pattern + audit tables — `instrumentation.ts`, `sync_runs`, `zoho_publish_runs`

The agent adds (not built as of 2026-09-15):
- `evidence_type = "agent_verified"` on `settlement_records` + the evidence JSON that justified it
- Auto-confirm gate, auto-link gate, read-back verification, exception queue, booking scheduler, Telegram report

## 2. The pipeline

```
trigger ─► 1 INGEST ─► 2 MATCH ─► 3 PROVE ─► 4 PLAN (dry run) ─► 5 ASSERT ─► 6 POST ─► 7 VERIFY ─► 8 CLOSE ─► 9 REPORT
                                     │              │                 │           │           │
                                     └──── any failed gate ──► EXCEPTION QUEUE (reason code + evidence) ◄──┘
```

Triggers: bank statement upload/sync (new credits), payout file upload or API pull, and a scheduler tick (e.g. every 60 min) that re-runs every credit not yet CLOSED. Every stage is idempotent, so re-running the whole pipeline over everything is always safe.

### 1 INGEST
- Detect gateway + currency from the file (decision table §0 of the playbook), never from the filename alone.
- Parse. **Assert the file foots internally**: Σ rows of `gross − fee − VAT − net` = 0 (± 0.01 per row). A non-footing file means a parse bug (the bracket-negative bug would have been caught here) → `E_PARSE_NOT_FOOTING`.
- Upsert the payout; archive the raw file (`uploaded_files`). Never delete a payout automatically.

### 2 MATCH
- Run the engine. States: `AWAITING_PAYOUT`, `PAYOUT_VARIANCE`, `ORDERS_UNRESOLVED`, `SETTLED`.
- AED: bank credit must equal payout net within AED 1. Cross-border: within 2%, or exactly when the narration quotes a rate.
- **Auto-link unmatched refs only when unambiguous** (else `E_UNMATCHED_REF`):
  - phone ref whose last 9 digits match exactly one order's phone, **and** same gateway, **and** amount within 1%, **and** order date in `[bank date − 45d, bank date]`, **and** the order isn't on another payout or already settled; or
  - exactly one order in the window with the same gateway and the exact amount, and no phone evidence against it.
  - Record the rule that fired in `payout_ref_links.linked_by = "agent:<rule>"`.

### 3 PROVE (replaces the founder's confirm click)
Auto-confirm a credit only if ALL hold; store them as the evidence JSON:
1. Bank credit reconciles to the payout (§2 tolerances); `PAYOUT_VARIANCE` never auto-confirms.
2. The file foots internally (§1).
3. Every non-refund line is resolved (directly or via an agent/human link); for a partial, only the resolved orders are confirmed and the rest stay queued.
4. No resolved order is held by another payout's settlement record (`claimedElsewhere` empty for the orders being confirmed) — else `E_ORDER_CLAIMED_ELSEWHERE`.
5. No resolved order is recorded under a *different known* gateway (a Tamara payout paying an order whose gateway is Telr/Stripe/Tabby is a mismatch) — else `E_GATEWAY_MISMATCH`. `Unclassified`/empty gateways (common on WhatsApp orders) are not a mismatch.

Then `confirmEvidenceForBankLine`-equivalent with `evidence_type: "agent_verified"`, `evidence_confirmed_by: "agent"`.

### 4 PLAN (dry run)
`publishSettlements({ dryRun: true })` and `publishRefunds({ dryRun: true })` with accounts from `suggestPostingAccounts`. **If any suggested account is empty, stop** → `E_ACCOUNT_MAPPING` (never guess a clearing account).

### 5 ASSERT on the plan (before a single write)
- Per order: `payment − fee − difference = received` (± 0.01).
- Per payout: `Σ received − Σ refunds = bank credit` (± 0.01 × orders).
- AED payouts: `feeVat = fee ÷ 105 × 5` (Tabby) or `= VAT column` (Tamara), ± 0.01.
- Cross-border: every `differenceKind = "fx"` and |difference| ≤ 15% of invoice; flag orders whose implied rate `invoice ÷ (fee + received)` deviates > 3 percentage points from the payout's median → `E_FX_OUTLIER` (SA3593-type).
- AED: any difference > max(AED 1, 0.25%) → `E_INVOICE_MISMATCH`.
- Plan statuses: `review` → its reason code; `paid_external` → `I_PAID_BY_HAND` (informational, not booked); `failed` → retry once, then `E_ZOHO_REJECTED`.
- Zoho quota: estimated calls (≈ 6 per order) must fit the remaining daily budget (`zohoQuotaStatus()`), else defer to tomorrow — `I_QUOTA_DEFERRED`.

### 6 POST
`publishSettlements({ dryRun: false })` for the orders that passed, then `publishRefunds`. Never pass `bookFeesOnExternallyPaid` automatically — that decision needs a human who knows whether the fee was booked by hand.

### 7 VERIFY (read back from Zoho — never trust the local table)
For each booked order:
- `GET /invoices/{id}` → `balance ≤ 0.01` and `status = paid`. (805050 is why: a stored payment id pointed at a deleted payment.)
- the expense and journal ids exist (`GET /expenses/{id}`, `GET /journals/{id}`) with the planned amounts.
- refund: credit note balance dropped by the refund amount.
Any mismatch → clear the stale id, re-queue the order once; second failure → `E_VERIFY_FAILED`.

### 8 CLOSE
- When every order on the credit is booked/verified (or explicitly excluded as paid-by-hand with a human ack), run the payout-level transfer: clearing → bank for the **bank credit amount** (`post-payout` already switches to `bankAmount` when order-level fees exist).
- Verify the clearing account's movement for this payout nets to zero. Anything left = money stranded → `E_CLEARING_NOT_ZERO`.
- Mark the credit CLOSED in the audit table.

### 9 REPORT (honest, per `agent-employee-pattern.md` §6)
One Telegram message per run: credits closed, orders booked, total fees, total VAT reclaimed, total FX gain/loss, refunds booked — and **every exception with its reason code and a one-line fix**. "Booked" is only said for orders that passed VERIFY.

## 3. Exception reason codes

| Code | Meaning | Human fix |
|---|---|---|
| `E_PARSE_NOT_FOOTING` | file rows don't foot | check parser vs file layout |
| `E_PAYOUT_VARIANCE` | bank ≠ payout beyond tolerance | wrong/partial file, or bank fee |
| `E_UNMATCHED_REF` | line not an order, no unambiguous link | link on screen |
| `E_ORDER_CLAIMED_ELSEWHERE` | another payout holds the order | fix upstream matching (e.g. Stripe claiming Tamara orders) |
| `E_GATEWAY_MISMATCH` | order's gateway ≠ payout gateway | check the order's gateway |
| `E_DUPLICATE_INVOICE` | two invoices same amount | void the duplicate in Zoho |
| `E_INVOICE_MISMATCH` | AED invoice ≠ gateway amount | correct the invoice |
| `E_FX_OUTLIER` | order's FX far from payout median | check invoice / partial refund |
| `E_INVOICE_PARTIAL_EXTERNAL` | someone part-paid the invoice | book by hand |
| `I_PAID_BY_HAND` | invoice closed outside the app | confirm whether fee was booked; if not, run with `bookFeesOnExternallyPaid` |
| `E_REFUND_UNPAID_ORIGINAL` | refund against an unpaid invoice | book the earlier capture first |
| `E_ACCOUNT_MAPPING` | no clearing/fee/FX account found | map accounts |
| `E_ZOHO_REJECTED` | Zoho refused a write twice | read the message |
| `E_VERIFY_FAILED` | read-back disagrees with plan | investigate in Zoho |
| `E_CLEARING_NOT_ZERO` | clearing doesn't net to zero | find the missing document |
| `I_QUOTA_DEFERRED` | not enough Zoho budget today | none — retries tomorrow |

Store exceptions in a table (`booking_exceptions`: credit, order, code, evidence json, first_seen, last_seen, resolved_by) so the queue is queryable and a resolved one never re-alerts.

## 4. Rules the agent must never relax

- Never post a plug entry to make numbers foot.
- Never pick among ambiguous invoices, orders, or credit notes by position ("first match").
- Never book a fee on an invoice paid by hand without a human saying the fee wasn't booked.
- Never auto-confirm `PAYOUT_VARIANCE`.
- Never trust `settlement_records` over Zoho for whether an invoice is closed.
- Never delete a payout, link, or settlement record automatically; unlink only via the API guard.
- Never change the VAT convention per gateway without a real statement proving it (Tabby inclusive, Tamara on top).
- Restart the server after editing anything a scheduler imports (boot-time capture — see SKILL.md).

## 5. Testing the agent

- Golden fixtures from real statements: Tabby20260907AED, Tabby20260706SAR, Tamara P8498683AE260905 (with the 804047 refund and three phone refs). Each fixture asserts parse footing, match state, per-order plan, and payout invariant.
- Pure gates (PROVE, ASSERT, auto-link) as pure functions over already-fetched data, unit-tested like `settlement-posting.ts`.
- A full dry run on production data before enabling POST for a new gateway/currency; record the verified numbers in `payout-playbooks.md`.
