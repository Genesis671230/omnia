# Order Row Journey + Customer Journey Enrichment + Phone Fallback — Design

Date: 2026-07-18
Status: **approved, not yet implemented**
Plan: (to be written — `docs/superpowers/plans/2026-07-18-order-customer-journey.md`)

## Why this spec exists

Three related, founder-reported UX problems in the Orders and Customers
views:

1. A collapsed order row shows a blunt **"Missing Payout"** pill whenever a
   payout file hasn't been seen yet for a genuinely new order — reads as
   broken/embarrassing at a glance, when it's often just "too new to expect
   a payout file." The actual settlement chain (order → payout file seen →
   bank settled) is only ever shown in full server-side data, never
   surfaced to the row itself.
2. The customer drawer (`/customers`, already built and wired) shows a flat
   list of a customer's orders — number, store, date, gateway, amount — with
   no settlement or shipping status per order, so "see this customer's full
   journey" stops at "here are their orders," not "here's what happened to
   each one."
3. Customer phone numbers are frequently blank even though the column,
   ingestion mapping, and UI display all exist — traced to
   `lib/normalize/order.ts:93` only reading `raw.customer?.phone` (Shopify's
   marketing-profile phone, commonly unset) while ignoring
   `raw.shippingAddress?.phone` (populated from checkout, already fetched by
   the GraphQL query in `lib/integrations/shopify.ts:39` but unused).

## Design

### 1. Phone fallback (Shopify normalizer)

`lib/normalize/order.ts`, `normalizeShopifyOrder`:

```ts
// was:
customer_phone: raw.customer?.phone || "",
// becomes:
customer_phone: raw.shippingAddress?.phone || raw.customer?.phone || "",
```

Woo's `normalizeWooOrder` already reads `raw.billing?.phone`, which is the
correct/equivalent field on that side — no change needed there.

This only affects newly-synced orders (normalization runs at sync time, not
read time) — existing rows with a blank phone stay blank until their next
sync pulls fresh data from the store. No backfill migration: Shopify's sync
already re-fetches and re-normalizes every order it touches on each run
(confirmed by reading the existing sync path — `upsertMany` overwrites
matching `uid` rows), so phone numbers self-correct on the next scheduled
sync without any one-off script.

### 2. Order row: journey instead of a blunt badge

`components/finance/orders-ledger.tsx`:

**Collapsed row** (`ORDER_STATUS_META`, `lib/types/orders.ts`): change the
`MISSING_PAYOUT` entry's tone from `"muted"` (looks like an error state) to
match `AWAITING_BANK`'s neutral treatment — same pill color, label changes
from "Missing payout" to **"Processing"** so the row itself never implies
something's wrong. The underlying `finance_status` value and API contract
are unchanged; this is a presentation-only change to `ORDER_STATUS_META`.

**Expanded row** (`ExpandedOrder`): add a "Settlement" section (next to the
existing "Ship to"/"Items" grid) rendering the actual chain as a 3-step
tracker, visually consistent with the existing `StageTracker`
(processing/packed/shipped/delivered) pattern already in this file:

```
Order placed  →  Payout file seen  →  Bank settled
   ✓ <date>        ✓ <date> | ○ waiting (Nd)      ✓ <date> | ○ —
```

Data needed is already computed server-side per order
(`finance_status`/`in_payout_file` from `/api/orders`) — no new API field
required for the first two steps. The "waiting (Nd)" sub-label for a
not-yet-seen payout file needs the order's age, already available as
`order.order_date`; compute `daysSince` client-side, no backend change. The
third step ("bank settled" date) needs the actual settlement date, which
today only exists in `settlement_records.settlement_date` — **not** on the
`/api/orders` payload. Options considered:

- **(Recommended) Add `settled_at` to the order detail response only**
  (`GET /api/orders/:uid`, not the list response) — a single extra lookup
  against `settlement_records` by `order_uid` when fetching one order's
  detail (already a per-order fetch on row-expand, so this adds one more
  targeted query to an already-targeted call, not a new list-wide cost).
- Reject: joining `settlement_records` into the paginated list query — would
  undo the pagination-perf work in the sibling `orders-pagination-perf`
  spec by adding a join across a growing table to every list page fetch, for
  data only needed once a row is actually expanded.

Go with the first option: `app/api/orders/[uid]/route.ts` gains a lookup of
the matching `settlement_records` row (if any) by `order_uid`, and the
response includes `settled_at: string | null`.

### 3. Customer drawer: per-order journey fields

