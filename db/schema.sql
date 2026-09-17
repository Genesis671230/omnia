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

-- internal ops workflow, distinct from the store-synced fulfillment_status
-- (which reflects Shopify/Woo, not the founder's own pack-and-ship process).
-- Progression is one-directional in the UI (no back-arrow) but the column
-- itself allows any value change, since an ops mistake needs to be correctable.
alter table orders add column if not exists fulfillment_stage            text not null default 'processing';
alter table orders add column if not exists fulfillment_stage_updated_at timestamptz;
alter table orders add column if not exists fulfillment_stage_updated_by text not null default '';

-- SMSA AWB issuance. `courier` above already exists (Shopify/Woo tracking);
-- these are set only by the /ship endpoint. shipped_at is distinct from
-- fulfillment_stage_updated_at — a stage change is a founder click, an AWB
-- is an external system confirming the label was actually issued.
alter table orders add column if not exists awb_number text not null default '';
alter table orders add column if not exists shipped_at  timestamptz;
alter table orders add column if not exists label_url   text not null default '';
alter table orders add column if not exists ship_error  text not null default '';

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

-- payout_transactions: the per-order amounts exactly as they appear in the
-- source payout file, before any AED conversion — e.g. a Tabby SAR row's own
-- Order Amount/Total Deduction/Transferred amount. Nullable: AED-native
-- payouts (COD, Stripe, Checkout) have no separate "original" currency, and
-- older rows parsed before this column existed have none recorded. The
-- payout's own original_currency (above) says what currency these are in.
alter table payout_transactions add column if not exists gross_original numeric;
alter table payout_transactions add column if not exists fee_original   numeric;
alter table payout_transactions add column if not exists net_original   numeric;
-- VAT a gateway charges on top of its fee, when the statement itemises it
-- (Tamara "VAT Collected by Tamara"); null/0 where the fee already includes VAT.
alter table payout_transactions add column if not exists vat_aed        numeric;
alter table payout_transactions add column if not exists vat_original   numeric;

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

-- purchase_rate: Zoho's own cost basis for the item (its /items API already
-- returns this alongside rate — we just weren't storing it). rate is the
-- SALE price, not cost; the CFO digest's profit/COGS math needs the real
-- cost basis, not list price.
alter table zoho_items add column if not exists purchase_rate numeric not null default 0;

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

-- ad_insights: purchase-funnel stages. The founder's "actual money leads"
-- means this funnel — the Meta accounts run no lead-gen campaigns at all
-- (objectives are only OUTCOME_AWARENESS / LINK_CLICKS / OUTCOME_SALES).
-- Live 30d shape: LPV 24,455 -> view_content 30,964 -> add_to_cart 2,442 ->
-- initiate_checkout 756 -> purchase 653; the view_content -> add_to_cart step
-- drops 92%, the largest weak spot. `purchase` maps to the existing
-- conversions column. Only Meta populates these; other platforms store 0.
alter table ad_insights add column if not exists landing_page_views integer not null default 0;
alter table ad_insights add column if not exists view_content       integer not null default 0;
alter table ad_insights add column if not exists add_to_cart        integer not null default 0;
alter table ad_insights add column if not exists initiate_checkout  integer not null default 0;

-- orders: at tens of thousands of rows and growing, the ledger and dashboard
-- now query by date range, store, and free-text search server-side instead
-- of fetching everything and filtering in JS — these indexes make that fast.
create index if not exists orders_date_idx on orders (order_date desc);
create index if not exists orders_store_date_idx on orders (store_id, order_date desc);
create extension if not exists pg_trgm;
create index if not exists orders_customer_name_trgm_idx on orders using gin (customer_name gin_trgm_ops);
create index if not exists orders_order_number_trgm_idx on orders using gin (order_number gin_trgm_ops);
create index if not exists orders_city_trgm_idx on orders using gin (city gin_trgm_ops);

-- settlement evidence: automatic (Stripe API match) or human-confirmed
-- (uploaded document + public confirm link). Gates Zoho Books publish.
alter table settlement_records add column if not exists evidence_type text;
alter table settlement_records add column if not exists evidence_confirmed boolean not null default false;
alter table settlement_records add column if not exists evidence_confirmed_by text;
alter table settlement_records add column if not exists evidence_confirmed_at timestamptz;
alter table settlement_records add column if not exists evidence_document_id uuid;
alter table settlement_records add column if not exists zoho_payment_id text;
alter table settlement_records add column if not exists zoho_published_at timestamptz;
create index if not exists settlement_records_evidence_idx on settlement_records (evidence_confirmed, zoho_payment_id);

-- Gateway fee / VAT / FX booking (lib/finance/settlement-posting.ts). Each
-- order posts up to three Zoho documents; each id column holds either the
-- Zoho id or a PENDING:<attempt> marker while the write is in flight, so a
-- retry after a timeout checks Zoho first instead of posting twice.
-- zoho_claimed_at is a short row lease against two concurrent publishes.
alter table settlement_records add column if not exists zoho_claimed_at timestamptz;
alter table settlement_records add column if not exists zoho_invoice_id text;
alter table settlement_records add column if not exists zoho_fee_expense_id text;
alter table settlement_records add column if not exists zoho_fx_journal_id text;
alter table settlement_records add column if not exists fee_aed numeric;
alter table settlement_records add column if not exists fee_vat_aed numeric;
alter table settlement_records add column if not exists fx_difference_aed numeric;
alter table settlement_records add column if not exists zoho_post_error text;

-- one uploaded statement can evidence many orders (e.g. one Tabby payout
-- file covering 40 settled orders) — parent row + join table, not a single
-- FK on settlement_records.
create table if not exists settlement_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'omnia',
  uploaded_file_id uuid not null references uploaded_files(id),
  confirm_token text not null unique,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists settlement_documents_token_idx on settlement_documents (confirm_token);

create table if not exists settlement_document_links (
  settlement_document_id uuid not null references settlement_documents(id),
  settlement_record_id text not null references settlement_records(id),
  primary key (settlement_document_id, settlement_record_id)
);

-- zoho_publish_runs: audit trail for POST /api/settlements/publish, same
-- shape as sync_runs/zoho_sync_runs/ad_sync_runs — one row per batch call,
-- since this route writes real Customer Payments into Zoho Books.
create table if not exists zoho_publish_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'omnia',
  trigger       text not null default 'manual',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  results       jsonb not null default '[]',  -- [{settlementId, ok, error?, paymentId?, needsManualReview?}]
  error         text
);
create index if not exists zoho_publish_runs_started_idx on zoho_publish_runs (started_at desc);

