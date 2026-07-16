-- Omnia Finance OS — additive migration over the EXISTING Supabase schema.
-- Tables orders / stores / bank_lines / payouts / payout_transactions /
-- recon_lines already exist; we only add the columns the parsers produce.

-- bank_lines: statement parser output needs bank reference, direction,
-- classification confidence (credits) and outflow kind (debits).
alter table bank_lines add column if not exists reference  text not null default '';
alter table bank_lines add column if not exists direction  text not null default 'credit';
alter table bank_lines add column if not exists confidence text;
alter table bank_lines add column if not exists kind       text;
alter table bank_lines add column if not exists batch_id   text;

-- idempotent re-upload of the same statement, in ANY format: the fingerprint
-- (date|direction|amount|reference|desc-prefix) is stable across the PDF and
-- CSV renderings of one transaction, while raw description text is not.
alter table bank_lines add column if not exists dedupe_key text;
drop index if exists bank_lines_dedupe_idx;
create unique index if not exists bank_lines_dedupe_key_idx on bank_lines (dedupe_key);

-- payouts: keep the uploaded filename for provenance
alter table payouts add column if not exists source text;

-- payouts: pre-AED-conversion total, for currencies quoted uniformly across
-- the whole statement (Tabby/Tamara SAR & KWD files). Lets the reconciliation
-- engine re-derive the AED amount using the bank's own quoted wire rate
-- (parsed from the credit narration) instead of a static, drifting estimate.
alter table payouts add column if not exists original_currency text;
alter table payouts add column if not exists net_original      numeric;

-- recon_lines: reconciliation engine state + audit fields.
-- A credit AWAITING_PAYOUT has no payout yet — payout fields must be nullable.
alter table recon_lines alter column payout_id drop not null;
alter table recon_lines alter column expected_net drop not null;
alter table recon_lines add column if not exists resolved_orders  text[] not null default '{}';
alter table recon_lines add column if not exists unresolved_refs  text[] not null default '{}';
alter table recon_lines add column if not exists confirmed_by     text;
alter table recon_lines add column if not exists confirmed_at     timestamptz;

-- one recon line per bank line (engine recomputes idempotently)
create unique index if not exists recon_lines_bank_line_idx on recon_lines (bank_line_id);

-- sync upserts key on uid (store + source order id)
create unique index if not exists orders_uid_idx on orders (uid);

-- line items ride along on the order row (top-products analytics)
alter table orders add column if not exists line_items jsonb not null default '[]';

-- fulfillment facts for the order spotlight (courier + tracking from the store)
alter table orders add column if not exists courier         text not null default '';
alter table orders add column if not exists tracking_number text not null default '';
alter table orders add column if not exists tracking_url    text not null default '';

-- raw uploaded documents (bank statements + gateway payout files): the founder
-- can re-download exactly what was ingested. Files are small; base64 in-row.
create table if not exists uploaded_files (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'omnia',
  kind          text not null,          -- 'bank' | 'payout'
  provider      text,                   -- gateway name for payout files
  filename      text not null,
  mime          text,
  size_bytes    integer,
  content_base64 text not null,
  parse_summary text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists uploaded_files_kind_idx on uploaded_files (kind, uploaded_at desc);

-- settlement_records: the audit trail. One row per order the moment its bank
-- credit is confirmed SETTLED — immutable proof (date, gateway, bank
-- reference, amount) that Zoho Books / an accountant can reconcile against,
-- independent of whatever the live tables look like later.
create table if not exists settlement_records (
  id              text primary key,  -- order_uid + bank_line_id, stable across recomputes
  tenant_id       text not null default 'omnia',
  order_uid       text not null,
  order_number    text not null,
  store_id        text not null,
  customer_name   text not null default '',
  customer_email  text not null default '',
  order_date      timestamptz,
  settlement_date date,              -- bank statement date of the confirming credit
  gateway         text not null,
  currency        text not null default 'AED',
  gross_aed       numeric not null default 0,
  bank_line_id    text not null,
  payout_id       text,
  bank_reference  text not null default '',
  recorded_at     timestamptz not null default now()
);
create index if not exists settlement_records_date_idx on settlement_records (settlement_date desc);
create index if not exists settlement_records_gateway_idx on settlement_records (gateway);

-- sync_runs: audit trail for the persistent payout-verification loop (in-app
-- scheduler + manual triggers). One row per cycle: what each gateway API
-- returned and what the reconciliation pass found afterwards.
create table if not exists sync_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'omnia',
  trigger       text not null,          -- 'scheduler' | 'manual'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  gateway_results jsonb not null default '[]',  -- [{provider, fetched, saved, error?}]
  recon_summary jsonb,                   -- {total, settled, awaitingPayout, variance, ordersUnresolved}
  error         text
);
create index if not exists sync_runs_started_idx on sync_runs (started_at desc);

