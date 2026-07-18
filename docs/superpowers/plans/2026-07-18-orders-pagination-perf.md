# Orders Pagination & Dashboard Fetch Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/api/orders` and `/api/dashboard` from fetching the entire order book (tens of thousands of rows and growing) on every request — replace with indexed, server-side pagination and right-sized queries, and decouple the Orders ledger from `FinanceWorkspace`'s single shared fetch.

**Architecture:** Postgres indexes + Supabase query-builder filters/`.range()`/`count: 'exact'` do the narrowing that currently happens in JavaScript after fetching everything. `OrdersLedger` becomes self-fetching (owns page/filter state, calls `/api/orders` directly) instead of receiving a pre-fetched array as a prop. `/api/dashboard` swaps one `listAll()` call for three right-sized queries, since its response mixes a day-windowed slice with deliberately all-time numbers (confirmed by reading the route — a blind windowed swap would break `codPending` and the spotlight).

**Tech Stack:** Next.js 16 App Router API routes, Supabase JS client (`@supabase/supabase-js`, PostgREST underneath), React 19, `node:test` for unit tests.

## Global Constraints

- Existing `OrdersRepository.listAll()` and its callers (the reconciler) are **not modified** — reconciliation must see the full book, since a bank credit today can settle a months-old order.
- Existing 41/41 test suite must stay green throughout.
- `npx tsc --noEmit -p .` must be clean after every task.
- No new dependencies — `pg_trgm` is a built-in Postgres extension, no npm package needed.
- Follow this codebase's established testing convention: pure logic gets a `node:test` unit test; thin route/DB-touching glue is verified manually (no existing route-handler tests or Supabase mocks exist anywhere in this repo — don't invent that pattern here).
- Customers panel (`components/finance/customers-panel.tsx`, `app/api/customers/`) is the founder's own in-progress, uncommitted work — do not touch it.

---

### Task 1: Shared location groups + DB indexes + `OrdersRepository` query/aggregate methods

**Files:**
- Create: `lib/orders-locations.ts`
- Modify: `db/schema.sql` (append indexes)
- Modify: `lib/repositories/orders.repository.ts` (add `listPage`, `listInWindow`, `getOrderCounts`, `getMostRecent`)
- Modify: `components/finance/orders-ledger.tsx:39-59` (import shared `LOCATION_GROUPS`/`locationGroupFor` instead of defining them locally — done in Task 6, not here; this task only creates the shared module)
- Test: `tests/repositories/orders-query.test.ts`

**Interfaces:**
- Produces (for later tasks): `OrdersRepository.listPage({ from?, to?, store?, location?, q?, page, limit }): Promise<{ rows: OrderRowRaw[]; total: number }>`; `OrdersRepository.listInWindow({ from, store? }): Promise<OrderRowRaw[]>`; `OrdersRepository.getOrderCounts({ store? }?): Promise<{ settledOrders: number; totalOrders: number; codPendingCount: number; codPendingAed: number }>`; `OrdersRepository.getMostRecent({ store? }?): Promise<OrderRowRaw | null>`. `OrderRowRaw` is the same inline shape `listAll()` already returns (raw select columns, no `finance_status`/`in_payout_file` — those are computed by the API route layer, unchanged).
- Produces: `lib/orders-locations.ts` exports `LOCATION_GROUPS: Record<string, string[]>` and `keywordsForLocation(location: string): string[] | null` (returns `null` for `"All locations"` or an unknown group name).
- Consumes: nothing from other tasks (this is the foundation task).

- [ ] **Step 1: Create the shared location-groups module**

`lib/orders-locations.ts`:

```ts
// Known cities per emirate/region, shared between the Orders ledger's
// location filter dropdown (client) and the paginated orders query (server)
// — a single source of truth so the two never drift out of sync. Matched
// case-insensitively against the order's `city` field, which is free text
// synced from Shopify/Woo — not every order matches a known group.
export const LOCATION_GROUPS: Record<string, string[]> = {
  "Dubai": ["dubai"],
  "Abu Dhabi": ["abu dhabi", "abudhabi"],
  "Sharjah": ["sharjah"],
  "Riyadh": ["riyadh"],
  "Jeddah": ["jeddah", "jedda"],
  "Other UAE": ["ajman", "fujairah", "ras al khaimah", "rak", "umm al quwain"],
  "Other KSA": ["dammam", "khobar", "mecca", "makkah", "medina"],
};

export function locationGroupFor(city: string): string | null {
  const c = (city || "").toLowerCase();
  for (const [group, keywords] of Object.entries(LOCATION_GROUPS)) {
    if (keywords.some((k) => c.includes(k))) return group;
  }
  return null;
}

// Keywords for a location filter value sent from the client, or null if the
// value isn't a real filter ("All locations" / unrecognized).
export function keywordsForLocation(location: string): string[] | null {
  return LOCATION_GROUPS[location] ?? null;
}
```

- [ ] **Step 2: Write the failing test for query-param parsing/clamping**

`OrdersRepository.listPage` takes already-parsed params, but the route needs a
pure, testable function to turn `URLSearchParams` into those params (clamped
to sane bounds) — extracted the same way `computeReconLines` was pulled out of
`runReconciliation` for testability in the prior recon-hardening plan. Add it
to the same repository file since it's tightly coupled to `listPage`'s shape.

`tests/repositories/orders-query.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrdersQuery } from "@/lib/repositories/orders.repository";

test("parseOrdersQuery: defaults to 30 days, page 1, limit 50, no filters", () => {
  const q = parseOrdersQuery(new URLSearchParams());
  assert.equal(q.days, 30);
  assert.equal(q.page, 1);
  assert.equal(q.limit, 50);
  assert.equal(q.store, null);
  assert.equal(q.location, null);
  assert.equal(q.q, "");
});

test("parseOrdersQuery: days=0 means unbounded (no lower date bound)", () => {
  const q = parseOrdersQuery(new URLSearchParams("days=0"));
  assert.equal(q.days, 0);
});

test("parseOrdersQuery: clamps page below 1 up to 1", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("page=0")).page, 1);
  assert.equal(parseOrdersQuery(new URLSearchParams("page=-5")).page, 1);
});

test("parseOrdersQuery: clamps limit to [1, 200]", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("limit=0")).limit, 1);
  assert.equal(parseOrdersQuery(new URLSearchParams("limit=5000")).limit, 200);
});

test("parseOrdersQuery: 'All' store normalizes to null (no filter)", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("store=All")).store, null);
  assert.equal(parseOrdersQuery(new URLSearchParams("store=UAE")).store, "UAE");
});

test("parseOrdersQuery: 'All locations' normalizes to null", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("location=All+locations")).location, null);
  assert.equal(parseOrdersQuery(new URLSearchParams("location=Dubai")).location, "Dubai");
});

test("parseOrdersQuery: trims search text", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("q=+nada+")).q, "nada");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test tests/repositories/orders-query.test.ts`
Expected: FAIL — `parseOrdersQuery` is not exported from `@/lib/repositories/orders.repository` yet.

