# Two-Year Orders Backfill (Shopify x3 + WooCommerce) — Design

Date: 2026-07-20
Status: **approved, implementing**

## Why this spec exists

The finance workspace currently syncs a rolling 60-day window
(`lib/sync/order-sync.service.ts`, `DEFAULT_WINDOW_DAYS = 60`) via the
existing "Sync now" button (`POST /api/sync`). Before building pipeline
tracking / invoice / close-order actions on top of the orders ledger, the
full 2-year order history needs to be in Supabase so those features have
real data to work against.

Reviewing the existing sync path surfaced two problems that a 2-year pull
across four stores would make real, not hypothetical:

1. **Shopify has no throttle handling.** `fetchShopifyOrders`/
   `fetchShopifyInventory` (`lib/integrations/shopify.ts`) throw immediately
   on any non-OK response or GraphQL error. Shopify's Admin GraphQL API is
   cost-throttled; a 2-year pull across 3 stores is enough volume to trip
   it, and today one 429 aborts that store's entire sync — including all
   orders already fetched in that run, since `order-sync.service.ts`
   accumulates the full raw array in memory and calls
   `OrdersRepository.upsertMany` once at the end.
2. **`courier`/`tracking_number`/`tracking_url` get silently overwritten on
   every re-sync**, including for orders already shipped through this
   app's own SMSA pipeline. `components/finance/orders-ledger.tsx`'s ship
   flow calls `patch(uid, { awb_number, label_url, courier: "SMSA",
   fulfillment_stage: "shipped" })` after a successful SMSA label, but
   `normalizeShopifyOrder`/`normalizeWooOrder` (`lib/normalize/order.ts`)
   always recompute `courier`/`tracking_number`/`tracking_url` from the
   store's raw data, and `OrdersRepository.upsertMany` only strips
   `payout_status` before upserting — not these three. A backfill run (or
   even the existing periodic sync) over an already-SMSA-shipped order
   would silently blank out or replace `courier: "SMSA"` with the store's
   own shipping-method label. This directly violates "keep already-saved
   orders as-is."

WooCommerce already has a Bottleneck limiter (`lib/integrations/woo.ts`,
20-request burst / 10s refill, `maxConcurrent: 2`) from prior work. It has
never been exercised against the real store at anything like backfill
volume, so this spec includes a live pre-flight check before the real
pull runs.

## Design

### 1. Standalone scripts, not HTTP routes

`app/api/sync/route.ts` declares `maxDuration = 120` and is triggered from
a browser button (`components/finance/finance-workspace.tsx`) — wrong
shape for a job that pulls 2 years of data across 4 stores. Two new
scripts, run via the already-installed `tsx`:

- `scripts/test-woo-rate-limit.ts` — live pre-flight check.
- `scripts/backfill-orders.ts` — the actual backfill.

Both runnable directly (`npx tsx scripts/...`) and via new `package.json`
scripts: `"backfill:orders"` and `"test:woo-rate-limit"`.

### 2. Woo rate-limit pre-flight (`scripts/test-woo-rate-limit.ts`)

`lib/integrations/woo.ts` gains an exported helper:

```ts
export async function testWooRateLimit(n = 50): Promise<{ n: number; ok: number; failed: number; statuses: number[]; durationMs: number }>
```

It fires `n` real `GET /wp-json/wc/v3/orders?per_page=1&page=1` requests
through the existing `wooLimiter`/`wooFetch` (same code path the real
backfill uses — this proves the actual limiter, not a re-implementation of
it), records each response's status and total wall-clock duration, and
returns a summary. The script prints per-request status + timing and a
final PASS/FAIL line (FAIL if any non-2xx response). `per_page=1` keeps
each request cheap since only latency/throttling behavior matters, not the
data.

`scripts/backfill-orders.ts` runs this check first by default and refuses
to proceed to the real Woo pull if it fails; a `--skip-rate-check` flag
bypasses it for repeat runs once you've confirmed the store tolerates it.
Shopify stores are unaffected by this flag (no live pre-flight needed there
— the throttle handling below is retry-based, not a burst test, since
Shopify's own API tells you when you're throttled via the response itself).

### 3. Shopify retry/backoff + incremental paging

`lib/integrations/shopify.ts`: wrap each page's `fetch` call in a retry
helper:

```ts
async function shopifyFetchWithRetry(endpoint: string, init: RequestInit, storeCode: string): Promise<Response> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(endpoint, init);
    if (res.status !== 429) return res;
    if (attempt >= MAX_ATTEMPTS) return res; // let the caller's existing !res.ok path throw
    const retryAfter = Number(res.headers.get("Retry-After")) || Math.min(2 ** attempt, 30);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }
}
```

