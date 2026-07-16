# Ad Platform Connectors — Design Spec

Date: 2026-07-15
Status: Approved, ready for implementation planning

## Context

This is sub-project 1 of 4 in the founder's broader ask for cross-platform marketing
visibility (analytics per store, ad connectors, real-time website monitoring, AI
awareness). The other three are deferred to future specs:

- Real per-store sales analytics (replace the placeholder `/app/analytics` page)
- Real-time website interaction/performance monitoring
- AI chat awareness of #2/#3 data (a thin layer once those exist)

This spec covers **only** the ad platform connectors: pulling campaign performance and
platform-reported conversions from Meta, Google (Ads + YouTube), TikTok, and Snapchat,
and surfacing them per store alongside actual store revenue.

## Scope decisions

- **Platforms in scope:** Meta, Google Ads/YouTube, TikTok, Snapchat.
- **LinkedIn is out of scope** — not actively running campaigns.
- **Data pulled:** daily campaign-level rollups (spend, impressions, clicks,
  platform-reported conversions and conversion value). No pixel/event-level data, no
  attribution modeling. Platform-reported conversions are shown side-by-side with actual
  store revenue (from the existing `orders` table) as two distinct, honestly-labeled
  numbers — not blended into a single computed "true ROAS".
- **Sync cadence:** polling every 15 minutes via the existing in-app scheduler
  (`instrumentation.ts` → `lib/scheduler`), same pattern as payout-sync. Ad platforms'
  reporting APIs are pull-based with their own internal lag (typically 15min–3hrs) —
  there is no webhook that pushes spend data in real time. True real-time webhooks only
  apply to pixel/conversion events fired from the founder's own websites, which belongs
  to the website-monitoring sub-project, not this one.
- **Credentials:** static long-lived tokens via `.env`, matching the existing
  `SHOPIFY_*_TOKEN` / `TELR_*` / `STRIPE_*` convention. No in-app OAuth consent UI.
  Google Ads is the one exception — its API requires a one-time OAuth grant to mint a
  refresh token (no simple long-lived token exists for it), but once minted it refreshes
  automatically server-side with no UI, so it still fits the "set once in `.env`" model.

## Store ↔ ad account mapping

Confirmed with the founder, hardcoded (not built as a self-service UI):

| Platform            | Account(s)                  | Store          |
|----------------------|------------------------------|----------------|
| Meta Main            | 2 ad accounts                 | `woo`          |
| Meta KSA             | 1 ad account                  | `shopify_ksa`  |
| TikTok               | 1 advertiser                  | `woo`          |
| Google (Ads/YouTube) | 1 customer account            | `woo`          |
| Snapchat             | 1 ad account                  | `shopify_uae`  |
| —                    | —                              | `shopify_wa` (no ad spend yet, omitted) |

The founder confirmed the ".com" domain Google targets is the same site as the
WooCommerce store — both map to `store: "woo"`.

## Architecture

```
lib/integrations/ads/
  types.ts      # canonical NormalizedInsight shape
  meta.ts       # Meta Marketing API — Main (2 accounts) + KSA account
  google.ts     # Google Ads API (reporting via GAQL)
  tiktok.ts     # TikTok Ads API
  snap.ts       # Snapchat Marketing API

lib/ads-accounts.ts             # static account -> store mapping (table above)
lib/scheduler/ad-sync.ts        # new scheduler job, mirrors payout-sync scheduler
lib/repositories/ad-insights-repo.ts   # upsert/query layer over ad_campaigns/ad_insights
```

Each platform file exposes one function:

```ts
fetchInsights(dateRange: { from: string; to: string }): Promise<NormalizedInsight[]>
```

`NormalizedInsight` is the single canonical shape every platform's response is flattened
into:

```ts
{
  platform: 'meta' | 'google' | 'tiktok' | 'snap'
  accountId: string
  campaignId: string
  campaignName: string
  date: string            // YYYY-MM-DD
  spend: number
  currency: string
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
}
```

Nothing downstream (scheduler, repository, UI, AI tools) needs to know which platform a
row originated from beyond the `platform` field — nothing platform-specific leaks past
the `lib/integrations/ads/*.ts` boundary.

## Data model

Additive migration in `db/schema.sql`:

