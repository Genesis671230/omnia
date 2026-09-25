# Data Model & Roadmap — Omnia Finance OS

> **Update (2026-08-08): the Supabase migration this file anticipated is DONE.** `db/schema.sql` (run through `node db/apply-schema.mjs` to actually apply — editing the file alone does nothing to the live DB) is the current source of truth for exact columns. This file is still accurate for the *shape* of the model and the reasoning behind it; Google Sheets is now an output artifact (the dispatch sheet), not the database.

The end-state canonical schema (for Supabase/Postgres), the provider-adapter pattern, and the phased path to a founder dashboard. Google Sheets is the Phase-1 database; port to Supabase once the full loop works — design the schema from proven data, not from a whiteboard.

## Provider-adapter pattern

Never store a gateway's or platform's native object. Each source has a connector that maps into the canonical model. Adding PayTabs/Checkout/Amazon/Noon later = one new adapter, zero changes to reports.

```
Providers table:  provider_id | type            | name
                  stripe      | payment_gateway | Stripe
                  telr        | payment_gateway | Telr
                  shopify_uae | ecommerce       | Shopify UAE
                  woocommerce | ecommerce       | WooCommerce
```

**Canonical Payment object** (every gateway normalizes to this):
```json
{ "provider":"telr", "provider_transaction_id":"030102641182",
  "provider_payout_id":"4841777", "order_reference":"601908",
  "currency":"AED", "gross_amount":765.00, "gateway_fee":19.55,
  "gateway_tax":0.98, "net_amount":744.47, "status":"settled",
  "settlement_date":"2026-06-26" }
```

## Canonical tables (Supabase end-state)

- `stores` — the 4 sales channels (+ future).
- `products`, `product_variants` — master catalog; never trust platform IDs, keep your own SKU mapping to Shopify/Woo variant IDs + barcode.
- `inventory`, `warehouses`, `stock_movements` — one place owns stock; every sale decrements it.
- `customers` — unified identity across channels (Shopify id, Woo id, phone, email) → cross-channel LTV.
- `orders` — canonical order (the Sheets `Master_Orders` is its Phase-1 form). Dual currency (original + AED).
- `order_items` — one row per SKU (enables inventory + profit analysis).
- `payments` — one row per gateway transaction (canonical Payment object above).
- `payment_gateways`, `gateway_transactions`.
- `payouts` — one summary per payout (id, date, total, net, fees).
- `payout_transactions` — one row per settled transaction (exactly what Telr/Stripe return).
- `shipments`, `returns`, `refunds`.
- `ledger_entries` — accounting ledger; every financial event = a debit/credit row so totals always reconcile (Sale, Gateway Fee, Tax on Fee, Payout, Refund).
- `exchange_rates`, `audit_logs`.

**Ledger example** (QuickBooks-style — this is why totals reconcile):
```
Date    Type         Reference  Debit    Credit
23 Jun  Sale         601908     989.92
23 Jun  Gateway Fee  601908              38.04
23 Jun  Tax on Fee   601908              1.90
26 Jun  Payout       4841777             949.98
```

**Reconciliation view** (generated):
```
Order   Payment  Payout  Status
601908  ✓        ✓       Complete
390908  ✓        ✗       Awaiting Payout
391215  ✗        ✗       Payment Missing
```

## Event layer (don't skip)

Store every state transition, not just current status: Order Created → Payment Authorized → Payment Captured → Packed → Shipped → Delivered → Refunded. Enables time-to-fulfil/ship/deliver, SLA compliance, bottleneck analysis — without losing history.

## Matching logic (canonical)

Match by **CartID** (`601908_...`) or **gateway transaction ref** (`030102641182`) — both unique and stable. Never match by customer name (changes) or (cross-store) order number (collides).

## Phased roadmap

- **Phase 1 — Commerce (current):** connect 4 stores → normalize orders/customers/items into `Master_Orders`.
- **Phase 2 — Finance:** Telr + Stripe (+ Tabby/Tamara later); reconcile payments↔payouts↔bank; build the ledger.
- **Phase 3 — Inventory & Fulfillment:** master catalog, warehouse inventory, stock movements, shipments/courier tracking.
- **Phase 4 — Founder Dashboard:** executive KPIs, cash & payout visibility, inventory health, profit by channel/country/product, operational alerts.

## Founder dashboard (organize around decisions, not raw charts)

- **Executive:** sales today / yesterday / MTD / YTD / vs last year.
- **Cash:** collected today, **awaiting payout**, payout expected tomorrow, gateway balance, bank balance.
- **Sales:** orders, AOV, cancelled, refunded, COD %.
- **Inventory:** low/out of stock, dead inventory, fast movers, inventory value.
- **Fulfillment:** waiting / packed / shipped / delayed, avg dispatch time.
- **Marketing (later):** repeat customers, CAC, ROAS, top campaign/influencer.

Once every source feeds one model, strategic questions become simple SQL: "How much has Telr not yet paid us?", "Which products are most profitable after gateway fees?", "Which country has the highest net revenue?", "How much is in transit financially vs operationally?"

## Why Sheets now, Supabase later

Sheets is great for finance review, manual adjustments, pivot tables — and it's where the working system lives today. Supabase/Postgres adds referential integrity, performance at scale, and a clean path to a web dashboard. Move once the full loop (orders → payouts → bank → awaiting → brief) is proven, so the schema is derived from real data. n8n orchestrates data movement; business logic lives in the data model, not in n8n.

## Booking layer (live, 2026-09-15)

Tables added for booking payouts into Zoho Books (exact columns in `db/schema.sql`):

- `payouts.bank_line_id` — payout pinned to the bank credit it was uploaded from (null = auto-match); `payouts.uploaded_at`.
- `payout_transactions.vat_aed / vat_original` — VAT a gateway charges *on top* of its fee (Tamara). Null/0 where the fee already includes VAT (Tabby).
- `payout_ref_links (payout_id, order_ref) → order_number` — manual/agent links for refs that aren't order numbers (Tamara phone-number refs).
- `settlement_records` booking columns — `zoho_invoice_id`, `zoho_payment_id`, `zoho_fee_expense_id`, `zoho_fx_journal_id`, `fee_aed`, `fee_vat_aed`, `fx_difference_aed`, `zoho_post_error`, `zoho_claimed_at` (5-min lease). Id columns hold a Zoho id, `PENDING:<uuid>` mid-write, legacy `CLAIMED:<uuid>`, or `EXTERNAL:<invoice>` (paid by hand).
- `refund_postings` — one row per refund netted out of a payout: `zoho_creditnote_id` (+ `creditnote_reused`), `zoho_refund_id`, `amount_aed`, lease + error.
- `zoho_publish_runs` — audit row per booking batch.

Ledger view of one Tamara AED order (WA55560, statement P8498683AE260905):
```
Customer payment   Dr TAMARA (clearing)          2,662.00   Cr Accounts Receivable   2,662.00
Fee expense        Dr Payment Gateway Charges      160.95
                   Dr Input VAT                      8.05   Cr TAMARA (clearing)       169.00
Payout transfer    Dr Bank                       2,493.00   Cr TAMARA (clearing)     2,493.00   → clearing = 0
```
Cross-border adds `Dr Exchange Gain or Loss / Cr clearing` for `invoice − fee − received` (loss), reversed for a gain.