-- customer_id: deterministic identity key ('email:<normalized>' or
-- 'phone:<last9digits>') stamped on every order at sync time
-- (lib/customer-identity.ts) — lets customer lookups use a direct index
-- instead of re-matching email/phone across the whole order book.
alter table orders add column if not exists customer_id text;
create index if not exists orders_customer_id_idx on orders (customer_id);

-- customers: a `customers` table already existed (id/tenant_id/email/
-- phone/name/country/city/shopify_ids/woo_ids/first_order_date/
-- total_orders/total_returns/flag_score — empty, unused by any code,
-- apparently scaffolded for a different, never-built fraud/returns-risk
-- feature). Per founder decision, that table is kept as-is and this only
-- ADDS the columns needed for spend/LTV tracking derived from orders
-- (lib/repositories/customers.repository.ts, CustomersRepository.rebuildAll).
-- id/tenant_id/email/phone/name/first_order_date/total_orders are reused
-- from the existing table, not redefined here.
alter table customers add column if not exists matched_by             text not null default '';
alter table customers add column if not exists stores                 text[] not null default '{}';
alter table customers add column if not exists total_spend_aed        numeric not null default 0;
alter table customers add column if not exists aov_aed                numeric not null default 0;
alter table customers add column if not exists last_order_date        timestamptz;
alter table customers add column if not exists expected_ltv_next_year numeric not null default 0;
alter table customers add column if not exists updated_at             timestamptz not null default now();
create index if not exists customers_total_spend_idx on customers (total_spend_aed desc);

