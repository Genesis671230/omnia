# Zoho Publish Safety Hardening — Design

Date: 2026-07-18
Status: **approved, not yet implemented**
Plan: (to be written — `docs/superpowers/plans/2026-07-18-zoho-publish-safety.md`)
Amends: `docs/superpowers/specs/2026-07-18-settlement-confirmation-zoho-publish-design.md`
        (Flow 3 — that design predates this finding and has no idempotency story)

## Why this spec exists

A code review of `POST /api/settlements/publish` (real-money path: writes
Customer Payments to Zoho Books) found it re-checks `evidence_confirmed` /
`zoho_payment_id` via a fresh `SELECT`, then writes via
`SettlementsRepository.markPublished()` — an unconditional `UPDATE ... WHERE
id=?` — with no DB unique constraint and no idempotency key sent to Zoho.
Two concurrent `POST` calls for the same settlement, or a client retry after
`markPublished` fails post-Zoho-success, create two real Customer Payments in
Zoho Books for one settlement. Confirmed by reading `db/schema.sql` (only a
non-unique index on `zoho_payment_id`) and `lib/repositories/settlements.repository.ts`
(`markPublished` has no conditional `WHERE` clause beyond `id`).

Not yet wired to any UI button and sits behind session auth, so nothing has
fired against real Zoho data — this closes the gap before a "Publish" button
is exposed.

Also folds in four smaller findings from the same review, since they touch
the same route/file.

## Design

### 1. Atomic claim before calling Zoho

`SettlementsRepository` gains a new method, used in place of the current
"SELECT unconfirmed check, then call Zoho, then markPublished" sequence:

```ts
// Attempts to atomically claim a settlement for publishing. Returns true iff
// this call won the race — Postgres serializes concurrent UPDATEs to the same
// row, so if two requests race, the loser's WHERE clause no longer matches
// after the winner commits (zoho_payment_id is no longer null) and it gets
// zero affected rows back.
async claimForPublish(id: string, attemptId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("settlement_records")
    .update({ zoho_payment_id: `CLAIMED:${attemptId}` })
    .eq("id", id)
    .eq("evidence_confirmed", true)
    .is("zoho_payment_id", null)
    .select("id");
  if (error) throw new Error(`settlement_records claim failed: ${error.message}`);
  return (data ?? []).length === 1;
}

async releaseClaim(id: string, attemptId: string): Promise<void> {
  // Only clears the claim if it's still OUR claim — a completed publish or a
  // different in-flight attempt must never be clobbered by a stale release.
  const { error } = await supabase
    .from("settlement_records")
    .update({ zoho_payment_id: null })
    .eq("id", id)
    .eq("zoho_payment_id", `CLAIMED:${attemptId}`);
  if (error) throw new Error(`settlement_records release failed: ${error.message}`);
}
```

`markPublished(id, paymentId)` stays as-is — it overwrites whatever sentinel
is in `zoho_payment_id` with the real payment ID, no `WHERE` change needed
since only the winning claimant reaches this call.

### 2. Route logic

`app/api/settlements/publish/route.ts` per-settlement loop becomes:

1. `claimForPublish(s.id, attemptId)` — if `false`, push
   `{ ok: false, error: "Already published or being published" }` and
   continue (no Zoho call attempted).
2. Look up the Zoho invoice and validate amount (item 3 below) before
   creating the payment — a rejected amount should never consume the claim
   silently; release it and report the specific reason.
3. `createZohoCustomerPayment(...)`.
   - Success → `markPublished(s.id, payment_id)`.
   - Clean rejection (Zoho responds with a definite error, e.g. invoice not
     found, ambiguous match, validation error) → `releaseClaim(s.id, attemptId)`,
     report the error, safe to retry later.
   - Ambiguous failure (network timeout, 5xx, or any error where we can't
     tell if Zoho's write actually landed) → **do not** release the claim.
     Report `{ ok: false, error: ..., needsManualReview: true }`. The
     `CLAIMED:<attemptId>` sentinel staying in place is deliberate — it blocks
     further auto-retries on this row until someone checks Zoho directly and
     either clears it (nothing was created) or the real `payment_id` is
     recorded manually.
4. Defense-in-depth dedup: before step 3's `POST`, `createZohoCustomerPayment`
   first checks the already-fetched invoice's payment history (Zoho's invoice
   lookup response includes applied payments) for one whose `reference_number`
   already matches this settlement's `bank_reference` — if found, adopt that
   `payment_id` instead of creating a new payment. Covers the case where a
   prior ambiguous-failure attempt actually succeeded in Zoho.

### 3. Amount validation against the actual invoice balance

`createZohoCustomerPayment` already fetches the matched invoice (for
`invoice_id`/`customer_id`) before posting the payment. Add a check using
that same response's `balance` field: if `input.amount > invoice.balance`
(allow a small rounding tolerance, e.g. 0.01 AED, for FX conversion drift),
throw a descriptive error rather than posting an over-applied payment.
Under-payment (partial settlement) is allowed — that's a legitimate partial
match, not an error.

### 4. Reuse `normalizeRef()` for invoice lookup

`lib/inventory-compare.ts`'s `normalizeRef()` already exists to absorb
Zoho's reference-number formatting drift (leading zeros, store prefixes,
etc.) — the exact problem `createZohoCustomerPayment`'s
`reference_number=input.invoiceReferenceNumber` lookup is exposed to today.
Apply `normalizeRef()` to `input.invoiceReferenceNumber` before the Zoho
`GET /invoices?reference_number=...` call, and compare against
`normalizeRef(invoice.reference_number)` rather than an exact string match,
so legitimate settlements don't get stuck as "no invoice found" over a
formatting mismatch.

