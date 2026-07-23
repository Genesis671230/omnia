# Reconciliation Search, Grouping, Insights & Zoho Posting — Design Spec

Date: 2026-07-23
Status: Approved by founder, ready for implementation planning

## Context

Two prior specs shipped the *correctness* layer of reconciliation:

- `2026-07-16-recon-gateway-hardening-design.md` made every gateway's bank credit
  matchable (COD/Checkout parsers, per-order `transactions[]` from Tabby/Tamara).
- `2026-07-23-recon-proof-fx-legibility-design.md` made a matched credit *provable* —
  engine-level FX rescale plus a per-order proof table for every non-Stripe gateway,
  so the rows always foot to the bank's real wire rate.

Both are shipped and present in `components/finance/finance-workspace.tsx` today
(`GatewayProof`, `ReconRow`, `rateDriftAed`/`fxFeeAed` on `ReconLine`).

This spec is the *navigation and action* layer. The founder's framing, reviewing the
live page: the reconciliation view now proves individual rows correctly, but with 115
credit lines and 24,084 orders it offers no way to **find** a transaction, no way to
**group** what you are looking at, no way to see **product-level detail** behind a
settled order, and no way to **act** on a proven row — the numbers are right and then
the trail goes cold. A separate strand: `lib/integrations/zoho-banking.ts` and
`POST /api/integrations/zoho/post-payout` exist and are tested, but nothing in the UI
can reach them, and the account mapping they need lives only in environment variables.

## Scope

In scope:

1. Search across everything on a reconciliation row.
2. Grouping by gateway / date / status, with per-group subtotals.
3. Per-order product detail, expandable from inside the proof table.
4. A row action bar: Zoho posting, product view, file download / CSV export, copy
   reference, flag for review.
5. An Insights tab with four analytical views.
6. A Zoho account-mapping UI in `/settings`, replacing env-var configuration.
7. Two data-integrity additions the above make necessary (§6).

Out of scope, deferred to their own passes:

- Grouped drag-and-drop payout upload UX (deferred by the July 23 proof spec, still
  deferred here — independent component, no blocking dependency).
- Changing `createZohoCustomerPayment` to deposit into the gateway clearing account
  (§8 — an accounting decision, not a code decision).

## Architecture

### 1. Module extraction

`components/finance/finance-workspace.tsx` is 952 lines and holds the reconciliation
view, the top nav, the KPI bar, the upload button, and a ~150-line CSS template string.
Every feature in this spec lands inside the reconciliation view; adding them in place
takes the file past ~2,200 lines, past the point where either a human or an agent can
reliably edit it.

Extract to `components/finance/reconciliation/`:

| File | Responsibility |
|---|---|
| `recon-view.tsx` | Orchestrator: data fetch, filter/tab state, group assembly |
| `recon-filters.tsx` | Search input, date range + presets, group-by selector |
| `recon-group.tsx` | Collapsible group header: chip, count, subtotal, state-split bar |
| `recon-row.tsx` | The bank → payout → orders chain row (moved, then extended) |
| `gateway-proof.tsx` | Proof table + per-order product expansion |
| `recon-actions.tsx` | Row action bar (§5) |
| `insights-tab.tsx` | The four Insights views |
| `zoho-post-dialog.tsx` | Dry-run preview → post confirmation |

And `lib/reconciliation/insights.ts` — **pure functions only** (aging buckets, fee-rate
aggregation, timeline series, exception rollups). No React, no fetch. This is what the
tests target; the chart components stay thin renderers over its output.

`finance-workspace.tsx` retains the nav, header, KPI bar, `UploadButton`, and the CSS
block, and renders `<ReconView/>` exactly the way it already renders `<OrdersLedger/>`.
`ReconLine`, `StripeProof`, and `ReconPayload` types move to
`components/finance/reconciliation/types.ts` and are imported by both.

**Theme constraint.** The design tokens (`--gold`, `--ink`, `--cream`, …) are declared
on `.wrap`, not `:root`. Extracted components render inside `.wrap` and inherit them
normally. The Zoho post dialog renders through a portal, outside `.wrap`, and therefore
must use self-contained hex values — the same failure mode and fix as the invoice/ship
modal.