GraphQL-level throttling (HTTP 200, body has `errors[].extensions.code ===
"THROTTLED"`) is handled the same way at the call site: on that specific
error code, sleep using `extensions.cost.throttleStatus.restoreRate` (fall
back to a flat 2s if the extension shape isn't present) and retry, same
`MAX_ATTEMPTS` cap.

`fetchShopifyOrders` gains an optional third parameter:

```ts
export async function fetchShopifyOrders(
  store: ShopifyStoreConfig,
  sinceIso: string,
  onPage?: (orders: ShopifyRawOrder[]) => Promise<void>,
): Promise<ShopifyRawOrder[]>
```

When `onPage` is supplied, each page is handed off immediately (so the
caller can normalize + upsert it right away) in addition to being
accumulated in the returned array (existing callers — the 60-day periodic
sync — pass no callback and see no behavior change). This makes the
backfill durable: a failure on page 400 of 450 still leaves the first 399
pages' orders committed to Supabase, and simply re-running the script
picks up from page 1 again — cheap for Woo, and for Shopify the same
upserted orders just get harmlessly re-upserted (see idempotency below).

`fetchWooOrders` gets the same optional `onPage` parameter for
consistency and the same durability property, even though Woo's own
per-page cost is already cheap under the existing limiter.

### 4. Courier-clobber fix (`OrdersRepository.upsertMany`)

Before upserting, look up which of the batch's `uid`s already have a
non-empty `awb_number` in the DB:

```ts
async upsertMany(rows: OrderRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const uids = rows.map((r) => r.uid);
  const { data: shipped } = await supabase
    .from("orders")
    .select("uid")
    .in("uid", uids)
    .not("awb_number", "is", null)
    .neq("awb_number", "");
  const shippedUids = new Set((shipped ?? []).map((r) => r.uid));

  const syncRows = rows.map((row) => {
    const { payout_status: _p, ...rest } = row;
    if (shippedUids.has(row.uid)) {
      const { courier: _c, tracking_number: _t, tracking_url: _u, ...safe } = rest;
      return safe;
    }
    return rest;
  });
  // ...upsert syncRows as today
}
```

Rows dropping `courier`/`tracking_number`/`tracking_url` from the upsert
payload means Postgres's `ON CONFLICT DO UPDATE` simply never touches
those columns for that row — matches how `payout_status` is already
protected. Orders not yet shipped through this app's pipeline keep syncing
their store-reported courier/tracking normally, so Shopify-native
fulfillment tracking still updates pre-handoff.

### 5. Backfill orchestration (`scripts/backfill-orders.ts`)

```
1. Parse --days (default 730), --only=<STORE_CODE> (optional, for a
   single-store dry run), --skip-rate-check.
2. Unless --skip-rate-check: run testWooRateLimit(), print result, abort
   (non-zero exit) on FAIL.
3. For each Shopify store from getShopifyStores() (filtered by --only):
   fetchShopifyOrders(store, since, onPage) where onPage normalizes +
   calls OrdersRepository.upsertMany immediately per page. Wrapped in
   try/catch so one store's exhausted-retries failure doesn't block the
   others (same isolation pattern as syncAllStores).
4. If wooConfigured() and (--only is unset or === "WOO"):
   fetchWooOrders(sinceIso, onPage) with the same immediate per-page
   upsert.
5. Print a final summary table: store, pages, orders fetched, orders
   upserted, error (if any). Non-zero exit code if any store errored.
```

Idempotency: every upsert is `ON CONFLICT (uid) DO UPDATE`, so re-running
the entire script (e.g., after a crash, or to pick up strays) is always
safe — no separate cursor/checkpoint table needed. This is a deliberate
scope cut: a dedicated resumability/audit table (like `sync_runs`) was
considered and rejected as unnecessary complexity for a one-time script —
console output is sufficient for a run you're watching interactively.

## Data flow (per store)

fetch page (retry/backoff-protected) → normalize → drop clobber-risk
fields for already-shipped orders → upsert page → log progress → next
page/cursor → done → print store summary.

## Error handling

- Per-store isolation: one store's exhausted retries or a hard failure
  (e.g., bad credentials) is caught, logged with the store code, and does
  not stop the other stores from completing.
- Shopify 429 / GraphQL `THROTTLED`: retried up to 5 attempts with
  backoff (Retry-After header or cost-based restoreRate, falling back to
  exponential 2s/4s/8s/16s/30s); if still failing after 5 attempts, the
  existing `!res.ok` / `json.errors` throw paths fire as today, caught by
  the per-store try/catch.
- Woo rate-limit pre-flight FAIL: the backfill script refuses to start the
  Woo pull and exits non-zero, printing the failing statuses — a human
  needs to look at the store before retrying (possibly with
  `--skip-rate-check` if the failures were a one-off blip, at their
  discretion).

## Testing

- Unit test the Shopify retry/backoff helper (`shopifyFetchWithRetry`) —
  mock global `fetch` to return a 429 then a 200, assert it retries and
  returns the successful response; assert it gives up after
  `MAX_ATTEMPTS` and returns the last (failing) response rather than
  looping forever.
- Unit test the courier-clobber selection logic as a pure function
  (extract the "which fields to drop for a shipped row" decision from the
  Supabase call so it's testable without a live DB — per this repo's
  established convention, no Supabase mocks exist anywhere in the
  codebase; DB-touching glue gets manual verification instead).
- Manual verification: run `scripts/backfill-orders.ts --only=KSA
  --days=730` first against the smallest store, spot-check row counts and
  a couple of known orders in Supabase, confirm a previously-SMSA-shipped
  order's `courier` stays `"SMSA"` after the backfill touches it, then run
  the full four-store backfill.
- `scripts/test-woo-rate-limit.ts` itself doubles as the live integration
  smoke test for the Woo limiter — run once, by hand, before the real
  pull.

## Out of scope

- UI redesign (colors/contrast) for the orders ledger — separate spec,
  after this backfill completes, per the user's own sequencing.
- Pipeline-stage tracking, invoice-issuing action buttons, and
  order-closing actions — same, deferred to a follow-up spec once 2 years
  of real data exists to build and test those against.
- A persistent audit table for backfill runs (see idempotency note above)
  — deliberately cut as unneeded for a one-time interactive script.
- Changing the existing 60-day periodic sync's behavior — it keeps its
  current signature and behavior; the new `onPage` parameter is optional
  and unused by that caller.