```sql
create table if not exists ad_campaigns (
  id            text primary key,        -- platform:campaign_id, stable across syncs
  tenant_id     text not null default 'omnia',
  platform      text not null,           -- 'meta' | 'google' | 'tiktok' | 'snap'
  account_id    text not null,
  store_id      text not null,           -- 'woo' | 'shopify_ksa' | 'shopify_uae'
  name          text not null,
  status        text not null default 'unknown',
  created_at    timestamptz not null default now()
);

create table if not exists ad_insights (
  id               text primary key,     -- campaign_id|date, upsert key
  campaign_id      text not null references ad_campaigns(id),
  date             date not null,
  spend            numeric not null default 0,
  currency         text not null default 'AED',
  impressions      integer not null default 0,
  clicks            integer not null default 0,
  conversions       numeric not null default 0,
  conversion_value  numeric not null default 0,
  synced_at         timestamptz not null default now()
);
create index if not exists ad_insights_date_idx on ad_insights (date desc);
create index if not exists ad_insights_campaign_idx on ad_insights (campaign_id);

create table if not exists ad_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'omnia',
  trigger        text not null,          -- 'scheduler' | 'manual'
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  platform_results jsonb not null default '[]',  -- [{platform, fetched, saved, error?}]
  error          text
);
```

`ad_insights` is a daily rollup per campaign, joinable against the existing `orders`
table on `date` + `store_id` to show ad spend next to actual store revenue for the same
window.

## Scheduler behavior

- Runs every 15 minutes, extending the existing in-app scheduler.
- Each cycle fetches a rolling window (today + yesterday) per platform, to catch
  late-arriving/revised same-day stats.
- Each platform's fetch+upsert is wrapped independently — one platform's failure (e.g.
  an expired token) never blocks the other three.
- One row per cycle in `ad_sync_runs`, with a per-platform result array — mirrors
  `sync_runs` for payout-sync.
- A manual "Sync now" trigger reuses the same function the scheduler calls, exposed via
  the Reports/Marketing UI.

## Credentials (.env additions)

```
META_MAIN_ACCESS_TOKEN, META_MAIN_AD_ACCOUNT_IDS       # comma-separated, 2 ids
META_KSA_ACCESS_TOKEN,  META_KSA_AD_ACCOUNT_ID
GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_CUSTOMER_ID
TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID
SNAP_ACCESS_TOKEN, SNAP_AD_ACCOUNT_ID
```

Generating each of these (which developer console screen, which scopes) happens during
implementation, platform by platform.

## UI surface

New page: `/app/marketing` (kept separate from `/app/analytics`, which is reserved for
the deferred per-store sales-analytics sub-project).

- Store filter tabs: Woo, Shopify KSA, Shopify UAE (Shopify WA omitted until it has ad
  spend).
- Per-store summary cards: total spend, platform-reported conversions/value, and actual
  store revenue for the selected range — shown as two distinct columns, never blended.
- Campaign table: one row per campaign, sortable by spend/conversions, platform badge
  per row (a store like `woo` can have rows from Meta, TikTok, and Google at once).
- Sync status badge + "Sync now" button, same component pattern as the existing
  payout-sync badge in Reports.

## AI chat extension

Two new read-only tools added to the existing `lib/ai` tool suite, following the same
guardrails as the current 7 tools (tenant-scoped, read-only, no raw SQL):

- `getAdSpend({ store?, platform?, dateRange })`
- `getCampaignPerformance({ store?, platform?, limit })`

Both query `ad_insights`/`ad_campaigns` directly through the repository layer — no new
guardrail logic needed since the existing pattern already covers this.

## Explicitly out of scope for this spec

- LinkedIn connector.
- Pixel/event-level conversion tracking and any attribution modeling.
- Self-service OAuth connect UI (all credentials are static `.env` tokens except
  Google's one-time refresh-token mint).
- Shopify WA store (no ad accounts target it yet).
- The other three sub-projects (per-store sales analytics, website monitoring, deeper AI
  integration) — each gets its own spec later.

## Testing approach

- Unit tests per platform integration file: feed a captured sample API response through
  `fetchInsights()`, assert the normalized `NormalizedInsight[]` output shape and values.
- Repository layer tests: upsert idempotency (re-running a sync for the same
  campaign+date doesn't duplicate rows, just updates `synced_at`/values).
- Scheduler test: one platform's fetch throwing doesn't prevent the other three from
  completing, and the failure is captured in `ad_sync_runs.platform_results`.