### 2. Search

A single input filtering the already-loaded lines client-side. There are ~115 lines in
memory; a server round trip per keystroke would be slower and would fight the 60-second
poll already running in `refresh()`.

Match target — the concatenation of, per line: `narration`, `reference`, `id`,
`provider`, `payout.id`, `payout.source`, `resolvedOrders[]`, `unresolvedRefs[]`,
`refundedOrders[]`, and `transactions[].ref`.

Semantics: lowercase both sides, split the query on whitespace, require **every** token
to appear somewhere in the target (AND). `tabby 55131` narrows to Tabby credits touching
order 55131. Debounce 150 ms.

Search composes with — does not replace — the state tabs and the date range.

### 3. Date range and presets

The existing server-side `from`/`to` behaviour is unchanged and must stay server-side:
`GET /api/reconcile` deliberately runs matching over *all* data and filters only the
returned lines, because a payout can straddle a range boundary. Filtering dates on the
client would silently change which credits match.

Added: preset buttons — `Today`, `7d`, `30d`, `This month`, `Last month` — that set
`fromDate`/`toDate` and let the existing `refresh()` effect re-fetch.

### 4. Grouping

`Group by: Gateway (default) | Date | Status | None`.

Each group renders a `recon-group.tsx` header containing:

- the gateway color chip (§7) when grouping by gateway,
- the group label,
- credit count,
- total AED across the group's `bankAmount`,
- a thin stacked bar splitting settled / awaiting / exception by amount,
- a chevron; groups are collapsible and default to expanded.

Group ordering: by total AED descending for Gateway and Status; newest-first for Date
(keyed on `date.slice(0, 10)`, with null dates in a trailing "No date" group).

Grouping applies to whatever the active tab and filters have already narrowed to — the
counts in a group header always reflect what is visible, never the unfiltered set.

### 5. Per-order product detail

Clicking an order row inside the proof table expands it in place, showing: SKU, product
name, quantity, unit price, line total, plus the order's customer name, city, country,
fulfillment stage, and AWB number when shipped.

**New endpoint:** `GET /api/reconcile/line/:bankLineId/orders`

Returns full order detail — including `line_items` — for every order referenced by that
credit, in one request. Fetched lazily the first time a row's proof table is opened, so
every subsequent order click is instant.

Why one batched endpoint rather than per-order `GET /api/orders/:uid` calls: the proof
table knows order *numbers* (`WA55131`), not `uid`s, so each click would need a lookup
anyway, and a five-order Stripe payout would cost five round trips. `OrdersRepository`
already batches `order_number → uid` resolution (`.in("order_number", …)`, chunked at
200) — that method is extended to select `line_items` alongside the existing columns,
or a sibling method is added next to it.

The endpoint resolves the bank line through `runReconciliation()` the same way
`post-payout` does, so it sees exactly the refs the UI is displaying.

### 6. Row actions

A single action bar on the expanded row. The two existing actions — `Confirm settlement`
(founder-gated) and `Upload {provider} payout file` — keep their current behaviour and
gating and move into this bar unchanged; the actions below join them.

**Zoho Books posting.** `Preview posting` calls the existing endpoint with
`dryRun: true` and renders the returned `postings[]` — the transfer_fund net leg and the
fee leg, with their account names — in a dialog. `Post to Zoho Books` re-calls without
`dryRun`. Both are enabled only when `state === "SETTLED"` and `confirmedBy` is set; the
API already refuses otherwise with 409, and the UI mirrors that rule rather than
discovering it after a click.

**View products.** Per order, inside the proof table (§5).

**Download payout file.** Resolves the credit's `payout.source` (the original filename)
against `uploaded_files` by `(provider, filename)` and links to `/api/files/:id`. When no
matching upload exists — e.g. a payout pulled from a gateway API rather than a file —
the button is absent, not disabled-with-no-explanation.

**Export row CSV.** Client-side serialization of the proof table (order, gross, fee, net,
refund flag) plus a header block carrying the bank reference, date, gateway, payout ID,
and net — an accountant-ready artifact for one credit.

