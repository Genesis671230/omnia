# Omnia OS file map

Repo: Next.js + TypeScript, Supabase (Postgres) as the database, long-running schedulers
started in `instrumentation.ts`. Paths are repo-relative.

## By system

| System | Connect / pull | Parse | Book / act | Notes |
|---|---|---|---|---|
| **Shopify** (UAE, KSA, WA, MAIN) | `lib/integrations/shopify.ts`; webhooks `app/api/webhooks/shopify/[store]/{orders-create,orders-paid,refunds-create,products-update,inventory-update}` | `lib/normalize/order.ts` | `lib/sync/order-sync.service.ts`, `lib/sync/order-webhook-ingest.ts` | WA orders created after payment; gateway in `payment_gateway_names` |
| **Shopify Payments** | `lib/integrations/shopify-payments.ts` (Admin GraphQL) | `parseShopifyPaymentsCsv` in `lib/parsers/payouts.ts` | `lib/finance/shopify-payout-store.ts` | Key `SHOPIFY-<STORE>-<id>`; Zoho clearing account named `SHOPIFY`; UAE/KSA token lacks payouts scope |
| **WooCommerce** | `lib/integrations/woo.ts`; `app/api/webhooks/woo/[topics]` | `telrRefsFromMeta` | same sync | Sync off since Shopify MAIN migration |
| **Stripe** | `lib/integrations/stripe.ts` (payouts, balance txns, charges) | `parseStripeCsv`, `stripeOrderRefs`, `classifyStripeQuality` | `lib/sync/stripe-payment-confirm.ts`, `lib/reconciliation/stripe-settlements.ts` | Order ref typed in charge description; WA charges in SAR/KWD/QAR |
| **Tabby** | email ingest / upload | `parseTabbyXlsx` | settlement playbook | Fee `Total Deduction` VAT inside; SAR/KWD/QAR statements separate |
| **Tamara** | email ingest / upload | `parseTamaraXlsx` (bracket negatives, phone refs) | settlement playbook | Fee + VAT column on top; KSA layout has `Merchant Order Number` |
| **Telr** | `lib/integrations/telr.ts` (API 403-blocked) | `parseTelrXls` (Payout ID banner) | `lib/sync/telr-payment-confirm.ts` | Bank narration `INNOVATE TECHNOLOGIES`, date in `PO<DDMMYY>` |
| **Checkout.com** | upload | `parseCheckoutCsv` | settlement playbook | Clearing `Checkout - AED` / `- SAR` |
| **COD / OnTrack** | upload PDF voucher | `lib/parsers/ontrack-voucher.ts`, `parseCodCsv`, `parseCodXlsx` | delivery charges → `publishDeliveryCharges` | Pro-price-0 rows = delivery charges; OT Invoice# in dispatch sheet |
| **SMSA** | `lib/integrations/smsa.ts` (SOAP) | | `app/api/orders/[uid]/ship`, `label` | KSA cities only; international dispatch tab |
| **Bank** (Sharjah Islamic) | `app/api/upload/bank` | `lib/parsers/bank.ts`, `bank-dedupe.ts` | `lib/reconciliation/*` | Statement date is a string, slice(0,10) |
| **Payout identity** | | `lib/finance/payout-identity.ts` | | One payout id per real transfer |
| **Gmail payout ingest** | `lib/integrations/gmail.ts`, `app/api/integrations/gmail/*` | `lib/finance/payout-email-ingest.ts` | `lib/scheduler/payout-email-scheduler.ts` | Pulls Tabby/Tamara statements from email |
| **Zoho Books** | `lib/integrations/zoho.ts` (auth, invoices, payments), `zoho-throttle.ts` (quota) | | `zoho-settlement-posting.ts` (payments, expenses, journals, credit notes, refunds), `zoho-banking.ts`, `zoho-books-banking.ts`, `zoho-expenses.ts` | 5k calls/day org-wide |
| **Dispatch sheet** (Google) | `lib/integrations/google-sheets.ts` | header-by-text mapping | `lib/integrations/dispatch-sheet.ts` (`appendOrderToDispatchSheet`, `markOrderPaidInSheet`) | Month sheet id in `payment_sheet_months`; `lib/finance/payments-sheet*.ts` reads it |
| **Telegram** | `lib/integrations/telegram.ts` | | `lib/alerts/order-alerts.ts`, CFO digest | `@omnia_cos_bot` ops, `@Omnia_cfo_bot` CFO |

## Core engine

| Piece | File |
|---|---|
| Bank → payout → orders | `lib/reconciliation/engine.ts` |
| Payout sync + reconcile loop | `lib/payout-sync.ts`, `lib/scheduler/payout-sync-scheduler.ts` |
| Booking math (pure, tested) | `lib/finance/settlement-posting.ts` |
| Order booking | `lib/finance/publish-settlements.ts` |
| Refund booking | `lib/finance/publish-refunds.ts` |
| Gateway classification | `lib/gateways.ts`, `lib/finance/derive-gateway.ts` |
| Sale rule / day bucketing | `lib/orders/sale-rule.ts`, `lib/dubai-day.ts` |
| Sales ledger | `lib/orders/sales-ledger*.ts` |
| FX table (estimates only) | `lib/fx.ts` |
| Zoho ledger ↔ bank line status | `lib/reconciliation/bank-line-zoho-status.ts`, `zoho-ledger-*.ts` |

## Founder-facing routes

`/api/reconcile` (lines), `/api/reconcile/ref-links`, `/api/settlements/publish`,
`/api/settlements/refunds` (+ `/close`, `/restructure`, `/credit-notes`),
`/api/settlements/[id]/force`, `/api/integrations/zoho/post-payout`,
`/api/upload/payout`, `/api/upload/bank`, `/api/orders/sales-ledger(/export)`.

## Tables (Supabase)

orders, stores, bank_lines, payouts, payout_transactions, recon_lines, payout_ref_links,
settlement_records, refund_postings, gateway_pending_charges, uploaded_files,
payout_email_ingests, payment_sheet_months, zoho_publish_runs, zoho_postings,
zoho_account_config, zoho_bank_txn_postings, bank_line_zoho_status, zoho_api_usage,
sync_runs, order_sync_runs, zoho_items, zoho_orders, store_inventory. Schema:
`db/schema.sql`, applied with `node db/apply-schema.mjs`.

## Environment (names only)

Supabase `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` · Zoho `ZOHO_CLIENT_ID`,
`ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID`, `ZOHO_DAILY_BUDGET` ·
Stripe `STRIPE_SECRET_KEY` · Shopify `SHOPIFY_<UAE|KSA|WA|MAIN>_URL/_TOKEN/_WEBHOOK_SECRET`,
`SHOPIFY_API_VERSION` · Telr `TELR_STORE_ID`, `TELR_AUTHENTICATION_KEY`,
`TELR_API_USERNAME/PASSWORD` · Woo `WOO_URL`, `WOO_CONSUMER_KEY/SECRET` · Google
`GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY`, `GOOGLE_SHEETS_SPREADSHEET_ID` · Gmail
`GMAIL_*` · SMSA `SMSA_API_KEY` · Telegram `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CFO_BOT_TOKEN`,
`TELEGRAM_CHAT_ID` · intervals `*_INTERVAL_MINUTES`.

## Tests worth running after finance changes

`npx tsx --test 'tests/finance/*.test.ts' 'tests/parsers/*.test.ts' 'tests/reconciliation/*.test.ts'`