-- tasks: lightweight actionable work items created from dashboard insights
-- ("Assign task" on an insight card) or manually. Deliberately minimal — the
-- employee-performance module (phase 4) builds on this same table rather than
-- introducing a second task store.
create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default 'omnia',
  title       text not null,
  detail      text not null default '',
  source      text not null default 'manual',   -- 'insight' | 'manual'
  source_ref  text not null default '',         -- insight fact id when source='insight'
  assignee    text not null default '',
  status      text not null default 'open',     -- 'open' | 'in_progress' | 'done'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_status_idx on tasks (status, created_at desc);

-- insight_runs: cached output of the dashboard insight engine. facts are the
-- deterministic rule detections (every number the UI shows comes from here);
-- cards are the AI-phrased headline/why/recommendation layer keyed by fact id.
-- The dashboard serves the latest fresh run instead of re-running rules + AI
-- on every page load.
create table if not exists insight_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default 'omnia',
  generated_at timestamptz not null default now(),
  window_days  int not null default 30,
  store        text not null default 'All',
  facts        jsonb not null default '[]',
  cards        jsonb not null default '[]',
  model        text not null default ''
);
create index if not exists insight_runs_generated_idx on insight_runs (generated_at desc);

-- ── Reconciliation actions layer (2026-07-23) ────────────────────────────────

-- recon_lines review flags: a founder can mark a credit "needs a look" even
-- when the math foots (an amount that looks wrong, a gateway to chase). Lives
-- on recon_lines rather than a new table because that row is already the
-- per-credit audit record (confirmed_by/confirmed_at). persistResults() upserts
-- only the columns it names, so a recompute never clears a flag.
alter table recon_lines add column if not exists review_flag boolean not null default false;
alter table recon_lines add column if not exists review_note text not null default '';

-- zoho_postings: what has actually been written to Zoho Books, one row per
-- bank credit. Without this, the "Post to Zoho" button double-counts real money
-- on a double click — the API had no memory of what it had already posted.
-- The unique index on bank_line_id IS the idempotency guarantee.
create table if not exists zoho_postings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default 'omnia',
  bank_line_id     text not null,
  gateway          text not null,
  payout_id        text,
  reference_number text not null default '',
  net_aed          numeric not null default 0,
  gross_aed        numeric not null default 0,
  fee_aed          numeric not null default 0,
  -- 'posted' | 'partial' — partial means one leg reached Zoho and the other
  -- failed, which strands money in the clearing account and needs a human.
  status           text not null default 'posted',
  zoho_result      jsonb not null default '[]',
  error            text not null default '',
  posted_by        text not null default '',
  posted_at        timestamptz not null default now()
);
create unique index if not exists zoho_postings_bank_line_idx on zoho_postings (bank_line_id);

-- zoho_account_config: the chart-of-accounts mapping payout posting needs
-- (bank account, fee account, one clearing account per gateway). Previously
-- env-only (ZOHO_CLEARING_ACCOUNTS json), which made a wrong ID invisible
-- until the moment a real payout was posted. Single row, id='omnia'.
create table if not exists zoho_account_config (
  id                  text primary key default 'omnia',
  tenant_id           text not null default 'omnia',
  bank_account_id     text not null default '',
  fee_account_id      text not null default '',
  clearing_by_gateway jsonb not null default '{}',
  updated_at          timestamptz not null default now(),
  updated_by          text not null default ''
);

-- Bulk bank-statement-to-Zoho feature (2026-07-23). Independent of the
-- gateway-payout clearing-account flow above — see
-- docs/superpowers/specs/2026-07-23-bulk-bank-transactions-to-zoho-design.md.

-- Bookkeeper's override description, used only when posting to Zoho. The
-- original parsed narration in `description` is never overwritten — other
-- reconciliation UI and the dedupe/matching logic depend on it unchanged.
alter table bank_lines add column if not exists zoho_description text;

-- What this feature has posted. Deliberately separate from zoho_postings
-- (shaped for payout net/gross/fee triples) — a plain bank transaction is a
-- single amount against a single category account, a different shape.
create table if not exists zoho_bank_txn_postings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'omnia',
  bank_line_id         text not null,
  direction            text not null,
  transaction_type     text not null default '',
  category_account_id  text not null default '',
  reference_number     text not null default '',
  amount               numeric not null default 0,
  zoho_transaction_id  text,
  status               text not null default 'posted',
  error                text not null default '',
  posted_by            text not null default '',
  posted_at            timestamptz not null default now()
);
create unique index if not exists zoho_bank_txn_postings_line_idx on zoho_bank_txn_postings (bank_line_id);