-- ad_campaigns / ad_insights: normalized campaign performance pulled from Meta,
-- Google Ads, TikTok, and Snapchat, mapped onto our stores (WOO/KSA/UAE) via
-- lib/ads-accounts.ts. One row per campaign; insights are a daily rollup so
-- spend can be joined against orders.gross_aed by date + store_id.
create table if not exists ad_campaigns (
  id            text primary key,        -- platform:campaign_id, stable across syncs
  tenant_id     text not null default 'omnia',
  platform      text not null,           -- 'meta' | 'google' | 'tiktok' | 'snap'
  account_id    text not null,
  store_id      text not null,           -- 'WOO' | 'KSA' | 'UAE'
  name          text not null,
  status        text not null default 'unknown',
  created_at    timestamptz not null default now()
);
create index if not exists ad_campaigns_store_idx on ad_campaigns (store_id);

create table if not exists ad_insights (
  id               text primary key,     -- campaign_id|date, upsert key
  campaign_id      text not null references ad_campaigns(id),
  date             date not null,
  spend            numeric not null default 0,
  currency         text not null default 'AED',
  impressions      integer not null default 0,
  clicks           integer not null default 0,
  conversions      numeric not null default 0,
  conversion_value numeric not null default 0,
  synced_at        timestamptz not null default now()
);
create index if not exists ad_insights_date_idx on ad_insights (date desc);
create index if not exists ad_insights_campaign_idx on ad_insights (campaign_id);

-- ad_sync_runs: audit trail for the ad-platform polling loop, same shape as
-- sync_runs but keyed on platform instead of payment gateway.
create table if not exists ad_sync_runs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default 'omnia',
  trigger          text not null,          -- 'scheduler' | 'manual'
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  platform_results jsonb not null default '[]',  -- [{platform, fetched, saved, error?}]
  error            text
);
create index if not exists ad_sync_runs_started_idx on ad_sync_runs (started_at desc);

-- payout_transactions: description "quality" (blank/unparseable/multi/note/
-- clean/refund) per order-ref share, so messy Stripe descriptions surface as
-- reviewable exceptions instead of silently mis-resolving.
alter table payout_transactions add column if not exists quality text;

-- recon_lines: refund refs (matched to an order but reversing money, not
-- settling it) and quality-flagged transactions, surfaced separately from
-- resolved_orders/unresolved_refs so a founder can review them without the
-- state machine (SETTLED/AWAITING_PAYOUT/etc) changing meaning.
alter table recon_lines add column if not exists refunded_orders text[] not null default '{}';
alter table recon_lines add column if not exists quality_issues  jsonb not null default '[]';

-- zoho_items: Zoho Inventory's authoritative stock_on_hand per SKU, upserted
-- on every sync. This is the "source of truth" side of the three-way
-- inventory comparison (Zoho vs live Shopify vs live WooCommerce).
create table if not exists zoho_items (
  item_id         text primary key,
  tenant_id       text not null default 'omnia',
  sku             text not null default '',
  name            text not null default '',
  stock_on_hand   numeric not null default 0,
  available_stock numeric not null default 0,
  rate            numeric not null default 0,
  status          text not null default '',
  synced_at       timestamptz not null default now()
);
create index if not exists zoho_items_sku_idx on zoho_items (sku);

-- zoho_orders: Zoho sales orders, used to detect store orders that never
-- made it into Zoho (missing invoice/salesorder = a bookkeeping gap).
create table if not exists zoho_orders (
  salesorder_id     text primary key,
  tenant_id         text not null default 'omnia',
  salesorder_number text not null default '',
  reference_number  text not null default '',
  status            text not null default '',
  order_status      text not null default '',
  total             numeric not null default 0,
  order_date        date,
  synced_at         timestamptz not null default now()
);
create index if not exists zoho_orders_ref_idx on zoho_orders (reference_number);
create index if not exists zoho_orders_number_idx on zoho_orders (salesorder_number);

-- store_inventory: live stock snapshots from Shopify (per store) and
-- WooCommerce, normalized to one SKU-keyed row per (store_id, sku) so it can
-- be diffed against zoho_items.stock_on_hand regardless of which platform's
-- inventory representation (variant-level vs product-level) produced it.
create table if not exists store_inventory (
  id              text primary key,  -- store_id|sku, upsert key
  tenant_id       text not null default 'omnia',
  store_id        text not null,     -- 'WA' | 'UAE' | 'KSA' | 'WOO'
  sku             text not null,
  quantity        numeric,
  product_title   text not null default '',
  product_status  text not null default '',
  synced_at       timestamptz not null default now()
);
create index if not exists store_inventory_sku_idx on store_inventory (sku);
create index if not exists store_inventory_store_idx on store_inventory (store_id);

-- zoho_sync_runs: audit trail for the Zoho + live-inventory polling loop,
-- same shape as sync_runs / ad_sync_runs.
create table if not exists zoho_sync_runs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default 'omnia',
  trigger          text not null,          -- 'scheduler' | 'manual'
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  source_results   jsonb not null default '[]',  -- [{source, fetched, saved, error?}]
  error            text
);
create index if not exists zoho_sync_runs_started_idx on zoho_sync_runs (started_at desc);