`app/api/customers/route.ts`'s per-order mapping (the `orders: g.allOrders...map(...)`
block) currently emits `{ uid, order_number, store_id, order_date, gross_aed,
currency, gateway, financial_status, fulfillment_status }`. The
`finance_status`/`in_payout_file` computation already exists in
`app/api/orders/route.ts` (needs `PayoutsRepository.listWithRefs()` cross-
referenced against `refsSeen`) — duplicate that same computation here (it's
a cheap, already-paginated-independent in-memory pass, and `/api/customers`
already fetches all orders via `OrdersRepository.listAll()`) so each
customer-order row gains:

```ts
finance_status: "SETTLED" | "AWAITING_BANK" | "MISSING_PAYOUT" | "COD_PENDING",
fulfillment_stage: string,  // "processing" | "packed" | "shipped" | "delivered"
```

`CustomerDrawer`'s `cd-order-row` in `components/finance/customers-panel.tsx`
gains two more columns showing these — reuse `ORDER_STATUS_META` (import
from `lib/types/orders.ts`, same source the orders ledger uses, so the two
views never show inconsistent labels/colors for the same status) for the
finance pill, and a small fulfillment-stage label (no need for the full
interactive `StageTracker` here — this view is read-only, not a place to
change an order's stage).

### 4. Shared status-computation helper (avoid drift)

Since step 3 needs `/api/customers` to compute `finance_status` the same way
`/api/orders` does, extract that block (`refsSeen` building +
`financeStatus` derivation, currently inline in
`app/api/orders/route.ts:18-39`) into a shared function:

```ts
// lib/orders-finance-status.ts
export function computeFinanceStatuses<T extends { order_number: string; gateway: string; payout_status: string }>(
  orders: T[],
  payouts: { order_refs: string[] }[],
): (T & { in_payout_file: boolean; finance_status: OrderRow["finance_status"] })[]
```

Both routes call this instead of each maintaining their own copy — the
kind of small shared-logic extraction this project already does elsewhere
(`lib/orders-locations.ts` from the sibling pagination-perf plan is the same
pattern: pull a piece two call sites both need into one place before a
second inline copy is written).

## Data flow after this change

```
Order row (collapsed)
  → finance_status still MISSING_PAYOUT under the hood, but shown as a
    neutral "Processing" pill — no visual alarm

Order row (expanded)
  → GET /api/orders/:uid → adds settled_at (from settlement_records lookup)
  → Settlement tracker renders: placed ✓ → payout file (✓ or "waiting Nd")
    → bank settled (✓ <date> or —)

Customer drawer
  → GET /api/customers → each order row now carries finance_status +
    fulfillment_stage (via the new shared computeFinanceStatuses helper,
    same source of truth /api/orders uses)
  → CustomerDrawer's order rows show a finance pill + fulfillment stage
    label alongside the existing gateway/amount/date columns
```

## Error handling

- `GET /api/orders/:uid`'s new `settlement_records` lookup: if no matching
  row exists (order not yet settled, or pre-dates settlement tracking),
  `settled_at` is simply `null` — the tracker's third step shows "—", not an
  error state.
- `computeFinanceStatuses` is a pure function over already-fetched data — no
  new failure mode; both call sites keep their existing try/catch → JSON
  error response pattern unchanged.

## Testing

- Unit test `computeFinanceStatuses` — settled, awaiting-bank (ref seen in a
  payout file), missing-payout, COD-pending cases, plus the store-prefix
  stripping behavior (`ref.replace(/^(WA|UAE|KSA|WOO)/i, "")`) already
  covered implicitly today but not under a dedicated test.
- Unit test the phone fallback logic if extracted as a pure function (or
  cover via a `normalizeShopifyOrder` fixture test with
  `shippingAddress.phone` set and `customer.phone` unset, and the reverse).
- Manual verification (per this project's `verify` skill): a new/unsettled
  order shows a neutral "Processing" pill collapsed and the full
  placed→payout→settled tracker on expand; a settled order shows all three
  steps checked with real dates; a customer with mixed-status orders shows
  each order's own finance/fulfillment state in the drawer, not a single
  aggregate; a freshly-synced Shopify order with only a shipping-address
  phone (no customer-profile phone) shows that number in both the orders
  ledger and customer drawer.

## Out of scope

- Changing the underlying `finance_status` state machine or its
  server-side derivation logic — this is presentation + one additive field
  (`settled_at`), not a reconciliation-logic change.
- A backfill script for historically-blank phone numbers — self-corrects on
  next sync, per the reasoning in section 1.
- Invoice polish (separate, tracked outside this spec — needs a visual look
  at the current dual-template invoice output before speccing specific
  changes).