-- Extends the existing single-row account-mapping config with the fields
-- this feature needs: one income account for all credits, one expense
-- account per debit kind (salary/supplier/fee/tax/transfer/other).
alter table zoho_account_config add column if not exists default_income_account_id text not null default '';
alter table zoho_account_config add column if not exists expense_account_by_kind jsonb not null default '{}';

-- telegram_poll_state: one row per bot (long-polling, not a webhook — no
-- public URL needed). last_update_id is Telegram's own cursor; persisting it
-- means a restart resumes from where it left off instead of either
-- replaying old messages or silently skipping ones that arrived while down.
create table if not exists telegram_poll_state (
  bot            text primary key,  -- 'ops' | 'cfo'
  last_update_id bigint not null default 0,
  updated_at     timestamptz not null default now()
);

-- group_members: who's in the Omnia ops Telegram group and what they do,
-- captured via the welcome-flow so the bots can later reference/assign work
-- by role instead of treating everyone as an anonymous tagger.
create table if not exists group_members (
  user_id          bigint primary key,
  tenant_id        text not null default 'omnia',
  username         text not null default '',
  display_name     text not null default '',
  role_description text not null default '',
  awaiting_role    boolean not null default false,
  joined_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- group_messages: raw log of group chat text, feeding the daily rollup
-- below. Kept lean (no media/attachments) — this is for "what did the team
-- discuss today", not a full chat archive.
create table if not exists group_messages (
  id         bigserial primary key,
  tenant_id  text not null default 'omnia',
  chat_id    text not null,
  user_id    bigint,
  username   text not null default '',
  text       text not null default '',
  sent_at    timestamptz not null default now()
);
create index if not exists group_messages_sent_at_idx on group_messages (sent_at desc);

-- group_daily_summaries: one AI-generated rollup per Dubai calendar day, so
-- the CFO/ops bots have continuity across days without re-reading the full
-- raw log every time.
create table if not exists group_daily_summaries (
  date_iso_day text primary key,
  tenant_id    text not null default 'omnia',
  summary      text not null default '',
  message_count integer not null default 0,
  created_at   timestamptz not null default now()
);

-- order_sync_runs: audit trail for the persistent order-sync scheduler
-- (Shopify + Woo -> orders table -> Telegram/Sheets alerts, every ~2min).
-- Added after the scheduler silently stopped ticking during dev (a Next.js
-- hot-reload disrupted the long-running setInterval) with zero visibility
-- into it — this makes that detectable instead of having to reverse-engineer
-- it from webhook_inbox timestamps.
create table if not exists order_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'omnia',
  trigger        text not null default 'scheduler',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  store_results  jsonb not null default '[]',  -- [{store, fetched, upserted, error?}]
  error          text
);
create index if not exists order_sync_runs_started_idx on order_sync_runs (started_at desc);

-- payment_sheet_months: registry mapping a calendar month to the Google
-- Sheet spreadsheet id that holds that month's payments-tracking data —
-- the founder confirmed each month is a genuinely separate spreadsheet
-- file, not a tab within one continuously-growing sheet, so there is no
-- way to auto-discover "this month's sheet" without the founder telling us
-- its id once. See lib/finance/payments-sheet.ts's readAllPaymentRowsAllMonths.
create table if not exists payment_sheet_months (
  month_key      text primary key,  -- 'YYYY-MM', e.g. '2026-09'
  spreadsheet_id text not null,
  label          text not null,     -- e.g. 'September 2026'
  created_at     timestamptz not null default now()
);

-- zoho_api_usage: one row per calendar day counting outbound Zoho API
-- calls. Zoho caps the org at ~5,000 requests/day shared across Books +
-- Inventory; every call routed through lib/integrations/zoho-throttle.ts
-- reserves a unit here first via zoho_consume_quota() and is refused once
-- the configured budget (ZOHO_DAILY_BUDGET, default 4500) is spent. The
-- counter is authoritative across serverless invocations and instances.
create table if not exists zoho_api_usage (
  usage_date    date primary key default current_date,
  request_count integer not null default 0,
  updated_at    timestamptz not null default now()
);

