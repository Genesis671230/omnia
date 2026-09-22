---
name: omnia-sales-recon
description: Use when working on Omnia's daily sales numbers, the sales ledger / day drawer / xlsx export, which orders count as a sale, order-date day bucketing, payout ingestion (Telr, Stripe, Tabby, Tamara, Shopify Payments CSV or API), pending gateway charges, or reconciling orders → payouts → bank credits. Also when the founder says an order is missing from a day, a day total is wrong, or asks to verify numbers against the legacy Laravel/admin export.
---

# Omnia sales → payout → bank reconciliation

The founder checks the dashboard against the legacy Laravel admin export. Every
order in that export must appear on the right Dubai day, with the right amount,
and trace to its gateway fee, payout and bank credit. "Close enough" is a bug.

## The money chain

```
orders (store sync)                    lib/sync/order-sync.service.ts
  └ payout line  payout_transactions   gross/fee/vat/net per order (AED + original ccy)
      └ payout   payouts               one gateway transfer; source = file | *-api
          └ recon_lines                payout ↔ bank_lines (match_status, confirmed_by)
              └ bank_lines             statement_date is a timestamp string → slice(0,10)
gateway_pending_charges                charged, NOT yet in any payout (Shopify Payments)
```

Pure computation: `lib/orders/sales-ledger.ts` (`computeSalesLedger`).
Fetch: `lib/orders/sales-ledger.service.ts`. API: `GET /api/orders/sales-ledger?month=YYYY-MM`,
export `GET /api/orders/sales-ledger/export?day=|month=` (`lib/orders/sales-ledger-xlsx.ts`).
UI: `components/finance/dashboard-v2/gross-sales-panel.tsx` + `day-sales-drawer.tsx`.

## Rules that must not regress

1. **What counts as a sale** — only `lib/orders/sale-rule.ts` `isCountedSale`:
   total > 0; never refunded/cancelled/voided.
   - WOO: paid / on-hold / processing / completed / partially_refunded.
   - Shopify UAE, KSA, MAIN: paid / partially_paid / **partially_refunded**, or pending **COD**.
   - Shopify WA: also pending on *any* method (WA orders are created after payment).
   `partially_refunded` counts — Shopify rewrites a paid order to it after a partial
   refund; excluding it made SA3910 vanish from Sep 1.
2. **Day bucketing** — `orders.order_date` is Postgres `timestamp` (no tz) holding
   **UTC**, returned without `Z`. Never `new Date(order_date)`: on a Dubai-TZ host
   that reads it as local and every 00:00–04:00 Dubai order lands on the previous day.
   Always `dubaiDayKey()` / `utcMs()` from `lib/dubai-day.ts`. Test day numbers under
   both `TZ=UTC` and the default TZ.
3. **Ledger statuses** (worst first): `no_payout_file`, `in_review`, `awaiting_payout`
   (charged, real fee known, no payout yet), `awaiting_bank`, `received`, `cod`.
   Adding a status means updating `STATUS_ORDER`, `emptyCounts`, `orderReason`,
   `dayReason` in sales-ledger.ts, `STATUS_LABEL` in the xlsx builder, and
   `LedgerStatus` + `STATUS_META` in day-sales-drawer.tsx.
4. **Fee basis**: `measured` (the order's own payout line or live charge),
   `allocated` (file total fee split by order weight), `estimated` (no data —
   rendered grey italic in the export). Never present an estimate as a fact.
5. **Partial lines**: a payout line whose own gross is < 80% of the order gross is
   not that order's payment (`PARTIAL_COVERAGE`); ranking prefers same gateway,
   then the stamped payout_id, then one with a recon line.
6. **Currency**: `lib/fx.ts` must have a rate for every order currency (OMR, BHD,
   QAR were missing → stored at 1.0). SAR/KWD payouts reconcile at the bank's quoted
   wire rate, not the static table.
7. Pending charges live in `gateway_pending_charges`, **never** in `payouts` — the
   reconciler would try to match a not-yet-issued payout to a bank credit.

## Payout sources

| Gateway | How it arrives | Code |
|---|---|---|
| Telr | API (403-blocked) or xls upload | `lib/integrations/telr.ts`, `lib/parsers/payouts.ts` |
| Stripe | API, every sync | `lib/integrations/stripe.ts` |
| Tabby / Tamara / Checkout | file upload / email ingest | `lib/parsers/payouts.ts` |
| Shopify Payments | CSV upload **or** Admin GraphQL API | `parseShopifyPaymentsCsv`, `lib/integrations/shopify-payments.ts` |

Shopify payout key is `SHOPIFY-<STORE>-<legacyResourceId>` for both CSV and API, so
the two never duplicate. Details, queries and scopes: `reference/shopify-payments-api.md`.

Sync entry points: `syncGatewayPayouts()` (every 130 min, then `runReconciliation()`)
and `syncShopifyPayments()` (every 15 min via `SHOPIFY_PAYMENTS_SYNC_MINUTES`; runs the
reconciler only when a new payout was saved). Both in `lib/payout-sync.ts`, scheduled
from `lib/scheduler/payout-sync-scheduler.ts`. Manual: `POST /api/integrations/payouts`.

## Verifying against the founder's export

When the founder says orders are missing:
1. Look the order up directly (`orders` by `order_number`) — is it missing, or
   excluded by status, or on the wrong day?
2. Build the reference list (day | order | currency | total | Dubai time) from the
   pasted export and diff every row against the DB: exists, `isCountedSale`,
   `dubaiDayKey`, amount, currency. Then list orders *we* count that the export lacks.
3. Run the diff under `TZ=UTC` and the default TZ; then check `buildSalesLedger`
   per-day counts match.
4. Report exact counts per day. Recount the reference yourself — don't eyeball.

Scripts go in `scripts/_*.ts`, run with
`npx tsx --env-file=.env --env-file=.env.local scripts/_x.ts`, and are deleted after.

## Data repairs

Repair scripts are dry-run by default and write only with `--apply`. Never apply
without the founder's explicit yes: `scripts/repair-clobbered-payments.ts`,
`scripts/reclassify-order-gateways.ts`, `scripts/repair-unconverted-currency.ts`.

## Schema changes

Editing `db/schema.sql` does nothing live — run `node db/apply-schema.mjs`
(idempotent `create … if not exists` / `add column if not exists` only).

## Stores

UAE, KSA (SAR), WA (WhatsApp, prepaid, no Shopify Payments account), WOO (sync off —
migrated), MAIN (Shopify Main, `OS` order prefix, AED). Env: `SHOPIFY_<CODE>_URL`,
`SHOPIFY_<CODE>_TOKEN`, `SHOPIFY_API_VERSION`.