- [ ] **Step 4: Add the DB indexes**

Append to `db/schema.sql`:

```sql
-- orders: at tens of thousands of rows and growing, the ledger and dashboard
-- now query by date range, store, and free-text search server-side instead
-- of fetching everything and filtering in JS — these indexes make that fast.
create index if not exists orders_date_idx on orders (order_date desc);
create index if not exists orders_store_date_idx on orders (store_id, order_date desc);
create extension if not exists pg_trgm;
create index if not exists orders_customer_name_trgm_idx on orders using gin (customer_name gin_trgm_ops);
create index if not exists orders_order_number_trgm_idx on orders using gin (order_number gin_trgm_ops);
create index if not exists orders_city_trgm_idx on orders using gin (city gin_trgm_ops);
```

Trigram indexes (not plain btree) because the existing search is substring
(`ILIKE '%term%'`), not prefix — `pg_trgm` is what makes that fast at scale.
This file has no automated apply step in this project (confirmed: no
migration runner exists, `db/schema.sql` changes are applied by the founder
directly in the Supabase SQL editor, same as every prior migration in this
repo's history) — flag in the final PR/summary that this needs to be run
against the live database before the perf benefit takes effect. The new
query methods in the next step work correctly without the index, just slower
until it's applied.

- [ ] **Step 5: Implement `parseOrdersQuery`, `listPage`, `listInWindow`, `getOrderCounts`, `getMostRecent`**

In `lib/repositories/orders.repository.ts`, add the import and new exports
(keep everything already in the file — `upsertMany`, `listAll`, `getByUid`,
`markSettled`, `setFulfillmentStage`, `recordShipmentSuccess`,
`recordShipmentError` — untouched):

```ts
import { keywordsForLocation } from "@/lib/orders-locations";

const ORDER_COLUMNS =
  "uid, store_id, order_number, order_date, customer_name, customer_email, customer_phone, city, country, currency, gross_original, gross_aed, gateway, gateway_raw, financial_status, fulfillment_status, telr_cartid, telr_tranref, payout_id, payout_status, line_items, courier, tracking_number, tracking_url, fulfillment_stage, fulfillment_stage_updated_at, awb_number, shipped_at, label_url, ship_error";

export type OrdersQuery = {
  days: number; page: number; limit: number;
  store: string | null; location: string | null; q: string;
};

// Pure — turns URL search params into clamped, normalized query args. Kept
// separate from the DB call so it's unit-testable without Supabase.
export function parseOrdersQuery(params: URLSearchParams): OrdersQuery {
  const days = Math.max(parseInt(params.get("days") || "30", 10) || 30, 0);
  const page = Math.max(parseInt(params.get("page") || "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") || "50", 10) || 50, 1), 200);
  const storeRaw = (params.get("store") || "All").trim();
  const store = storeRaw.toLowerCase() === "all" ? null : storeRaw;
  const locationRaw = (params.get("location") || "All locations").trim();
  const location = locationRaw.toLowerCase() === "all locations" ? null : locationRaw;
  const q = (params.get("q") || "").trim();
  return { days, page, limit, store, location, q };
}

// Supabase's fluent query builder returns an increasingly specific generic
// type after each chained call — typing that precisely here isn't worth it
// for internal glue code that just narrows a select; `any` in, `any` out,
// the caller re-asserts the final row shape it actually wants.
function applyOrdersFilters(
  query: any,
  opts: { from?: string; to?: string; store?: string | null; location?: string | null; q?: string },
): any {
  let qy = query;
  if (opts.from) qy = qy.gte("order_date", opts.from);
  if (opts.to) qy = qy.lte("order_date", opts.to);
  if (opts.store) qy = qy.eq("store_id", opts.store);
  if (opts.location) {
    const keywords = keywordsForLocation(opts.location);
    if (keywords && keywords.length > 0) {
      qy = qy.or(keywords.map((k) => `city.ilike.%${k}%`).join(","));
    }
  }
  if (opts.q) {
    const term = opts.q.replace(/[%,]/g, "");
    qy = qy.or(
      [
        `customer_name.ilike.%${term}%`,
        `order_number.ilike.%${term}%`,
        `city.ilike.%${term}%`,
        `country.ilike.%${term}%`,
        `customer_phone.ilike.%${term}%`,
      ].join(","),
    );
  }
  // Repeated .or()/.eq()/.gte() calls each add an independent, ANDed filter
  // clause in PostgREST — so the location OR-group and the search OR-group
  // combine as (location keyword match) AND (search column match), not one
  // flat OR across everything. That's the whole point of calling them
  // separately rather than merging into a single .or() string.
  return qy;
}

export const OrdersRepository = {
  // ... existing upsertMany, listAll, getByUid, markSettled,
  // setFulfillmentStage, recordShipmentSuccess, recordShipmentError stay
  // exactly as they are today ...

  // UI-facing paginated + filtered query — the ledger's data source going
  // forward. listAll() stays untouched for the reconciler, which needs the
  // full book regardless of any UI filter.
  async listPage({ from, to, store, location, q, page, limit }: {
    from?: string; to?: string; store?: string | null; location?: string | null;
    q?: string; page: number; limit: number;
  }) {
    let query = supabase.from("orders").select(ORDER_COLUMNS, { count: "exact" });
    query = applyOrdersFilters(query, { from, to, store, location, q });
    const fromIdx = (page - 1) * limit;
    const { data, error, count } = await query
      .order("order_date", { ascending: false })
      .range(fromIdx, fromIdx + limit - 1);
    if (error) throw new Error(`orders page select failed: ${error.message}`);
    return { rows: (data ?? []) as OrderRowRaw[], total: count ?? 0 };
  },

  // Full rows within a date window (+ optional store), for dashboard
  // aggregation that needs every row in range, not one page of it. Still
  // pages past Supabase's 1000-row cap internally like listAll(), just only
  // within the window instead of across all history.
  async listInWindow({ from, store }: { from: string; store?: string | null }) {
    const PAGE = 1000;
    const rows: OrderRowRaw[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let query = supabase.from("orders").select(ORDER_COLUMNS);
      query = applyOrdersFilters(query, { from, store });
      const { data, error } = await query
        .order("order_date", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`orders window select failed: ${error.message}`);
      rows.push(...((data ?? []) as OrderRowRaw[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },

  // All-time counts — deliberately NOT date-windowed (matches the dashboard
  // route's existing behavior for these three numbers exactly). Count-only
  // queries (head: true) pull zero row data.
  async getOrderCounts({ store }: { store?: string | null } = {}) {
    const base = () => {
      let q = supabase.from("orders").select("uid", { count: "exact", head: true });
      if (store) q = q.eq("store_id", store);
      return q;
    };
    const cancelled = ["voided", "refunded", "cancelled"];
    const [settledRes, totalRes, codRes] = await Promise.all([
      base().eq("payout_status", "settled"),
      base(),
      (() => {
        let q = supabase.from("orders").select("gross_aed").eq("gateway", "COD").neq("payout_status", "settled");
        if (store) q = q.eq("store_id", store);
        return q.not("financial_status", "in", `(${cancelled.join(",")})`);
      })(),
    ]);
    if (settledRes.error) throw new Error(`settled count failed: ${settledRes.error.message}`);
    if (totalRes.error) throw new Error(`total count failed: ${totalRes.error.message}`);
    if (codRes.error) throw new Error(`cod pending select failed: ${codRes.error.message}`);
    const codRows = codRes.data ?? [];
    return {
      settledOrders: settledRes.count ?? 0,
      totalOrders: totalRes.count ?? 0,
      codPendingCount: codRows.length,
      codPendingAed: +codRows.reduce((s, r) => s + Number(r.gross_aed || 0), 0).toFixed(2),
    };
  },

  // Single most recent order (optionally store-filtered), full row data —
  // for the dashboard spotlight. No date window: a quiet week shouldn't make
  // the spotlight go blank.
  async getMostRecent({ store }: { store?: string | null } = {}) {
    let query = supabase.from("orders").select(ORDER_COLUMNS);
    if (store) query = query.eq("store_id", store);
    const { data, error } = await query
      .order("order_date", { ascending: false })
      .limit(1);
    if (error) throw new Error(`most-recent order select failed: ${error.message}`);
    return (data && data[0]) as OrderRowRaw | undefined ?? null;
  },
};
```

Also extract the return type `listAll()` already inlines into a named type
`OrderRowRaw` (used by the new methods above) — change:

```ts
    return rows as {
      uid: string; store_id: string; order_number: string; order_date: string | null;
      customer_name: string; customer_email: string; customer_phone: string; city: string; country: string;
      currency: string; gross_original: number; gross_aed: number; gateway: string;
      gateway_raw: string; financial_status: string; fulfillment_status: string;
      telr_cartid: string; telr_tranref: string; payout_id: string | null;
      payout_status: string;
      line_items: { title: string; sku: string; qty: number; total_aed: number; image_url?: string; stock?: number | null }[];
      courier: string; tracking_number: string; tracking_url: string;
      fulfillment_stage: string; fulfillment_stage_updated_at: string | null;
      awb_number: string; shipped_at: string | null; label_url: string; ship_error: string;
    }[];
  },
```

to:

```ts
    return rows as OrderRowRaw[];
  },
```

and add, above the `OrdersRepository` export:

```ts
export type OrderRowRaw = {
  uid: string; store_id: string; order_number: string; order_date: string | null;
  customer_name: string; customer_email: string; customer_phone: string; city: string; country: string;
  currency: string; gross_original: number; gross_aed: number; gateway: string;
  gateway_raw: string; financial_status: string; fulfillment_status: string;
  telr_cartid: string; telr_tranref: string; payout_id: string | null;
  payout_status: string;
  line_items: { title: string; sku: string; qty: number; total_aed: number; image_url?: string; stock?: number | null }[];
  courier: string; tracking_number: string; tracking_url: string;
  fulfillment_stage: string; fulfillment_stage_updated_at: string | null;
  awb_number: string; shipped_at: string | null; label_url: string; ship_error: string;
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx --test tests/repositories/orders-query.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/orders-locations.ts lib/repositories/orders.repository.ts db/schema.sql tests/repositories/orders-query.test.ts
git commit -m "$(cat <<'EOF'
Add paginated/windowed order queries and shared location groups

OrdersRepository gains listPage (server-side filter+paginate),
listInWindow (date-scoped full rows), getOrderCounts (all-time
count-only aggregates), and getMostRecent — the building blocks for
moving the Orders ledger and Dashboard off full-book fetches.
listAll() is untouched; the reconciler still needs the whole book.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `/api/orders` route — pagination + filters

**Files:**
- Modify: `app/api/orders/route.ts`

**Interfaces:**
- Consumes: `OrdersRepository.listPage`, `parseOrdersQuery` from Task 1.
- Produces: `GET /api/orders?days&page&limit&store&location&q` → `{ orders: OrderRow[], total, page, pageSize }` (was `{ orders, count }` with no params). This is a breaking response-shape change for this route's only consumers, `FinanceWorkspace` (Task 5) and `OrdersLedger` (Task 6) — both updated in this plan.

- [ ] **Step 1: Rewrite the route**

Replace `app/api/orders/route.ts` entirely:

```ts
import { NextResponse } from "next/server";
import { OrdersRepository, parseOrdersQuery } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

// GET /api/orders?days=30&page=1&limit=50&store=UAE&location=Dubai&q=nada —
// normalized, paginated orders from Supabase (never live Shopify), each with
// its finance chain: payout file seen? settled by bank?
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { days, page, limit, store, location, q } = parseOrdersQuery(url.searchParams);
  const from = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;

  const [{ rows, total }, payouts] = await Promise.all([
    OrdersRepository.listPage({ from, store, location, q, page, limit }),
    PayoutsRepository.listWithRefs(),
  ]);

  // which order numbers appear in ANY uploaded payout file
  const refsSeen = new Set<string>();
  for (const p of payouts) {
    for (const ref of p.order_refs) {
      refsSeen.add(ref);
      refsSeen.add(ref.replace(/^(WA|UAE|KSA|WOO)/i, ""));
    }
  }

  const orders = rows.map(({ line_items: _li, ...o }) => {
    const settled = o.payout_status === "settled";
    const inPayoutFile = settled || refsSeen.has(o.order_number);
    const financeStatus =
      o.gateway === "COD"
        ? "COD_PENDING"
        : settled
          ? "SETTLED"
          : inPayoutFile
            ? "AWAITING_BANK"
            : "MISSING_PAYOUT";
    return { ...o, in_payout_file: inPayoutFile, finance_status: financeStatus };
  });

  return NextResponse.json({ orders, total, page, pageSize: limit });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: errors in `finance-workspace.tsx` and `orders-ledger.tsx` (still
expecting the old response shape / prop signature) — expected at this point,
fixed in Tasks 5 and 6. Confirm the error is ONLY in those two files, not in
`app/api/orders/route.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add app/api/orders/route.ts
git commit -m "$(cat <<'EOF'
Paginate /api/orders — accept days/page/limit/store/location/q

Was a single unbounded listAll() with no query params. Now delegates
filtering and paging to OrdersRepository.listPage(), so the response
only ever contains the page actually requested.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(This commit is expected to land on top of code that doesn't yet compile
end-to-end — that's fine, Tasks 5-6 fix the callers next. Do not run the
full test suite as a gate here; Task 8 does the final regression pass.)

---

### Task 3: `/api/dashboard` route — three targeted queries instead of `listAll()`

**Files:**
- Modify: `app/api/dashboard/route.ts`

**Interfaces:**
- Consumes: `OrdersRepository.listInWindow`, `getOrderCounts`, `getMostRecent` from Task 1.
- Produces: same response shape as today (`kpis`, `trend`, `stores`, `gateways`, `topProducts`, `payouts`, `spotlight`, `recentOrders`, `documents`) — this task changes the data-fetching internals only, not the JSON contract, so no caller needs updating.

- [ ] **Step 1: Replace the `listAll()` call and the three consumers that used the full `orders` array**

In `app/api/dashboard/route.ts`, replace:

```ts
  const [orders, bankLinesRes, reconRes, payoutsRes, payoutsWithRefs] = await Promise.all([
    OrdersRepository.listAll(),
    supabase
      .from("bank_lines")
      .select("id, statement_date, description, reference, amount, direction, gateway_guess, confidence, kind")
      .order("statement_date", { ascending: false })
      .limit(1000),
    supabase.from("recon_lines").select("bank_line_id, match_status, confirmed_by"),
    supabase.from("payouts").select("id, gateway, net_amount, source, payout_date"),
    PayoutsRepository.listWithRefs(),
  ]);
```

with:

```ts
  const storeParam = storeFilter === "ALL" ? null : storeFilter;
  const [inWindow, orderCounts, spotlightOrder, bankLinesRes, reconRes, payoutsRes, payoutsWithRefs] = await Promise.all([
    OrdersRepository.listInWindow({ from: fromIso, store: storeParam }),
    OrdersRepository.getOrderCounts({ store: storeParam }),
    OrdersRepository.getMostRecent({ store: storeParam }),
    supabase
      .from("bank_lines")
      .select("id, statement_date, description, reference, amount, direction, gateway_guess, confidence, kind")
      .order("statement_date", { ascending: false })
      .limit(1000),
    supabase.from("recon_lines").select("bank_line_id, match_status, confirmed_by"),
    supabase.from("payouts").select("id, gateway, net_amount, source, payout_date"),
    PayoutsRepository.listWithRefs(),
  ]);
```

- [ ] **Step 2: Remove the now-redundant `inWindow` derivation**

Delete these lines (the `inWindow` variable is now the Task-1 query result
directly, already scoped to the window + store + non-cancelled — but the
`cancelled` exclusion needs to move into the query since `listInWindow`
doesn't apply it):

```ts
  // ── orders side (window + optional store filter) ─────────────────────────
  const cancelled = new Set(["voided", "refunded", "cancelled"]);
  const inWindow = orders.filter(
    (o) =>
      o.order_date && o.order_date >= fromIso &&
      !cancelled.has(o.financial_status) &&
      (storeFilter === "ALL" || o.store_id === storeFilter),
  );
```

Replace with just the cancelled-status filter applied to the already
window+store-scoped query result:

```ts
  const cancelled = new Set(["voided", "refunded", "cancelled"]);
  const inWindowFiltered = inWindow.filter((o) => !cancelled.has(o.financial_status));
```

and rename every subsequent use of `inWindow` (revenue calc, trend loop,
storeAgg/gatewayAgg loop, productAgg loop, `recentOrders` at the bottom) to
`inWindowFiltered`. There are 6 occurrences after the deleted block (lines
46, 54, 69, 80, 187-188, 228 in the original file) — rename all of them.

- [ ] **Step 3: Replace `codPending` with the pre-computed count**

Delete:

```ts
  const codPending = orders.filter(
    (o) => o.gateway === "COD" && o.payout_status !== "settled" && !cancelled.has(o.financial_status),
  );
```

and in the response object, replace:

```ts
      codPendingAed: +codPending.reduce((s, o) => s + Number(o.gross_aed || 0), 0).toFixed(2),
      codPendingCount: codPending.length,
      settledOrders: orders.filter((o) => o.payout_status === "settled").length,
      totalOrders: orders.length,
```

with:

```ts
      codPendingAed: orderCounts.codPendingAed,
      codPendingCount: orderCounts.codPendingCount,
      settledOrders: orderCounts.settledOrders,
      totalOrders: orderCounts.totalOrders,
```

- [ ] **Step 4: Replace `spotlightPool`/`spotlightOrder` derivation**

Delete:

```ts
  const spotlightPool = orders
    .filter((o) => storeFilter === "ALL" || o.store_id === storeFilter)
    .filter((o) => o.order_date)
    .sort((a, b) => (b.order_date! > a.order_date! ? 1 : -1));
  const spotlightOrder = spotlightPool[0];
```

— `spotlightOrder` is now the direct result of `OrdersRepository.getMostRecent()`
from Step 1's `Promise.all`, already store-filtered and sorted. Everything
below that references `spotlightOrder` (the `spotlight` object construction)
stays exactly as-is, since `getMostRecent()` returns the same row shape
`listAll()` did.

Guard for the empty case — `spotlightOrder` can now be `undefined | null`
directly from the query (previously `spotlightPool[0]` on an empty array was
also `undefined`, so the existing `spotlightOrder ? (() => {...})() : null`
ternary already handles this correctly, no change needed there).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `app/api/dashboard/route.ts`.

- [ ] **Step 6: Manual verification against a fixed window**

Run: `curl -s 'http://localhost:3000/api/dashboard?days=30' | python3 -m json.tool | head -30`
(with the dev server running per this project's `run` skill)
Expected: `kpis.settledOrders`/`totalOrders`/`codPendingCount`/`codPendingAed`
match the same values from before this task's changes (spot-check against a
`git stash` of the pre-change route if in doubt) — these four numbers must
NOT shrink just because `days=30` is small, since they're deliberately
all-time.

- [ ] **Step 7: Commit**

```bash
git add app/api/dashboard/route.ts
git commit -m "$(cat <<'EOF'
Dashboard: replace full-book listAll() with three right-sized queries

The route's single listAll() fed three differently-scoped consumers:
a day-windowed slice (trend/gateways/top products), and two all-time
numbers (codPending, settled/total KPI counts) that must NOT be
windowed. Splits into listInWindow (windowed rows), getOrderCounts
(all-time count-only aggregates), and getMostRecent (spotlight) so
each fetches only what it actually needs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `/api/reconcile` route — add `settledOrders`/`totalOrders`

**Files:**
- Modify: `app/api/reconcile/route.ts`

**Interfaces:**
- Consumes: `OrdersRepository.getOrderCounts` from Task 1.
- Produces: `/api/reconcile` response gains `settledOrders: number` and
  `totalOrders: number` top-level fields, all-time and unfiltered by store
  (matches the KPI's current behavior in `FinanceWorkspace` exactly — that
  KPI has never had a store filter).

- [ ] **Step 1: Add the count fetch and include it in the response**

In `app/api/reconcile/route.ts`, add the import:

```ts
import { OrdersRepository } from "@/lib/repositories/orders.repository";
```

Change the `Promise.all` that fetches `credits`/`payouts`:

```ts
  const [credits, payouts] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
  ]);
```

to:

```ts
  const [credits, payouts, orderCounts] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
    OrdersRepository.getOrderCounts(),
  ]);
```

And add the two fields to the returned JSON:

```ts
  return NextResponse.json({
    lines,
    settledOrders: orderCounts.settledOrders,
    totalOrders: orderCounts.totalOrders,
    documents: {
```

(keep everything else in the response object exactly as it is today.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `app/api/reconcile/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/reconcile/route.ts
git commit -m "$(cat <<'EOF'
Add settledOrders/totalOrders counts to /api/reconcile response

FinanceWorkspace's "Orders settled X/Y" KPI currently derives this by
filtering a full client-side order-book fetch. Computing it here via
a count-only query means that fetch can be removed (Task 5) without
losing the KPI.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `FinanceWorkspace` — drop the full `orders` fetch, use the new KPI fields

**Files:**
- Modify: `components/finance/finance-workspace.tsx:88-95` (`ReconPayload` type), `:446` (`orders` state), `:457-476` (`refresh`), `:628` (KPI), `:646` (`OrdersLedger` render)

**Interfaces:**
- Consumes: `/api/reconcile`'s new `settledOrders`/`totalOrders` fields (Task 4); `OrdersLedger` with no props (Task 6 changes its signature to accept none — this task's Step 4 assumes that signature, so this task's typecheck won't be clean until Task 6 lands; that's expected and noted below).

- [ ] **Step 1: Extend `ReconPayload`**

In `components/finance/finance-workspace.tsx`, change:

```ts
type ReconPayload = {
  lines: ReconLine[];
  documents: {
    bankStatement: boolean;
    missingPayouts: { provider: string; awaitingAmount: number }[];
    range: { from: string | null; to: string | null; noStatementForRange: boolean } | null;
  };
};
```

to:

```ts
type ReconPayload = {
  lines: ReconLine[];
  settledOrders: number;
  totalOrders: number;
  documents: {
    bankStatement: boolean;
    missingPayouts: { provider: string; awaitingAmount: number }[];
    range: { from: string | null; to: string | null; noStatementForRange: boolean } | null;
  };
};
```

- [ ] **Step 2: Remove the `orders` state and its fetch**

Change:

```ts
  const [recon, setRecon] = useState<ReconPayload | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
```

to:

```ts
  const [recon, setRecon] = useState<ReconPayload | null>(null);
  const [loading, setLoading] = useState(true);
```

Change:

```ts
      const [r, o] = await Promise.all([
        fetch(`/api/reconcile${qs ? `?${qs}` : ""}`).then((x) => x.json()),
        fetch("/api/orders").then((x) => x.json()),
      ]);
      if (r.error) throw new Error(r.error);
      setRecon(r);
      setOrders(o.orders ?? []);
```

to:

```ts
      const r = await fetch(`/api/reconcile${qs ? `?${qs}` : ""}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setRecon(r);
```

- [ ] **Step 3: Update the KPI to use `recon`'s counts**

Change:

```tsx
          <Kpi label="Orders settled" value={`${orders.filter((o) => o.finance_status === "SETTLED").length} / ${orders.length}`} note="stamped by bank-confirmed payouts" tone="ok" />
```

to:

```tsx
          <Kpi label="Orders settled" value={`${recon.settledOrders} / ${recon.totalOrders}`} note="stamped by bank-confirmed payouts" tone="ok" />
```

(this line is already inside a `{recon && (...)}`-guarded block per
`showReconContext` — confirm `recon` is non-null in scope at this point in
the existing code before making this change; it is, per the surrounding
`{recon && (` wrapper already present around the `.kpis` div.)

- [ ] **Step 4: Update the `OrdersLedger` render**

Change:

```tsx
        <OrdersLedger orders={orders} loading={loading} />
```

to:

```tsx
        <OrdersLedger />
```

- [ ] **Step 5: Remove the now-unused `OrderRow` import if nothing else in this file uses it**

Run: `grep -n "OrderRow" components/finance/finance-workspace.tsx`
If the only remaining reference is the `import type { OrderRow } from "@/lib/types/orders";`
line itself, delete that import line. If anything else in the file still
uses `OrderRow`, leave the import.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: an error on `<OrdersLedger />` — `orders`/`loading` props are still
required by `OrdersLedger`'s current signature. **This is expected** — Task 6
changes that signature to accept no props. Confirm no OTHER errors exist in
`finance-workspace.tsx` itself (the `orders`/`OrderRow` cleanup in Steps 2-5
should be fully clean on its own).

- [ ] **Step 7: Commit**

```bash
git add components/finance/finance-workspace.tsx
git commit -m "$(cat <<'EOF'
FinanceWorkspace: drop the full-book /api/orders fetch

orders state was only used for one KPI (now sourced from
/api/reconcile's settledOrders/totalOrders) and to hand a pre-fetched
array to OrdersLedger, which becomes self-fetching in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(Expected to not fully typecheck until Task 6 lands — that's fine, same as
Task 2's note.)

---

### Task 6: `OrdersLedger` — self-fetching, paginated, debounced filters

**Files:**
- Modify: `components/finance/orders-ledger.tsx` (large — rewrites the top-level `OrdersLedger` function; `ExpandedOrder`, `StageTracker`, `isShippable`, `formatOrderDate`, `aed2`, `STAGES`, `STAGE_PILL` all stay untouched)

**Interfaces:**
- Consumes: `LOCATION_GROUPS`, `locationGroupFor` from `lib/orders-locations.ts` (Task 1); `/api/orders?days&page&limit&store&location&q` → `{ orders, total, page, pageSize }` (Task 2).
- Produces: `export function OrdersLedger()` — **no props** (was `{ orders, loading }`). This is the signature Task 5's `<OrdersLedger />` call already assumes.

- [ ] **Step 1: Replace the local `LOCATION_GROUPS`/`locationGroupFor` with the shared import**

Delete from `components/finance/orders-ledger.tsx`:

```ts
// Known cities per emirate/region, for the location filter dropdown. Matched
// case-insensitively against the order's `city` field, which is free text
// synced from Shopify/Woo — not every order will match a known group, so an
// unmatched order still shows up under "All locations".
const LOCATION_GROUPS: Record<string, string[]> = {
  "Dubai": ["dubai"],
  "Abu Dhabi": ["abu dhabi", "abudhabi"],
  "Sharjah": ["sharjah"],
  "Riyadh": ["riyadh"],
  "Jeddah": ["jeddah", "jedda"],
  "Other UAE": ["ajman", "fujairah", "ras al khaimah", "rak", "umm al quwain"],
  "Other KSA": ["dammam", "khobar", "mecca", "makkah", "medina"],
};

function locationGroupFor(city: string): string | null {
  const c = (city || "").toLowerCase();
  for (const [group, keywords] of Object.entries(LOCATION_GROUPS)) {
    if (keywords.some((k) => c.includes(k))) return group;
  }
  return null;
}
```

Add to the import block at the top:

```ts
import { LOCATION_GROUPS, locationGroupFor } from "@/lib/orders-locations";
```

- [ ] **Step 2: Replace the `OrdersLedger` function signature and state**

Change:

```ts
export function OrdersLedger({ orders, loading }: { orders: OrderRow[]; loading: boolean }) {
  const [store, setStore] = useState("All");
  const [location, setLocation] = useState("All locations");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<OrderRow | null>(null);
  const [shipFor, setShipFor] = useState<OrderRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Orders still waiting behind the one currently open in InvoiceModal —
  // "generate N invoices" doesn't skip the per-order confirmation step, it
  // just chains it: closing (cancel or generate) advances to the next one.
  const [invoiceQueue, setInvoiceQueue] = useState<OrderRow[]>([]);
  // Patches from status changes / a completed shipment, applied on top of
  // the fetched order so the row updates in place without a full refetch.
  const [overrides, setOverrides] = useState<Record<string, Partial<OrderRow>>>({});

  const stores = ["All", "WA", "UAE", "KSA", "WOO"];
  const locations = ["All locations", ...Object.keys(LOCATION_GROUPS)];

  const rows = useMemo(() => orders.filter((o) => {
    if (store !== "All" && o.store_id !== store) return false;
    if (location !== "All locations" && locationGroupFor(o.city) !== location) return false;
    const haystack = `${o.order_number} ${o.customer_name} ${o.gateway} ${o.city} ${o.country} ${o.customer_phone}`.toLowerCase();
    return haystack.includes(q.toLowerCase());
  }), [orders, store, location, q]);
```

to:

```ts
const PAGE_SIZE = 50;

export function OrdersLedger() {
  const [store, setStore] = useState("All");
  const [location, setLocation] = useState("All locations");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<OrderRow | null>(null);
  const [shipFor, setShipFor] = useState<OrderRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Orders still waiting behind the one currently open in InvoiceModal —
  // "generate N invoices" doesn't skip the per-order confirmation step, it
  // just chains it: closing (cancel or generate) advances to the next one.
  const [invoiceQueue, setInvoiceQueue] = useState<OrderRow[]>([]);
  // Patches from status changes / a completed shipment, applied on top of
  // the fetched page so a row updates in place without a full refetch.
  const [overrides, setOverrides] = useState<Record<string, Partial<OrderRow>>>({});

  const stores = ["All", "WA", "UAE", "KSA", "WOO"];
  const locations = ["All locations", ...Object.keys(LOCATION_GROUPS)];

  // Debounce free-text search only — store/location/page changes fetch
  // immediately, a keystroke doesn't.
  useEffect(() => {
    const id = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Any filter change resets to page 1 — only page-button clicks should
  // change `page` on their own.
  useEffect(() => { setPage(1); }, [store, location, qDebounced]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (store !== "All") params.set("store", store);
    if (location !== "All locations") params.set("location", location);
    if (qDebounced) params.set("q", qDebounced);
    fetch(`/api/orders?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setOrders(d.orders ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => { if (!cancelled) { setOrders([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, store, location, qDebounced]);

  const rows = orders;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
```

- [ ] **Step 3: Update the empty-state check**

Change:

```ts
  if (loading) return <div className="empty"><Loader2 size={18} className="animate-spin" /> Loading orders…</div>;
  if (orders.length === 0) {
    return (
      <div className="empty">
        No orders in Supabase yet. Hit <b>Sync stores</b> to pull WA / UAE / KSA Shopify and WooCommerce orders.
      </div>
    );
  }
```

to:

```ts
  if (loading && orders.length === 0) return <div className="empty"><Loader2 size={18} className="animate-spin" /> Loading orders…</div>;
  if (!loading && total === 0) {
    const filtered = store !== "All" || location !== "All locations" || qDebounced !== "";
    return (
      <div className="empty">
        {filtered
          ? "No orders match these filters."
          : <>No orders in Supabase yet. Hit <b>Sync stores</b> to pull WA / UAE / KSA Shopify and WooCommerce orders.</>}
      </div>
    );
  }
```

(`loading && orders.length === 0` avoids flashing the full-page loading state
on every subsequent page/filter change once there's already data on screen —
only the very first load shows it.)

- [ ] **Step 4: Add pagination controls below the table note**

Change:

```tsx
      <p className="table-note">{rows.length} of {orders.length} orders · settlement comes only from a bank-confirmed payout, never from the store's own "paid" flag.</p>
```

to:

```tsx
      <p className="table-note">Page {page} of {totalPages} · {total} orders total · settlement comes only from a bank-confirmed payout, never from the store's own "paid" flag.</p>

      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <button className="btn ghost small" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
            Prev
          </button>
          <span className="text-[12.5px] text-[var(--muted)]">Page {page} of {totalPages}</span>
          <button className="btn ghost small" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>
            Next
          </button>
        </div>
      )}
```

- [ ] **Step 5: Fix `startBulkInvoice`, which read `rows` expecting the full filtered set**

`startBulkInvoice` already only operates on `rows.filter((o) => selected.has(o.uid))`
— since `rows` is now just the current page (`const rows = orders;` from Step
2), this already correctly limits bulk-invoice to selected orders **on the
current page**, which is the only correct behavior now (there's no client-side
full dataset to select across pages from). No code change needed here beyond
what Step 2 already did by redefining `rows` — confirm by reading the
function, it references `rows`/`selected` exactly as before and needs no
edit.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: clean — this is the change that resolves the `<OrdersLedger />`
prop-mismatch error introduced in Task 5.

- [ ] **Step 7: Manual verification**

Per this project's `verify` skill — start the dev server, open the Orders
page, confirm: the table loads with a default 30-day window; typing in
search debounces and narrows results after ~300ms; switching store/location
tabs refetches and resets to page 1; Prev/Next page through results; the
"Page X of Y · N orders total" note updates correctly; expanding a row,
Ship/Invoice buttons, and the bulk-select-and-invoice-queue flow all still
work exactly as before on whatever page is currently loaded.

- [ ] **Step 8: Commit**

```bash
git add components/finance/orders-ledger.tsx
git commit -m "$(cat <<'EOF'
OrdersLedger: self-fetching, paginated, server-side filters

Was a pure prop-driven table over a parent-fetched full order array
with client-side filtering. Now owns its own page/filter state,
fetches /api/orders directly (debounced search, immediate on
store/location/page change), and renders Prev/Next pagination —
matches the bulk-invoice-queue and row-expand behavior unchanged,
just scoped to whatever page is currently loaded.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `React.memo` on the order row

**Files:**
- Modify: `components/finance/orders-ledger.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: an internal `OrderCard` component (extracted from the inline
  `rows.map(...)` body), memoized — no external interface change.

- [ ] **Step 1: Extract the row body into a memoized `OrderCard` component**

The current row rendering lives inline inside `rows.map((o) => { ... return
(<div key={o.uid}>...</div>); })` (roughly lines 340-399 as of Task 6's
version). Extract it to a sibling component above `OrdersLedger`:

```tsx
const OrderCard = React.memo(function OrderCard({
  order, displayOrder, isOpen, isSelected, onToggleSelect, onToggleExpand, onStageChanged, onInvoice, onShip,
}: {
  order: OrderRow; displayOrder: OrderRow; isOpen: boolean; isSelected: boolean;
  onToggleSelect: (uid: string) => void; onToggleExpand: (uid: string) => void;
  onStageChanged: (stage: string) => void; onInvoice: () => void; onShip: () => void;
}) {
  const stage = displayOrder.fulfillment_stage ?? "processing";
  const m = ORDER_STATUS_META[order.finance_status];
  const group = locationGroupFor(order.city);
  return (
    <div
      className={`overflow-hidden rounded-[14px] border bg-[var(--card)] transition-[border-color,box-shadow] ${
        isOpen ? "border-[var(--gold)] shadow-[0_4px_18px_rgba(176,131,67,.12)]" : "border-[var(--line)]"
      }`}
    >
      <div className="flex items-center gap-1.5 pl-3.5">
        <input
          type="checkbox"
          className="size-4 shrink-0 cursor-pointer accent-[var(--gold)]"
          checked={isSelected}
          onChange={() => onToggleSelect(order.uid)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select order #${order.order_number}`}
        />
        <button
          className="grid w-full grid-cols-[130px_1fr_150px_90px_100px_110px_90px_20px] items-center gap-3 px-4 py-[13px] text-left text-[13px]"
          onClick={() => onToggleExpand(order.uid)}
        >
          <div className="flex flex-col gap-0.5">
            <span className="mono">#{order.order_number}</span>
            <span className="store-badge w-fit">{order.store_id}</span>
            <span className="text-[10.5px] text-[var(--muted)]">{formatOrderDate(order.order_date)}</span>
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap" dir="auto">{order.customer_name || "—"}</div>
          <div className="flex items-center gap-[5px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[var(--muted)]">
            <MapPin size={12} />
            {group ?? [order.city, order.country].filter(Boolean).join(", ") ?? "—"}
          </div>
          <div className="text-[12.5px] text-[var(--muted)]">{order.gateway}</div>
          <span className={`rounded-full px-2.5 py-[3px] text-center text-[10.5px] font-semibold uppercase tracking-[.03em] ${STAGE_PILL[stage] ?? STAGE_PILL.processing}`}>
            {STAGES.find((s) => s.key === stage)?.label ?? stage}
          </span>
          <span className={`pill ${m.tone}`}>{m.label}</span>
          <span className="mono text-right font-semibold">{aed2(Number(order.gross_aed))}</span>
          <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-[var(--muted)]">
            <ChevronDown size={16} />
          </motion.span>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <ExpandedOrder
            order={displayOrder}
            onStageChanged={onStageChanged}
            onInvoice={onInvoice}
            onShip={onShip}
          />
        )}
      </AnimatePresence>
    </div>
  );
});
```

Add `import React from "react";` if not already present (the file already
imports specific hooks from `"react"` — change that import line to also
bring in the default export, e.g. `import React, { useCallback, useEffect,
useMemo, useState } from "react";`).

- [ ] **Step 2: Replace the inline row body with `<OrderCard>`**

Change the `rows.map((o) => { ... })` body to:

```tsx
        {rows.map((o) => {
          const displayOrder = { ...o, ...overrides[o.uid] };
          const isOpen = expanded === o.uid;
          return (
            <OrderCard
              key={o.uid}
              order={o}
              displayOrder={displayOrder}
              isOpen={isOpen}
              isSelected={selected.has(o.uid)}
              onToggleSelect={toggleSelect}
              onToggleExpand={(uid) => setExpanded(isOpen ? null : uid)}
              onStageChanged={(newStage) => patch(o.uid, { fulfillment_stage: newStage })}
              onInvoice={() => setInvoiceFor(o)}
              onShip={() => setShipFor(displayOrder)}
            />
          );
        })}
```

`toggleSelect` is already wrapped in `useCallback` (unchanged from before) so
its identity is stable across renders — `OrderCard`'s `React.memo` only
re-renders a given card when ITS `order`/`displayOrder`/`isOpen`/`isSelected`
actually change, not when a sibling row's stage updates (which only changes
that sibling's `overrides` entry and thus only that sibling's `displayOrder`).
`onToggleExpand`, `onStageChanged`, `onInvoice`, `onShip` are inline closures
recreated each render (capturing `o`/`displayOrder`) — acceptable here since
`React.memo`'s default shallow-prop comparison still correctly skips the
*expensive* re-render (the row's JSX subtree) for unrelated rows; only a
literal function-identity check would fail on every row regardless, so this
still needs a custom comparator to fully avoid re-invoking `OrderCard`'s
function body. Add one:

```tsx
const OrderCard = React.memo(function OrderCard({ /* ...as above... */ }: { /* ...as above... */ }) {
  /* ...as above... */
}, (prev, next) =>
  prev.order === next.order &&
  prev.displayOrder.fulfillment_stage === next.displayOrder.fulfillment_stage &&
  prev.displayOrder.awb_number === next.displayOrder.awb_number &&
  prev.displayOrder.label_url === next.displayOrder.label_url &&
  prev.displayOrder.courier === next.displayOrder.courier &&
  prev.isOpen === next.isOpen &&
  prev.isSelected === next.isSelected,
);
```

(comparing the specific `displayOrder` fields that `patch()`/`onShipped` ever
write, per `orders-ledger.tsx`'s existing `overrides` usage — `fulfillment_stage`,
`awb_number`, `label_url`, `courier` — rather than a deep-equal on the whole
object, keeps this cheap.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: clean.

- [ ] **Step 4: Manual verification**

Per this project's `verify` skill — expand two different rows, click a
stage-tracker button on one; confirm the other row's expanded content doesn't
visibly flicker/reset (open React DevTools' "Highlight updates when
components render" if available to directly confirm only the changed row
re-renders).

- [ ] **Step 5: Commit**

```bash
git add components/finance/orders-ledger.tsx
git commit -m "$(cat <<'EOF'
Memoize order row rendering with React.memo

Extracts the per-row body into OrderCard with a targeted prop
comparator (order identity, the specific displayOrder fields patch()
ever writes, isOpen, isSelected) so a stage update on one row doesn't
re-render the other 49 on the page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full regression pass

**Files:** None modified — verification only.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the new `tests/repositories/orders-query.test.ts`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: clean.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 4: Manual end-to-end verification**

Per this project's `verify` skill, with the app running against the real dev
Supabase instance:
- Orders page: default 30-day window loads; search/store/location filters
  narrow correctly and reset to page 1; Prev/Next work; bulk-select +
  "Generate N invoices" queue still works; Ship/Invoice modals still open
  (per the earlier portal-based fix) and function; row expand still lazy-loads
  line items via `/api/orders/:uid`.
- Dashboard: KPIs, trend chart, gateway/store splits, top products, and the
  "Most recent order" spotlight all show data consistent with pre-change
  values on the same day window (spot-check `settledOrders`/`totalOrders`/
  `codPending*` specifically, since those are the ones that must stay
  all-time — verify they do NOT shrink when switching to a narrow `days`
  window like 7).
- Reconciliation/Sales/Payouts/Returns views: "Orders settled X/Y" KPI still
  shows a sane number matching Dashboard's `settledOrders`/`totalOrders`.

- [ ] **Step 5: Flag the pending manual DB step**

In the final summary to the founder, note explicitly: the index migration in
Task 1 Step 4 (`db/schema.sql`) needs to be run against the live Supabase
database via the SQL editor — it wasn't auto-applied by anything in this
plan, matching how every prior migration in this project has been deployed.