-- Atomically reserve one unit of today's Zoho budget. Returns allowed=false
-- (and does not consume) once request_count would exceed p_limit.
create or replace function zoho_consume_quota(p_limit integer)
returns table(allowed boolean, used integer)
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into zoho_api_usage (usage_date, request_count, updated_at)
  values (current_date, 1, now())
  on conflict (usage_date)
  do update set request_count = zoho_api_usage.request_count + 1,
                updated_at = now()
  returning zoho_api_usage.request_count into v_count;

  if v_count > p_limit then
    update zoho_api_usage
      set request_count = zoho_api_usage.request_count - 1
      where zoho_api_usage.usage_date = current_date;
    return query select false, v_count - 1;
  end if;

  return query select true, v_count;
end;
$$;

-- pilot_leads: inbound "book a pilot call" requests from the public
-- /recon-copilot landing page. This is the demand-validation instrument for
-- the commercial Recon Copilot product (see the office-hours design doc):
-- every row is a merchant who saw the pitch and asked for a conversation.
-- Written by app/api/recon-copilot/lead/route.ts (public, unauthenticated,
-- rate-limited); read by the founder. No merchant data lives here, just
-- contact + qualifying context.
create table if not exists pilot_leads (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  company       text not null,
  role          text not null default '',
  ecom_platform text not null default '',   -- shopify / woocommerce / other
  accounting    text not null default '',   -- zoho / xero / quickbooks / sheets / other
  monthly_orders text not null default '',  -- self-reported band, e.g. '500-2000'
  message       text not null default '',
  source        text not null default 'recon-copilot-landing',
  utm           jsonb not null default '{}',
  status        text not null default 'new', -- new / contacted / qualified / piloting / lost
  user_agent    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists pilot_leads_created_idx on pilot_leads (created_at desc);
create index if not exists pilot_leads_status_idx on pilot_leads (status);

-- leads: inbound "free payout audit" requests from the public RAMZA landing
-- page (/ramza). Written by app/api/lead/route.ts (public, unauthenticated,
-- honeypot + 24h email dedupe). Carries Meta ad attribution captured in a
-- first-party cookie on first visit so the founder can tie a lead back to the
-- campaign, plus event_id for Meta Pixel <-> Conversions API dedup.
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null,
  whatsapp        text not null,
  email           text not null,
  store_url       text not null default '',
  gateways        text[] not null default '{}',
  monthly_orders  text not null default '',   -- '<500' | '500-2000' | '2000-10000' | '10000+'
  accounting_tool text not null default '',   -- 'zoho' | 'xero' | 'quickbooks' | 'excel-none'
  utm_source      text not null default '',
  utm_medium      text not null default '',
  utm_campaign    text not null default '',
  utm_content     text not null default '',
  fbc             text not null default '',
  fbp             text not null default '',
  referrer        text not null default '',
  landing_path    text not null default '',
  event_id        text not null default '',
  status          text not null default 'new', -- new / contacted / audited / call-booked / won / lost
  user_agent      text not null default '',
  source          text not null default 'ramza-landing'
);
create index if not exists leads_created_idx on leads (created_at desc);
create index if not exists leads_status_idx on leads (status);


-- A payout file uploaded from a specific bank credit's panel is pinned to that
-- credit: it always shows there (as Variance if the totals disagree) instead
-- of silently matching nothing and seeming to vanish. Null = auto-match.
alter table payouts add column if not exists bank_line_id text;
alter table payouts add column if not exists uploaded_at timestamptz default now();

-- Manual links for payout lines whose reference isn't an order number (e.g.
-- Tamara payment links carrying a phone number, "0655572535"). Keyed by the
-- payout + the ref as it appears in the file.
create table if not exists payout_ref_links (
  payout_id     text not null,
  order_ref     text not null,
  order_number  text not null,
  tenant_id     text not null default 'omnia',
  linked_by     text not null default 'founder',
  linked_at     timestamptz not null default now(),
  primary key (payout_id, order_ref)
);