### 5. Gateway → Zoho payment-mode mapping

`zohoPaymentModeFor` currently maps every non-COD gateway to `"Bank
Transfer"`, erasing which gateway actually paid — defeats the audit trail's
purpose. Extend the map:

```ts
const map: Record<string, string> = {
  COD: "Cash on Delivery",
  Stripe: "Stripe",
  Tabby: "Tabby",
  Tamara: "Tamara",
  "Checkout.com": "Checkout.com",
};
```

Zoho's `payment_mode` field accepts arbitrary text (confirmed by the
existing `/customerpayments` GET probe returning varied values) so this is
not constrained to a fixed enum on Zoho's side. Anything not in the map
still falls back to `"Bank Transfer"`.

### 6. Audit trail

New table, same shape as the existing `sync_runs`/`zoho_sync_runs`/`ad_sync_runs`
pattern:

```sql
create table if not exists zoho_publish_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'omnia',
  trigger       text not null default 'manual',   -- always 'manual' today; column kept for pattern consistency
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  results       jsonb not null default '[]',       -- [{settlementId, ok, error?, paymentId?, needsManualReview?}]
  error         text
);
create index if not exists zoho_publish_runs_started_idx on zoho_publish_runs (started_at desc);
```

The route writes one row per `POST /api/settlements/publish` call —
`started_at` at request start, `results` + `finished_at` after the batch
loop completes. Mirrors how `sync_runs` is written by the payout-sync
scheduler (`lib/repositories/sync-runs.repository.ts` — reuse that file's
pattern, add a `ZohoPublishRunsRepository` alongside it or a method on the
same repository if one already generalizes across the `*_sync_runs` tables;
confirm which during implementation by reading that file).

### 7. Batch OAuth efficiency + cleanup

- `getAccessToken()` is currently called once per settlement inside
  `createZohoCustomerPayment`. Fetch it once per batch in the route handler
  and pass it into `createZohoCustomerPayment(input, accessToken)` instead
  (function signature gains a required `accessToken: string` param).
- Remove the redundant `INVENTORY_BASE` alias in `lib/integrations/zoho.ts`
  (`const INVENTORY_BASE = API_BASE`) — use `API_BASE` directly at its two
  call sites.
- `getAccessToken` no longer needs to be exported once the route fetches it
  once and threads it through — un-export it unless another caller outside
  `lib/integrations/zoho.ts` uses it (check via grep before removing the
  `export` keyword).

## Data model changes

```sql
-- No new columns on settlement_records — the claim mechanism reuses the
-- existing zoho_payment_id column with a "CLAIMED:<uuid>" sentinel value,
-- distinguishable from a real Zoho payment_id (Zoho's IDs are pure numeric
-- strings) by any code that reads this column for display purposes. The
-- Settlements UI's "published" badge check (zoho_payment_id != null) must
-- be updated to also check it doesn't start with "CLAIMED:" — treat a
-- CLAIMED row as "publishing" state, not "published", in any UI that reads
-- this column (confirm no such UI exists yet before implementation; per the
-- original design doc, the Settlements panel is not yet built).

create table if not exists zoho_publish_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'omnia',
  trigger       text not null default 'manual',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  results       jsonb not null default '[]',
  error         text
);
create index if not exists zoho_publish_runs_started_idx on zoho_publish_runs (started_at desc);
```

Per this project's established workflow, this migration does not auto-apply
— `db/schema.sql` changes must be run against the live Supabase instance
manually (SQL editor) before the audit-trail write will succeed; flag this
in the final summary.

## Error handling

- A claim failure (`claimForPublish` returns `false`) is not an error — it's
  the expected outcome for "someone already published this" or "already
  being published right now," reported per-row exactly like today's
  `"Already published"` case.
- An ambiguous Zoho failure leaving a `CLAIMED:` sentinel in place is a
  deliberate fail-safe, not a bug — it trades "this settlement is stuck
  until a human looks" against "silently risk a duplicate payment." Flagged
  via `needsManualReview: true` in the response so the (future) UI can
  surface it distinctly from a plain retry-able failure.
- `zoho_publish_runs.error` captures only a batch-level failure (e.g. the
  whole request body was malformed) — per-settlement errors live in
  `results`, matching the existing per-row isolation pattern already used
  by this route and by Meta ads account isolation elsewhere in the repo.

## Testing

- Unit test `zohoPaymentModeFor` for each mapped gateway + the fallback.
- Unit test the amount-vs-balance validation logic (pure function, extract
  if not already) — exact match, within-tolerance rounding, over-amount
  rejection, under-amount (partial) allowed.
- Unit test `normalizeRef()` reuse via a fixture pair of formatting-drifted
  reference numbers that should match.
- `claimForPublish`/`releaseClaim` are DB-touching glue — manual
  verification only, per this project's established testing convention (no
  Supabase mocks exist anywhere in this repo). Manually verify: two rapid
  sequential calls to `/api/settlements/publish` with the same
  `settlementId` — second call must report "already published or being
  published," not attempt a second Zoho write.

## Out of scope

- Building the Settlements UI panel / "Publish" button itself — still not
  wired to any frontend, per the original design's scope. This hardening
  makes the route safe for whenever that UI lands.
- Retroactively reconciling any `CLAIMED:` sentinels — none exist yet since
  the route has never been called against real data.
- Changing Zoho's own API to support a true idempotency key — no such
  parameter exists on `/inventory/v1/customerpayments` (confirmed against
  the live API surface used elsewhere in this file); the claim + defense-in-depth
  dedup above is the mitigation available without one.
