# Persisted Customers Table + Full-History Backfill — Design

Date: 2026-07-20
Status: **approved, implementing**
Amends: `docs/superpowers/specs/2026-07-20-orders-two-year-backfill-design.md`
        (extends its backfill script to an all-time mode; adds the
        customer-tracking piece explicitly deferred there)

## Why this spec exists

Two follow-ons requested after the 2-year backfill landed (24,024 orders
across WA/UAE/KSA/WOO, zero errors):

1. Extend the historical pull from 2 years to full all-time history per
   store.
2. Persist customers into their own Supabase table, derived from orders —
   not fetched separately from each store's native Customers API — so
   customer tracking (LTV, cross-store journey, tiering) doesn't depend on
   re-aggregating the entire order book on every request.

`app/api/customers/route.ts` already does customer identity resolution
(email first, normalized-phone fallback) and LTV/tier computation, entirely
in-memory per request, with an explicit comment that this is "cheap" at
current order volume. That logic is the source of truth for this design —
it gets extracted into shared pure functions rather than duplicated, so the
live API and the new persisted table can never quietly drift apart.

## Design

### 1. All-time backfill

`scripts/backfill-orders.ts` gains an `--all` flag: when present, the
`sinceIso` cursor is fixed to `2000-01-01` instead of being computed from
`--days`, and `--days` is ignored. No changes needed to
`fetchShopifyOrders`/`fetchWooOrders` — both already paginate the full
result set regardless of how far back the starting cursor is; the retry/
backoff and Woo rate limiter already built handle the larger volume the
same way they handled the 2-year pull.

### 2. Shared customer-identity module

`lib/customer-identity.ts` (new) — extracted verbatim from
`app/api/customers/route.ts`:

```ts
export function normalizeEmail(email: string | null | undefined): string | null
export function normalizePhone(phone: string | null | undefined): string | null
export function customerIdentityKey(email: string | null | undefined, phone: string | null | undefined):
  { id: string; matchedBy: "email" | "phone" } | null
```