**Copy reference.** Copies the bank reference to the clipboard.

**Flag for review.** Toggles a persisted flag (§7) with an optional note. A flagged row
appears under the Exceptions tab even when its math foots, and carries a visible marker
in every view.

### 7. Data-integrity additions

**`zoho_postings` — double-post protection.**

`POST /api/integrations/zoho/post-payout` currently keeps no record of what it has
already written. It is safe as a manual API call and unsafe as a button: two clicks
double-count real money in the books. `buildPayoutPostings` derives a stable
`referenceNumber` from the bank reference, but nothing verifies Zoho rejects a duplicate
of it, and correctness here must not depend on that assumption.

```sql
create table if not exists zoho_postings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'omnia',
  bank_line_id   text not null,
  gateway        text not null,
  payout_id      text,
  reference_number text not null,
  net_aed        numeric not null default 0,
  gross_aed      numeric not null default 0,
  fee_aed        numeric not null default 0,
  zoho_result    jsonb not null default '[]',
  posted_by      text not null default '',
  posted_at      timestamptz not null default now()
);
create unique index if not exists zoho_postings_bank_line_idx on zoho_postings (bank_line_id);
```

The endpoint checks for an existing row before posting and returns `409` with the prior
posting's details if found. `dryRun` never writes. The UI renders **Posted ✓** with the
Zoho transaction reference in place of a live button whenever a posting exists, so the
refusal path is something the founder sees rather than something they trigger.

**`recon_lines` review flags.**

```sql
alter table recon_lines add column if not exists review_flag boolean not null default false;
alter table recon_lines add column if not exists review_note text not null default '';
```

No new table: `recon_lines` is already the per-credit audit row and already carries
`confirmed_by`/`confirmed_at`. Written by `POST /api/reconcile/flag`
(`{ bankLineId, flagged, note }`), read back through `runReconciliation()` onto
`ReconLine`.

**Both migrations must be applied, not just written.** Editing `db/schema.sql` does not
touch the live database; `node db/apply-schema.mjs` must run. A column referenced in code
but absent from the database 500s the entire `/api/reconcile` response, taking the whole
page down rather than degrading one field.

### 8. Insights tab

A fifth tab beside All / Settled / Awaiting / Exceptions. All four views are computed
client-side from the `/api/reconcile` payload the view has already loaded, via the pure
functions in `lib/reconciliation/insights.ts`. No second endpoint — a separate aggregation
route would be a second source of truth for the same numbers, free to drift from the rows
below it.

**Cash in transit + aging.** Sum of `bankAmount` over `AWAITING_PAYOUT` lines, grouped by
gateway and bucketed by age from `date`: 0–7d, 8–14d, 15d+. Answers who is holding the
money and for how long — the actionable form of today's flat "AED 1,199,556 across 92
lines" KPI. The 7-day threshold matches the existing `overdue` rule in `ReconRow`.

**Fee burn per gateway.** Effective rate `Σ feeShare ÷ Σ grossShare` per gateway over the
filtered range, in AED and percent, ordered by AED. Gateways whose lines carry no
`transactions[]` are shown as "no per-order data" rather than as 0% — a missing breakdown
is not a free gateway.

**Settlement timeline.** Bank credits per day (count and AED), stacked by state.

**Exceptions + FX drift.** Variance totals by gateway, unresolved order counts, and
`rateDriftAed` / `fxFeeAed` per cross-border payout — the SAR/KWD Tabby and Tamara cases
where the bank's quoted wire rate diverges from the static estimate.

Every view respects the active search and date range, so switching between Insights and
the row tabs describes the same set of credits throughout. The state tabs (Settled /
Awaiting / Exceptions) do not apply while Insights is active — Insights is itself one of
those tabs, and each of its four views already splits by state internally.

Chart implementation follows the `dataviz` skill, loaded before any chart code is written.

### 9. Gateway color system

One map, `GATEWAY_COLORS`, in `components/finance/reconciliation/colors.ts`, keyed by
provider (`Stripe`, `Tabby`, `Tamara`, `Checkout`, `COD`, `Telr`, `Unclassified`) and
consumed by group headers, row chips, and every Insights chart. Tabby is the same color
everywhere or the color carries no information.

