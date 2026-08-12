# Record customer payments from a payout (Feature A)

## Problem

When a payout file is uploaded and a bank credit reconciles against it (`ReconLine.state === "SETTLED"`, confirmed by the founder), every order in that payout still sits overdue/unpaid in Zoho Books until someone manually opens each invoice and records a payment. This is the ~80% of manual invoice-closing work the founder wants automated: given a settled, confirmed payout, batch-record the customer payment for every order it covers, with the correct payment date, deposit account, and payment mode — no per-invoice manual entry.

This is Feature A of a two-part project. Feature B (a standalone page for manual/bulk invoice payments — search by order number, CSV upload, or fetch overdue invoices from Zoho by date range, independent of any specific payout) is out of scope here and will get its own brainstorm/spec once A ships.

## Non-goals

- Not touching the existing journal-transfer flow (`ReconRow`'s "Preview & post to Zoho" button → `/api/integrations/zoho/post-payout` → `zoho-banking.ts`). That moves money between clearing/bank/fee accounts in the GL and is unrelated to invoice payment status. Both actions will coexist on a settled, confirmed line, doing two different jobs.
- Not building Feature B.
- Not changing how `settlement_records` rows are created or how "Confirm settlement" (`evidence_confirmed`) works — both already work correctly today.
- Not adding amount-editing — the amount posted is always `settlement_records.gross_aed` (the invoice amount), matching the existing balance-vs-amount server-side guard.

## Existing foundation this builds on

A complete, race-safe, DB-audited pipeline already exists but has no UI:

`settlement_records` (one row per order, created by `lib/reconciliation/engine.ts` with `settlement_date = <bank credit date>`, `gateway`, `gross_aed`, `bank_line_id`, `bank_reference`) → `evidence_confirmed` set by the existing "Confirm settlement" action → `POST /api/settlements/publish` (atomic per-row claim via `SettlementsRepository.claimForPublish`, prevents double-posting under concurrency/retry) → `createZohoCustomerPayment()` in `lib/integrations/zoho.ts` (finds the Zoho invoice by `reference_number` = order number, validates amount ≤ balance, posts via the Inventory API's `/customerpayments` — the Books API 401s under the current token scope).

Two duplicate, unfinished scaffolds exist in the working tree (all untracked, never committed) and will be deleted as part of this work:
- `lib/zoho/client.ts`, `lib/zoho/post-payout.ts` — a parallel Books-API client that 401s and is only consumed by a stub route.
- `app/api/reconcile/line/[id]/post-to-zoho/route.ts` — its `loadReconLine` returns `null` unconditionally; dead end.
- `components/finance/reconciliation/posttozohobar.tsx` — the UI for the above; gets replaced by this feature's real component.

## Changes

### 1. `lib/integrations/zoho.ts`

- `zohoPaymentModeFor(gateway)`: simplify to `gateway.toUpperCase() === "COD" ? "Cash on Delivery" : "Credit Card"`. This reverses a prior deliberate choice (see `tests/integrations/zoho-payment-mapping.test.ts`'s comment about preserving per-gateway distinctness in Zoho's `payment_mode` field) per explicit instruction today. The per-gateway audit trail is not lost from Omnia's own side — `settlement_records.gateway` still records which gateway actually paid — only Zoho's own `payment_mode` field stops distinguishing Stripe/Tabby/Tamara/Checkout.com from each other.
- `ZohoCustomerPaymentInput` gains three optional fields:
  - `date?: string` (yyyy-mm-dd) — when omitted, falls back to `new Date().toISOString().slice(0,10)` as today (used by any other future caller); the publish route will always pass the settlement's own `settlement_date` (the bank credit date) explicitly.
  - `accountId?: string` — sent as Zoho's `account_id` (the deposit/bank account) when present.
  - `referenceNumberOverride?: string` — when present, sent as the payment's `reference_number` **instead of** `bankReference`. Note: the existing invoice-level defense-in-depth dedupe check (matching an existing Zoho payment's `reference_number` against `bankReference`) is keyed on `bankReference` and is not updated to also check the override — meaning a payment posted with a custom reference won't be caught by that specific secondary check on a later retry. This is accepted: the *primary* defense (the atomic `claimForPublish` before any Zoho call) is unaffected, and truly ambiguous failures already route to `needsManualReview` rather than blind auto-retry.
- `createZohoCustomerPayment` builds the request body using these three fields, unchanged otherwise (still fetches invoice detail, validates balance, does the defense-in-depth dedupe check as today).

### 2. `lib/repositories/settlements.repository.ts`

- New method `listByBankLineId(bankLineId: string): Promise<SettlementRecord[]>` — same shape/pattern as `listByIds`, filtered by `bank_line_id`.

### 3. `app/api/settlements/publish/route.ts`

- Body becomes `{ settlementIds?: string[], bankLineId?: string, accountId?: string, referenceNumberOverride?: string }` — exactly one of `settlementIds` / `bankLineId` required (400 if both or neither). When `bankLineId` is given, settlements are loaded via the new repository method instead of `listByIds`.
- Passes `accountId`, `referenceNumberOverride`, and `date: s.settlement_date` through to `createZohoCustomerPayment` per settlement.
- Everything else (claim/publish/release loop, `ZohoPublishRunsRepository` audit trail, `isDefiniteRejection` classification) is unchanged.

This keeps one endpoint that both Feature A (`bankLineId` mode, used here) and Feature B (`settlementIds` mode, arbitrary multi-select) can share later.

### 4. New route: `GET /api/reconcile/line/[id]/settlements`

Returns `{ settlements: SettlementRecord[] }` for the given bank line — this doubles as the dialog's "preview," since the state (`evidence_confirmed`, `zoho_payment_id`) is already real, live data. No separate dry-run mechanism needed.

### 5. Deposit account

No schema change. Reuses `zoho_account_config.bank_account_id` (already documented as "where the wire actually lands," currently only consumed by the journal-transfer flow) as the default deposit account for customer payments too — one setting, edited in one place, can't drift out of sync between the two Zoho operations that both ultimately land in the same physical bank account. The existing `GET /api/integrations/zoho/account-config` endpoint (already returns `bankAccounts` + `effective.bankAccountId`) is reused as-is to populate the dropdown.

### 6. UI: `components/finance/reconciliation/gateway-proof.tsx`

Replaces the `PostToZohoBar` import/usage with a new `RecordPaymentsBar` (trigger button, in the same header slot next to "Export CSV") + `RecordPaymentsDialog` (shadcn `Dialog`, replacing the old raw `fixed inset-0` custom-modal pattern). Named distinctly from `ReconRow`'s "Preview & post to Zoho" (journal transfer) to avoid confusing the two different Zoho operations.

- Trigger disabled (with tooltip) until `r.confirmedBy` is set — mirrors the existing gate on the journal-transfer button.
- Dialog header: `{provider} · {payout.id} · {bank credit date}`.
- Row list: one row per settlement from the new `GET .../settlements` endpoint — order #, customer (cross-referenced from the orders already fetched for the proof table), amount, and a status pill: *Ready* / *Already posted* / *Refund (skipped — handled separately)* / whatever error state a prior attempt left behind.
- **Payment date**: shown read-only as the settlement's bank-credit date. Not a picker in this dialog.
- **Deposit account**: a shadcn `Select` of Zoho bank accounts, defaulting to `bank_account_id`, overridable for this batch only (override does not persist to Settings). If unset entirely, an inline warning replaces the dropdown and submit is disabled.
- **Payment mode**: a computed, non-editable summary chip, e.g. "Credit Card × 11, Cash on Delivery × 2."
- **Reference number**: a shadcn `Checkbox` ("Use a custom reference instead of the bank reference") revealing an `Input` with a framer-motion height/opacity transition when checked; unchecked → server uses the bank reference (unchanged default).
- Footer: "Record N payments" (disabled if nothing is postable) / Cancel.
- On submit: `POST /api/settlements/publish` with `{ bankLineId: r.id, accountId, referenceNumberOverride? }`. Per-row results animate into both the dialog and the underlying `GatewayProof` table rows via `AnimatePresence`, reusing the existing status-pill pattern (restyled) so results remain visible after closing the dialog.

## Error handling

- All server-side re-validation from the existing `/publish` route is unchanged and remains the source of truth — the UI's filtering is never trusted alone.
- Missing deposit account → inline warning, submit disabled (see above) — never silently let Zoho fall back to its own default account.
- Partial-batch failures: the loop continues past a failed row (existing behavior); ambiguous failures (timeout/5xx) are flagged `needsManualReview` rather than auto-retried (existing behavior, unaffected by these changes).

## Testing

- Update `tests/integrations/zoho-payment-mapping.test.ts` for the new Credit-Card/Cash-on-Delivery rule (with an updated comment reflecting the new rationale, replacing the old per-gateway-distinctness rationale).
- Add a focused test for `createZohoCustomerPayment`'s `date`/`accountId`/`referenceNumberOverride` passthrough.
- Add a test for `SettlementsRepository.listByBankLineId`.
- No existing UI test harness (Playwright etc.) in this repo to extend. Final verification is manual: one small real payout end-to-end in the running app before calling this done (dialog → submit → confirm the payment landed in Zoho with the right date/account/mode).

## Open items carried into implementation (not blocking, but worth naming)

- Exact wording/copy for the dialog and status pills will follow the existing tone in `gateway-proof.tsx`/`recon-row.tsx` (plain-sentence explanations aimed at a bookkeeper, not an engineer).
- Component/file naming (`RecordPaymentsBar`, `RecordPaymentsDialog`) may shift slightly during implementation if a clearer name emerges — the underlying architecture in this doc is what's fixed.