Same matching rule as today: email first (normalized, lowercased), else
the last 9 digits of phone (absorbs `+971`/`00971`/`971`/leading-0
variance), else no identity (order stays `customer_id: null` — matches
today's `unidentifiedCount` bucket).

### 3. `customer_id` stamped at sync time

`lib/normalize/order.ts`: both `normalizeShopifyOrder` and
`normalizeWooOrder` call `customerIdentityKey(...)` and add
`customer_id: string | null` to the returned `OrderRow`. This means
`customer_id` self-corrects on every future sync exactly the way the
existing phone-fallback fix does — no one-off migration script needed for
new/re-synced orders. For the 24,024 orders already in Supabase from the
prior backfill, a one-time `UPDATE` (via a small script,
`scripts/stamp-customer-ids.ts`) re-derives `customer_id` from each row's
already-stored `customer_email`/`customer_phone` without re-hitting any
store API — cheap, local, no rate-limit exposure.

`db/schema.sql`: `alter table orders add column if not exists customer_id
text;` plus `create index if not exists orders_customer_id_idx on orders
(customer_id);`. Per this project's established workflow, schema changes
don't auto-apply — `node db/apply-schema.mjs` must be run before any of
this lands on the live DB (flagged again in the final summary).

### 4. Shared aggregation function

`lib/customers/aggregate.ts` (new) — the per-customer math currently
inlined in `app/api/customers/route.ts` (`computeExpectedLtv`, total
spend/AOV/first-last-order-date derivation from a customer's valid orders)
extracted into:

```ts
export type CustomerAggregate = {
  id: string; matchedBy: "email" | "phone"; name: string; email: string; phone: string;
  stores: string[]; totalOrders: number; totalSpendAed: number; aov: number;
  firstOrderDate: string | null; lastOrderDate: string | null; expectedLtvNextYear: number;
};
export function aggregateCustomers(orders: OrderRowRaw[]): { customers: CustomerAggregate[]; unidentifiedCount: number }
```

Groups by `customer_id` (falling back to live `customerIdentityKey`
resolution for any row where the stored column is still null, e.g. rows
synced before this change lands) — same grouping outcome as today's route,
just callable from two places instead of one.

`tier`/`rank` are NOT part of `CustomerAggregate` — they're a relative
ranking across the whole current customer list (top 10 = VIP, next 40 =
Loyal), which only makes sense computed at read time over an already-sorted
list, not stored as a per-customer fact that could go stale independent of
everyone else's numbers. `app/api/customers/route.ts` keeps computing
`rank`/`tier` exactly as it does today, just from `aggregateCustomers()`'s
output instead of an inline loop. CAC-by-store-month also stays in the
route unchanged — it needs per-store first-order-date granularity that
doesn't belong in the top-level customers table, and is already a cheap
separate pass over the order list.

### 5. `customers` table + repository

```sql
create table if not exists customers (
  id                      text primary key,       -- 'email:<normalized>' | 'phone:<last9digits>'
  matched_by              text not null,
  name                    text not null default '',
  email                   text not null default '',
  phone                   text not null default '',
  stores                  text[] not null default '{}',
  total_orders            integer not null default 0,
  total_spend_aed         numeric not null default 0,
  aov_aed                 numeric not null default 0,
  first_order_date        timestamptz,
  last_order_date         timestamptz,
  expected_ltv_next_year  numeric not null default 0,
  updated_at              timestamptz not null default now()
);
create index if not exists customers_total_spend_idx on customers (total_spend_aed desc);
```

`lib/repositories/customers.repository.ts` (new):

```ts
async rebuildAll(): Promise<{ customerCount: number; unidentifiedCount: number }> {
  const orders = await OrdersRepository.listAll();
  const { customers, unidentifiedCount } = aggregateCustomers(orders);
  // upsert in chunks of 500, onConflict: "id" — full replace each rebuild,
  // stale rows (a customer whose only order was deleted/cancelled-out)
  // are acceptable drift here, not actively pruned; out of scope.
  ...
  return { customerCount: customers.length, unidentifiedCount };
}
```

### 6. Stays fresh automatically

`lib/sync/order-sync.service.ts`'s `syncAllStores()` calls
`CustomersRepository.rebuildAll()` once after all store jobs settle (not
per-store — one full rebuild per sync cycle, not four). `scripts/
backfill-orders.ts` does the same at the end of its run. Full rebuild each
cycle, not incremental per-touched-customer updates — matches the existing
route's own "cheap in-memory" judgment call at this row count (tens of
thousands, not millions), and avoids the real correctness hazard of partial
incremental updates: a customer's aggregate depends on ALL of their orders
across ALL stores, so a partial update touching only "orders changed in
this batch" would need to re-fetch that customer's full order history
anyway — at which point a full rebuild is simpler and no more expensive in
aggregate.

## Data flow

sync/backfill upserts orders (each stamped with `customer_id`) → all store
jobs settle → `CustomersRepository.rebuildAll()` reads the full order book
→ `aggregateCustomers()` → upsert `customers` table.

## Error handling

- `rebuildAll()` failing must not fail the order sync itself — orders are
  the source of truth; a customers-table rebuild is a derived view.
  `syncAllStores()` wraps the `rebuildAll()` call in its own try/catch,
  logs the error, and still returns the per-store `StoreSyncResult[]` as
  today (order sync succeeding or failing is reported independently of
  whether the customer rebuild succeeded).
- `scripts/stamp-customer-ids.ts` (one-time, DB-only, no store API calls):
  reads existing rows missing `customer_id`, computes it locally, updates
  in chunks; safe to re-run (idempotent — only touches rows where
  `customer_id is null`).

## Testing

- Unit tests for `customerIdentityKey` (email present, phone-only fallback,
  neither present, phone formatting variance) — pure function, no DB.
- Unit tests for `aggregateCustomers` — a small fixture set of orders
  across two customers/stores, assert totals/AOV/first-last-date/LTV
  projection match hand-computed expected values, and that a
  cancelled/refunded/voided order is excluded from spend the same way
  `app/api/customers/route.ts` already excludes it today.
- `CustomersRepository.rebuildAll()` / `stamp-customer-ids.ts` are
  DB-touching glue — manual verification only (this repo's established
  convention, no Supabase mocks exist anywhere): run the backfill with
  `--all`, run the stamp script, run `rebuildAll()`, spot-check the
  `customers` table row count and one known multi-store customer's
  `stores` array and `total_spend_aed` against manually adding up their
  orders.

## Out of scope

- Deleting/pruning `customers` rows whose underlying orders are gone
  (cancelled-only customers) — acceptable drift, not actively cleaned up.
- Changing `app/api/customers/route.ts`'s response shape/contract — it
  keeps returning the same JSON, just sourced from the shared aggregation
  function instead of an inline loop.
- Fetching customers directly from Shopify's/WooCommerce's own Customers
  APIs — explicitly not wanted; customers are derived from already-synced
  orders only.
- UI work (pipeline tracking, action buttons, color/contrast redesign) —
  still deferred to its own spec, unchanged from the prior backfill spec's
  scope cut.