Values are chosen against the `--cream` (#FBF8F1) page background under the `dataviz`
skill's contrast rules, and must remain distinguishable in the stacked state-split bars
where they sit adjacent.

### 10. Zoho account mapping in Settings

`accountMapFromEnv()` reads `ZOHO_BANK_ACCOUNT_ID`, `ZOHO_FEE_ACCOUNT_ID`, and a JSON
`ZOHO_CLEARING_ACCOUNTS`. This is fine for a one-off API call and wrong for a button:
the mapping is invisible from the app, a wrong ID surfaces only at post time, and it
does not survive a redeploy without an env edit.

New: a Zoho section in `/settings` that calls `GET /api/integrations/zoho/bank-accounts`
(which already lists accounts *and* flags configured-but-nonexistent IDs) and renders a
dropdown per gateway plus the bank and fee accounts. Saved to:

```sql
create table if not exists zoho_account_config (
  id         text primary key default 'omnia',
  tenant_id  text not null default 'omnia',
  bank_account_id text not null default '',
  fee_account_id  text not null default '',
  clearing_by_gateway jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
```

`accountMapFromEnv()` is joined by `accountMap()`, which reads the DB row and falls back
to the env values for any field the DB leaves empty. `ZohoAccountMap` is already plain
data passed into `buildPayoutPostings` (deliberately, per its own comment, so the posting
math is testable without an environment), so this is a substitution at one call site —
the posting logic and its nine existing tests are untouched.

Nothing breaks before the mapping is filled in: env remains the fallback, and
`zohoBankingConfigured()` is extended to consider the DB row.

## Error handling

- **Zoho not authorized.** The current token is scoped `ZohoInventory.fullaccess.all`;
  Books banking requires `ZohoBooks.banking.CREATE` + `.READ`. The existing 401 handler
  already says so explicitly rather than reporting an expired token. The Settings UI
  surfaces that message verbatim instead of showing an empty account list.
- **Post failure.** `buildPayoutPostings` refusals (bad mapping, impossible figures) are
  the caller's problem to fix; a Zoho HTTP failure is not. The endpoint already separates
  them and the dialog keeps them distinct.
- **Partial post.** The net leg succeeding and the fee leg failing strands money in the
  clearing account. On a partial failure the `zoho_postings` row is written with the
  partial `zoho_result` and the row renders a "needs manual completion" state — visibly
  wrong beats silently half-done.
- **Missing order detail.** An order in `transactions[]` with no matching synced order
  renders "not in synced orders — run a sync" in place of products, consistent with the
  existing `ORDERS_UNRESOLVED` copy.
- **Empty filtered set.** Search or range matching nothing renders an empty state naming
  the active filters, not the generic "no bank credits imported yet" copy, which would
  misdiagnose a filter as missing data.

## Testing

- `lib/reconciliation/insights.ts` — unit tests per function against fixture
  `ReconLine[]`: aging bucket boundaries (exactly 7 and 14 days), fee rate with zero
  gross, gateways with no `transactions[]`, timeline with null dates, empty input.
- Search predicate — extracted as a pure function and tested for token AND semantics,
  case insensitivity, and matching on order numbers nested inside `transactions[]`.
- Grouping — subtotals equal the sum of member lines; a line appears in exactly one group.
- `zoho_postings` idempotency — a second post attempt returns 409 and writes no second row.
- `accountMap()` — DB row wins, env fills gaps, neither present is a clear refusal.
- The nine existing `tests/integrations/zoho-banking.test.ts` cases must continue to pass
  untouched; if the mapping change requires editing them, the substitution was done wrong.

## Open item, outside this spec

`createZohoCustomerPayment` does not set a deposit account, so the per-order customer
payments already being written land in Zoho's default account rather than the gateway
clearing account. Posting payouts *out of* clearing accounts while payments land
elsewhere will leave those clearing balances drifting, and historical payments may need
an adjusting entry.

This is a bookkeeping decision, not a code decision, and it should be settled with
whoever keeps the books before the first live post. It is recorded here so it is not
rediscovered as a bug later.