-- Refunds netted out of a gateway payout, booked in Zoho as a credit note
-- against the order + a refund of it paid from the gateway clearing account.
-- Id columns hold the Zoho id or PENDING:<attempt> mid-write (same retry
-- discipline as settlement_records).
create table if not exists refund_postings (
  id                  text primary key,          -- payout_id|order_number
  tenant_id           text not null default 'omnia',
  bank_line_id        text not null,
  payout_id           text not null,
  order_number        text not null,
  amount_aed          numeric not null,
  zoho_invoice_id     text,
  zoho_creditnote_id  text,
  creditnote_reused   boolean not null default false,
  zoho_refund_id      text,
  error               text,
  claimed_at          timestamptz,
  posted_at           timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists refund_postings_line_idx on refund_postings (bank_line_id);

-- ── Zoho invoice snapshot on the settlement row ────────────────────────────
-- The proof panel used to re-ask Zoho for every order's invoice each time it
-- opened: 1-2 `invoices?customer_name_startswith=` searches PER ORDER (each
-- pulling up to 200 rows), serialised through the throttle, against a ~4,900
-- call/day budget. A 14-order payout burned ~28 calls just to render, and the
-- exchange difference couldn't be shown until they all came back.
--
-- Booking already reads the invoice from Zoho; these columns keep what it saw,
-- so the panel renders the invoice amount and FX difference from the database
-- instantly and only calls Zoho for orders it has never looked up (or when the
-- founder explicitly refreshes).
alter table settlement_records add column if not exists zoho_invoice_number     text;
alter table settlement_records add column if not exists zoho_invoice_status     text;
-- What the invoice still owed when we looked: the amount the payment closes.
alter table settlement_records add column if not exists zoho_invoice_balance    numeric(14,2);
alter table settlement_records add column if not exists zoho_invoice_total      numeric(14,2);
alter table settlement_records add column if not exists zoho_invoice_checked_at timestamptz;

-- ── Payout store identity: one statement number, several stores ────────────
-- Tabby numbers a settlement statement by date and currency only
-- ("Tabby20260914AED") but issues one report PER STORE, and payouts.id is that
-- statement number. Every same-date same-currency report therefore overwrote
-- its predecessor. Measured against the real files: 13 distinct payouts
-- collapsed onto 5 primary keys, losing AED 41,080.84 (Omniastores UAE, behind
-- the 2026-09-07 credit) and SAR 12,505.79 (Omniastores KSA, behind the
-- 2026-09-09 AED 12,188.81 credit) among others.
--
-- These columns record where a payout actually came from, read from the
-- transaction table's own Merchant Name / Merchant Code columns rather than
-- from a filename decorated with "(1)" or "36". lib/finance/payout-identity.ts
-- uses them to give a colliding report its own id instead of clobbering.
-- Existing ids are never rewritten: payouts.id is referenced by
-- payout_transactions, payout_ref_links, recon_lines and settlement_records.
alter table payouts add column if not exists store         text;
alter table payouts add column if not exists merchant_code text;
alter table payouts add column if not exists statement_no  text;
create index if not exists payouts_statement_no_idx on payouts (statement_no);

-- ── Gmail payout-report ingestion audit ────────────────────────────────────
-- Gateways email a settlement report on every payout; lib/finance/
-- payout-email-ingest.ts pulls them in so credits stop waiting on somebody
-- noticing the mail. One row per Gmail message examined.
--
-- message_id is UNIQUE and is the idempotency key: re-polling the same mailbox
-- must never re-ingest a report. Failures and skips are recorded too — a
-- message that matched but yielded nothing parseable is exactly what needs to
-- be visible rather than silently dropped.
create table if not exists payout_email_ingests (
  id              uuid primary key,
  tenant_id       text not null,
  message_id      text not null unique,
  mailbox         text not null,
  sender          text,
  subject         text,
  received_at     timestamptz,
  provider        text,
  attachment_name text,
  payout_id       text,
  status          text not null,   -- ingested | skipped | failed
  error           text,
  created_at      timestamptz default now()
);
create index if not exists payout_email_ingests_status_idx on payout_email_ingests (status, created_at desc);
