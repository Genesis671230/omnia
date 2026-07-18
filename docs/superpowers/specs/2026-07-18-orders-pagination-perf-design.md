# Orders pagination & dashboard fetch scope (Phase 1 of the perf/UX bundle)

Date: 2026-07-18
Status: **approved, not yet implemented**
Plan: (to be written — `docs/superpowers/plans/2026-07-18-orders-pagination-perf.md`)

## Why this spec exists

The founder reported the app feels slow across the board (Orders, Dashboard,
generally) and asked for pagination plus "state management tools ... memos, and
other ways" for a faster UX. The order book is confirmed to be **tens of
thousands of rows and growing**. Investigation found the actual bottleneck isn't
render-level (React.memo/useMemo were already used in 8 components) — it's that
`FinanceWorkspace` and `/api/dashboard` both fetch the **entire order history**
on every load via `OrdersRepository.listAll()`, which itself pages through
Supabase's 1000-row select cap in a loop specifically so callers get the full
book. At current scale that's an unbounded, ever-growing payload fetched and
reduced in JavaScript on every page view.

This spec covers **Orders page + Dashboard fetch pattern + the `FinanceWorkspace`
coupling that ties them together**, since fixing the fetch pattern is the
dominant lever at this data scale. Out of scope for this pass:

- **Customers panel** — has its own in-progress, uncommitted implementation
  (`components/finance/customers-panel.tsx`, `app/api/customers/`) that is the
  founder's own active work. Not touched here; the same pagination pattern can
  be applied to it later as a follow-up.
- **SQL-side aggregation (RPC functions) for the trend/gateway/top-products
  charts** — the date-windowed fetch fix below (item 4) already cuts Dashboard's
  fetched rows from "all-time" to "the selected day window," which should be
  sufficient. Migrating that JS reduction into Postgres RPC functions is a
  further optimization to revisit only if the windowed fetch still isn't fast
  enough in practice.
- Warehouse-aware shipment picking, proof-of-shipment upload, Zoho/store
  inventory write buttons, and the Ontrack logo asset — separate sub-projects
  from the same conversation, each needs its own spec.

## Current state (confirmed by reading the code)

- `orders` table has exactly one index: a unique index on `uid`
  (`db/schema.sql:43`). No index on `order_date`, `store_id`, or any text
  column used for search.
- `OrdersRepository.listAll()` (`lib/repositories/orders.repository.ts:22-35`)
  pages through the *entire* table in 1000-row chunks, every call, regardless
  of any date filter — "so the ledger and the reconciler always see the full
  order book" (existing comment).
- `/api/orders/route.ts` calls `listAll()` directly, no query params.
- `/api/dashboard/route.ts` also calls `listAll()` (full history), then
  filters to the `days` window **in JavaScript** (`inWindow = orders.filter(...)`)
  before computing KPIs/trend/gateways/top products.
- `FinanceWorkspace` (`components/finance/finance-workspace.tsx:446,466,470`)
  fetches `/api/orders` once into an `orders` state array used in exactly two
  places: the "Orders settled X/Y" KPI (line 628, a plain
  `orders.filter(...).length` over the full array) and
  `<OrdersLedger orders={orders} loading={loading} />` (line 646). The
  reconciliation `buckets` shown elsewhere on the same page are **already**
  computed server-side via `/api/reconcile` and do not depend on this `orders`
  state — so decoupling it only affects those two call sites.
- `OrdersLedger` (`components/finance/orders-ledger.tsx`) currently receives
  the full order array as a prop and does all filtering (store/location/search)
  client-side via `useMemo`.
- The reconciler (whatever calls `OrdersRepository.listAll()` outside the UI
  path) genuinely needs the full book — a bank credit arriving today can
  settle an order from months ago, so it cannot be date-windowed. `listAll()`
  is left untouched for this caller.

## Design

### 1. Indexes (migration, additive to `db/schema.sql`)

```sql
create index if not exists orders_date_idx on orders (order_date desc);
create index if not exists orders_store_date_idx on orders (store_id, order_date desc);
create extension if not exists pg_trgm;
create index if not exists orders_customer_name_trgm_idx on orders using gin (customer_name gin_trgm_ops);
create index if not exists orders_order_number_trgm_idx on orders using gin (order_number gin_trgm_ops);
```

The trigram indexes are needed because the existing search is a substring
match (`.includes()` today), not a prefix match — a plain btree index doesn't
help `ILIKE '%term%'` at this row count, `pg_trgm` does.

### 2. `OrdersRepository.listPage(...)`

New method alongside (not replacing) `listAll()`:

```ts
listPage({ from, to, store, location, q, page, limit }: {
  from?: string; to?: string; store?: string; location?: string;
  q?: string; page: number; limit: number;
}): Promise<{ rows: OrderRow[]; total: number }>
```

Builds one Supabase query: `.gte('order_date', from)`, `.lte('order_date', to)`
when provided, `.eq('store_id', store)` when not "All", `.or(...)` with
`ilike` across `customer_name`/`order_number`/`city`/`country`/`customer_phone`
for `q`, `.order('order_date', { ascending: false })`,
`.range((page-1)*limit, page*limit-1)`, and `{ count: 'exact' }` for `total`.
Location-group filtering (the `LOCATION_GROUPS` city-keyword matching in
`orders-ledger.tsx`) stays client-side-per-page since it's a small fixed
lookup table, not worth pushing into SQL.

### 3. `/api/orders` route

Accepts `days` (default 30), `page` (default 1), `limit` (default 50),
`store`, `location`, `q`. Calls `listPage()`, returns
`{ orders, total, page, pageSize }`. A `days=0` or explicit `from`/`to` override
lets the UI page back through older history without changing the default.

### 4. `/api/dashboard` route

Add a second, distinct repository method, `OrdersRepository.listInWindow({ from, store })`
— not `listPage`, since dashboard aggregation needs every row *in the date
window*, not one page of it (no `limit`/`page`/`count`, just `.gte('order_date',
fromIso)` and `.eq('store_id', ...)` when filtered, still paging past
Supabase's 1000-row cap internally like `listAll()` does, but only within the
window instead of across all history). `/api/dashboard/route.ts` swaps its
`OrdersRepository.listAll()` call for this. This is the change that matters:
fetch shrinks from "entire order history" to "the selected day range," which
is what the route already logically scopes to but currently fetches
everything for first.

### 5. `FinanceWorkspace` decoupling

- Remove the `orders` state and its `/api/orders` fetch (lines ~446, 466, 470).
- `/api/reconcile`'s response gains two cheap `count`-only fields —
  `settledOrders`, `totalOrders` — computed via `count: 'exact', head: true`
  queries (no row data pulled). The KPI at line 628 reads these instead of
  `orders.filter(...).length`.
- `<OrdersLedger orders={orders} loading={loading} />` becomes
  `<OrdersLedger />` — the component fetches its own data now (next section).

### 6. `OrdersLedger` becomes self-fetching

- Owns `page`, `pageSize` (default 50), `days` (default 30, with a way to
  widen/clear it), `store`, `location`, `q`, `loading`, `orders`, `total` as
  local state.
- One `useEffect` re-fetches `/api/orders` whenever `page`/`store`/`location`/
  `days` change immediately, and whenever `q` changes after a ~300ms debounce.
  Changing any filter other than `page` resets `page` to 1.
- Replaces the current client-side `rows = useMemo(orders.filter(...))` — the
  server now returns exactly the rows to show.
- Adds pagination controls: Prev/Next + "page X of Y (total N orders)",
  rendered below the table next to the existing `table-note`.
- The existing bulk-invoice-queue and row-expand behavior (Ship/Invoice
  buttons, `StageTracker`) are unaffected — they operate on whatever page is
  currently loaded, same as today.

### 7. Render-level memoization

- Wrap the per-row rendering (the part of `OrdersLedger`'s row map that
  doesn't need to re-run when a *different* row's stage updates) in
  `React.memo`, keyed on `order.uid` + the fields that actually affect its
  render. This is a small addition on top of the fetch fix, not a
  replacement for it — at 50 rows/page, the fetch fix is what matters; memo
  just avoids re-rendering all 50 when one row's `fulfillment_stage` PATCHes.

## Data flow after this change

```
Orders page load
  → OrdersLedger mounts, fetches /api/orders?days=30&page=1&limit=50
  → OrdersRepository.listPage() — one indexed, windowed, counted query
  → table shows 50 rows + "page 1 of N (total M orders)"

Filter/search/page change
  → debounced (search only) → re-fetch with new params → page resets to 1
    (except on page-button clicks, which only change `page`)

Dashboard load
  → /api/dashboard?days=30 → OrdersRepository query windowed to last 30 days
    (was: full history, filtered in JS)

Reconciliation/Orders/Sales/Payouts/Returns views' "Orders settled X/Y" KPI
  → /api/reconcile response, count-only query
    (was: derived from FinanceWorkspace's full-book `orders` state)

Reconciler (external caller, unaffected)
  → still calls OrdersRepository.listAll() — full book, as before
```

## Error handling

- `listPage()` surfaces Supabase errors the same way `listAll()` does today
  (throw with the underlying message) — the route's existing try/catch →
  toast pattern already covers this.
- If a filter combination returns zero rows, the ledger shows the existing
  "No orders" empty state, now scoped to "no orders match these filters" vs.
  "no orders synced yet" (distinguish via `total === 0 && no filters active`
  vs `total === 0 && filters active`).
- Debounced search: an in-flight request superseded by a newer keystroke is
  dropped (guard with a request-id or `AbortController`), so a slow response
  to an old query can't overwrite a newer result.

## Testing

- Unit test `OrdersRepository.listPage()` against the existing test DB
  pattern used by `tests/reconciliation/*` — verify filter combinations
  (store, date range, search) each narrow correctly and `total` matches an
  independent count.
- Unit test the new `/api/reconcile` count fields against known fixture data.
- Manual verification (per this project's `verify` skill): load the Orders
  page, confirm pagination controls work, confirm search/store/location
  filters narrow results, confirm the Dashboard KPIs match pre-change values
  on a fixed day window, confirm the reconciliation KPI bar still shows the
  right settled/total count.
- Existing 41/41 test suite must stay green; `listAll()` and its callers
  (reconciler) are untouched, so no regression expected there.
