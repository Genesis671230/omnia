---
name: omnia-finance
description: "Build and maintain the Omnia Finance OS — a multi-gateway, multi-store financial reconciliation and light-ERP system for OmniaStores (a Gulf e-commerce business), built on Next.js + Supabase with persistent in-process schedulers (Google Sheets is now an OUTPUT artifact — the dispatch sheet Sinan/Yaseen work from — not the database). Use this skill WHENEVER the user mentions Omnia, OmniaStores, reconciliation, payout matching, awaiting payouts, gateway settlement, booking payouts/fees/VAT/FX/refunds in Zoho Books, clearing accounts (TABBY AED/KSA/KWD, TAMARA/KSA/KWD), credit notes for gateway refunds, dispatch sheet, order sync, the CFO/founder morning brief, Telr/Stripe/Tabby/Tamara/Checkout/COD payouts/payments, or wiring Shopify/WooCommerce orders into the finance system — even if they don't name the system explicitly. It encodes the per-gateway-per-currency booking playbooks (Tabby AED vs SAR, Tamara AED vs SAR: who includes VAT in the fee, how FX differences are booked), the canonical data model, the exact join keys, gateway file quirks, the current architecture, and hard-won operational pitfalls so you don't rediscover them. Consult it before designing any order-sync, payout-ingest, bank-matching, Zoho-booking, dispatch-sheet, or payment-confirmation workflow for this business, and before building any agent that books the books automatically — and as a template for building any similar always-on 'agent employee' (a persistent scheduler that watches external state, writes to a human-facing artifact, and notifies a channel) even outside Omnia."
---

# Omnia Finance OS

A financial reconciliation + light-ERP system for **OmniaStores**, a Gulf (UAE-based) e-commerce business selling across four sales channels and settling money through multiple payment gateways. The job: prove every dirham from **order → gateway → payout → bank**, surface **awaiting payouts** per gateway, flag **anomalies**, keep the ops team's **dispatch sheet** current, confirm **gateway payments** automatically, and push a daily **founder brief** to Telegram.

This skill encodes hard-won specifics (join keys, field names, file quirks, architecture, operational pitfalls). Read it fully before designing any workflow. For deep detail, see the reference files listed at the end.

## Current architecture (2026-08-08) — read this first

The system was originally prototyped in **n8n** (see `references/n8n-recipes.md`, kept for historical context — **do not build against it**, it's superseded). It has since been **rebuilt in this repo as a Next.js/TypeScript app with Supabase as the database**. Google Sheets is no longer the database — it's a downstream **operational artifact** (the "dispatch sheet") that Sinan/Yaseen work from directly, written to by the app, never read back as a source of truth.

**Persistent schedulers, not cron, not n8n.** `instrumentation.ts` runs once when the Node server boots and starts every long-lived scheduler (`setInterval` loops) in one place:
- `payout-sync-scheduler` — gateway payout verification + bank reconciliation, every 130m
- `ad-sync-scheduler` — ad platform sync, every 120m
- `zoho-sync-scheduler` — Zoho Books + inventory sync, every 135m
- `order-sync-scheduler` — pulls new Shopify/Woo orders, triggers Telegram alerts + dispatch-sheet writes, every 2m
- `payment-confirm-scheduler` — checks Stripe/Telr for payment confirmation on pending orders, every 10m
- `cfo-digest-scheduler`, `group-summary-scheduler` — daily Telegram digests
- `telegram-listener-scheduler` — the ops + CFO bot message listeners

**⚠️ Critical operational gotcha, learned the expensive way:** these schedulers are captured into memory **once, at server boot**. Editing any file in their import chain (a scheduler, or anything it imports — `lib/alerts/`, `lib/integrations/`, `lib/sync/`) does **NOT** hot-reload into an already-running scheduler, even though Next.js dev-mode HMR makes it *look* like changes are live for anything served over HTTP. A dev server that's been running since before your edit will keep executing the OLD code in its background loops indefinitely — silently, with no error, until the process is restarted. **Always restart `next dev` (or redeploy) after touching anything on a scheduler's import path**, and verify by checking the fresh boot log lists every expected scheduler line. This exact bug produced weeks of "the sheet write is failing / has stale data" reports that were actually "the fix was already on disk, nobody restarted the server."

**Order webhooks** (`app/api/webhooks/shopify/[store]/orders-{create,paid}/route.ts`, `.../woo/[topics]/route.ts`) give near-instant ingestion for the store; `order-sync-scheduler` is the 2-minute safety-net poll that catches anything a webhook missed.

## The one architectural principle (never violate)

**Model the business, not the gateways.** Shopify, WooCommerce, Stripe, and Telr are *connectors* that map into ONE canonical data model (the `orders` table + its normalizers in `lib/normalize/order.ts`). Reports and the dispatch sheet read only from canonical rows. Adding a new gateway/store = writing one new adapter (normalizer), never touching the reporting or dispatch layer.

**Bank is always the LAST stage, never the first.** Money flows Order → Gateway → Settlement/Payout → Bank. Orders reconcile to *settlements*; settlements reconcile to *bank*. Never try to match orders directly to bank deposits — gateways batch, so it's impossible without the payout layer.

**Never let automation silently produce garbage or silently succeed.** Two concrete lessons from this build:
1. A dispatch-sheet header row got wiped by a live human edit mid-session; because the append path blindly mapped values by header text, every subsequent write became a row of empty strings — no error, no warning, just silent data loss. Fix: refuse to write and throw loudly (`lib/integrations/dispatch-sheet.ts` `appendOrderToDispatchSheet` — checks the "Order #" column exists before ever building a row) rather than trust a structural assumption about a shared, human-edited document.
2. A Telegram status message that says "payment received" must be honest about whether the sheet actually got updated — `sheetResult === "updated"` is the ONLY outcome that earns "marked paid in dispatch sheet" in the message; every other outcome (not-in-sheet, blocked, threw) reads as "could not confirm, log manually." Conflating "automation didn't touch it" with "it's handled" is how a human stops double-checking and a real gap goes unnoticed.

See `references/agent-employee-pattern.md` for this as a generic, reusable blueprint — not Omnia-specific.

## Three-workflow architecture (historical — n8n Phase 1, superseded)

The original prototype was three separate n8n workflows sharing a Google Sheet as the database (Master Orders Sync hourly, Payout Ingest on upload, Reconcile+Report daily). The *shape* of the idea (sync → ingest → reconcile, different cadences, never coupled) carried over into the current scheduler design above. The n8n implementation itself — node configs, that Google Sheet as DB, the `@Omniafinancebot` Telegram bot — is dead; see `references/n8n-recipes.md` only for the reasoning trail, not as a build target.

## Booking gateway payouts in Zoho — decide by gateway × currency (2026-09-15)

Every settled order becomes: **(1)** a customer payment for the Zoho invoice's *full balance* into the gateway's **clearing account**, **(2)** an expense for everything the gateway deducted, paid from that clearing account, **(3)** a journal for `invoice − fee − received` when non-zero. Refunds netted out of a payout become a credit note + a refund of it from clearing. After booking, clearing holds exactly the bank credit; the payout transfer (clearing → bank) empties it. If that doesn't hold, something is wrong — never plug it.

| Payout | Fee column | VAT | Deposit To | Difference |
|---|---|---|---|---|
| Tabby AED | `Total Deduction` (VAT **inside**) | `fee ÷ 105 × 5`, reclaim | TABBY AED | rounding ≤ max(AED 1, 0.25%) |
| Tabby SAR / KWD / QAR | `Total Deduction` × bank rate | none | TABBY KSA / KWD / QTR | exchange gain/loss |
| Tamara AED | `Total Fees` (VAT **excluded**) + `VAT Collected by Tamara` (= fee × 5%) | the VAT column, reclaim | TAMARA | rounding |
| Tamara SAR / KWD | (`Total Fees` + any VAT col) × bank rate | none | TAMARA KSA / KWD | exchange gain/loss |

"Bank rate" = bank credit ÷ payout net (or the rate quoted in the narration). Fees and net convert at the same rate; the FX line is `invoice (AED) − fee (AED) − received (AED)`.

Hard rules learned from live data (details + worked examples in `references/payout-playbooks.md`):
- **Tabby and Tamara treat VAT oppositely.** Tabby's deduction includes VAT; Tamara adds VAT on top in its own column. Getting this wrong mis-states input VAT on every order.
- **Pay the invoice balance, not the gateway gross.** Zoho rejects over-application ("amount is more than the balance due").
- **Pick the invoice by amount** when an order has several; never "first match". **Re-read the invoice before trusting a stored payment id** — payments get deleted in Zoho.
- **Invoice paid by hand (no payment with our reference) → don't book fee/FX** unless told the fee was never booked.
- **Parse `(592.42)` as negative** and use Tamara `Event Amount` for partial refunds — the old parser zeroed refunds and the credit never matched.
- **Tamara `Merchant Order ID` can be a phone number** → link to the real order; the credit is still confirmable for the matched orders.
- **One settlement record per order** — if another payout already holds it, surface it, don't overwrite.

To build an agent that does this end to end without routine human checking — evidence gates instead of the confirm click, plan assertions, read-back verification, exception reason codes — follow `references/autonomous-booking-agent.md`.

## The stores (4 sales channels)

| Store | Platform | Domain |
|---|---|---|
| WhatsApp (WA) | Shopify | `whatsapp-omnia.myshopify.com` |
| UAE | Shopify | `stzcx3-ee.myshopify.com` |
| KSA | Shopify | `houseofomnia-dev.myshopify.com` |
| WooCommerce (WOO) | WooCommerce | `omniastores.com` |

## The gateways

`Stripe · Telr · Tabby · Tamara · Checkout · COD`. Each has a DIFFERENT API/file shape → each needs its own normalizer (`lib/integrations/{gateway}.ts`, classified via `lib/gateways.ts` `classifyOrderGateway`). Only the normalization step is gateway-specific; everything after (group by settlement → match to bank; or check-payment → mark-paid) is shared.

**Live gateway API access, as of 2026-08-08:**
- **Stripe** — fully working. `lib/integrations/stripe.ts` `listRecentChargeRefs` for order-level payment confirmation (`lib/sync/stripe-payment-confirm.ts`), plus the existing payout/balance-transaction reconciliation path.
- **Telr** — **blocked**. Both the `/api/v1` payouts JSON API and the `/tools/api/xml` transaction-lookup XML API return a blank-body 403 for this account — confirmed external account/access issue (API access not enabled and/or IP not allowlisted), not a credentials or code bug. `lib/integrations/telr.ts` and `lib/sync/telr-payment-confirm.ts` are fully built and wired into the scheduler, gated behind `telrToolsConfigured()`/`telrConfigured()` — they'll start working automatically the moment Telr grants access, no code change needed. Don't re-diagnose this from scratch; re-probe with a plain `fetch` + Basic Auth to `https://secure.telr.com/tools/api/xml/transaction` first to confirm the block is still in place before assuming it's fixed.

## THE JOIN KEYS (most important section — get these wrong and everything breaks)

**The Telr CartID prefix is NOT the store order number in general.** Verified realities:
- **WooCommerce**: order carries Telr refs directly in `meta_data`: `_telr_cartid` (e.g. `601908_6a4f...`) and `_telr_auth_tranref` (e.g. `030107397763`) — captured into `orders.telr_cartid` / `orders.telr_tranref` by `telrRefsFromMeta()` in `lib/integrations/woo.ts`. Here the CartID prefix `601908` **equals** the Woo `order_id` (NOT the same as `order_number`/`raw.number` — don't conflate them when matching). Gateway is visible as `payment_method`. **→ WooCommerce is fully reconcilable order↔payout↔bank, and is the only store where Telr order-level payment confirmation can currently even attempt a match** (Shopify orders never get a captured Telr ref).
- **Shopify (all 3 stores)**: the gateway lives in **`payment_gateway_names`** (an array), NOT a `gateway` field, mapped via `gatewayRaw` in `lib/normalize/order.ts`. Shopify orders do **not** reliably expose the Telr transaction ref in the basic order object — order-level Telr matching for Shopify is not attempted (cash audit via payout→bank still works fully). Stripe order-level confirmation instead matches by parsing the order-ref token out of the Stripe charge's own `description` field (`stripeOrderRefs()` in `lib/parsers/payouts.ts`) — no stored Stripe reference exists on the order at all, by design of the store integrations.
- **COD** appears as `payment_method: "cod"` (WooCommerce) / in `payment_gateway_names` (Shopify).

**Reliable link for matching payouts/payments to orders:**
- Telr payout file `Ref` column (e.g. `030102641182`) ↔ WooCommerce `orders.telr_tranref`.
- Telr payout file `CartID` (e.g. `601908_...`) ↔ WooCommerce `orders.telr_cartid`.
- Stripe: the order-ref token embedded in the charge/balance-transaction `description` (e.g. `WA54610`, multi-order `WA54728/WA54730`, refunds `REFUND FOR CHARGE (WA54553)`) — parsed by `stripeOrderRefs()`, store-prefix-stripped (`WA`/`UAE`/`KSA`/`WOO`) to match `order_number`.

**Shopify order IDs are globally unique across stores** (never collide between shops), so `uid = store + "_" + order_id` is safe (see `lib/normalize/order.ts`). Order *numbers* CAN collide across stores — never join on order_number alone across stores; always strip/check the store prefix.

**Amount matching needs a tolerance band, not exact equality.** A ref match alone isn't proof of the same transaction — but exact-amount equality is too strict: live Stripe data showed genuine matches off by 0.2%–2% (FX conversion spread on foreign-currency payments), while unrelated ref collisions were off by 90%+. Use a percentage tolerance (`lib/sync/payment-match-tolerance.ts`, currently 3% with a small floor for tiny orders) to cleanly separate the two rather than guessing a flat currency amount.

## Canonical schema: `orders` table (Supabase — the current database)

Full column list in `db/schema.sql` / `lib/repositories/orders.repository.ts` `ORDER_COLUMNS`. Core fields: `uid · store_id · order_number · order_date · customer_name/email/phone · city/country · currency · gross_original · gross_aed · gateway · gateway_raw · financial_status · fulfillment_status · telr_cartid · telr_tranref · payout_id · payout_status · line_items (jsonb)`.

- `uid` = `store + "_" + order_id` (unique key, used for upsert matching).
- **Dual currency is mandatory.** Customers pay in KWD/SAR/QAR/etc; the business settles in AED. `currency` + `gross_original` = what the customer paid; `gross_aed` = the AED equivalent. **Only ever SUM on `gross_aed`.** Summing raw totals across currencies produces garbage.
- **Editing `db/schema.sql` does NOT touch the live database** — it's a reference file, not a migration. Run `node db/apply-schema.mjs` after any schema change or the app 500s with "column does not exist" (a single missing column can take down the whole reconcile/orders response). See the `schema_migration_workflow` memory.

## Gateway file quirks (learned the hard way — still true, DB-backed now not Sheets-backed)

**Always get the SETTLEMENT / PAYOUT reconciliation report, never the transactions export**, for file-based ingestion. A settlement report has a payout/settlement ID, a payout date (or bank ref), net amount, and an order ref per row — with those four, reconciliation is exact. With only charges, you're stuck with heuristics.

**Stripe** — the *payout reconciliation report* CSV (not the transactions export) for file-based ingest; the live API (`payoutOrderRefs`) covers the same ground for the automated path. Key link: `automatic_payout_id` ties each charge to its payout → deterministic. Stripe settles as `NETWORK...STRIPE` on the bank statement. Proven result: 21/21 payouts cent-perfect (file-based reconciliation).

**Telr** — file export is `.xls` with a **`Payout ID <number>` banner row at the very top** (e.g. `Payout ID 4841777`), blank rows, a section-label row, then the header row (`Ref, Date, Time, Type, CartID, Description, Name, Currency, Amount, Currency, Amount, MDR, Fees, Tax, Net`), then transactions. **One file = one payout = one bank deposit.** The banner survives `.xls` extraction but is DROPPED by CSV export — so ingest `.xls` (or put the payout ID in the filename as fallback). Sum the `Net` column = the payout total. Telr settles as **`INNOVATE TECHNOLOGIES FZCO`** on the bank statement. The bank line embeds the payout DATE inside its reference: `REF/PO<DDMMYY>` (e.g. `PO260626` = 26/06/2026), plus `20446` = Telr merchant ID. **There is NO payout date inside the Telr file — the bank statement provides the date.** Live API access is currently blocked (see above) — file-based ingest is the only working Telr path right now.

**Tabby** — settlement report `.xlsx`: header row with `Order Number`, `Order Amount`, `Total Deduction`, `Transferred amount`, `Currency`, `Type`; statement # `Tabby<YYYYMMDD><CCY>` (e.g. `Tabby20260706SAR`). One statement per currency. Bank narration `Inward Telex Payment/TABBY LLC/...`.

**Tamara** — merchant statement `.xlsx`: summary block then transaction header (`Merchant Order ID`, `Tamara Order ID`, `Event`, `Event Amount`, `Total Fees`, `VAT Collected by Tamara`, `Total Payable to Merchant`, ...); `Statement ID` label (e.g. `P8498683AE260905`) → payout id `TAMARA-<id>`. KSA layout adds `Merchant Order Number` (`#SA3507`) — prefer it; the KSA `Merchant Order ID` is Tamara's internal id, often Excel-mangled. Negatives are written `(592.42)`. Bank narration `Inward Telex Payment/TAMARA FZE/...`.

**Upload from the credit itself.** A payout file uploaded from a bank credit's panel is pinned to that credit (`payouts.bank_line_id`) and always shows there (as Variance if totals disagree). Files that match no credit are listed in the Reconciliation view until deleted — a file must never look like it vanished.

**Bank keywords by gateway**: Telr → `INNOVATE TECHNOLOGIES`; Stripe → `NETWORK...STRIPE` (descriptor like `STRIPE-WE8MNB3...`); Tabby → `TABBY LLC`; Tamara → `TAMARA FZE`; Checkout → `Checkout MENA`.

**FX reconciliation**: for SAR/KWD payouts, match via the bank's own quoted wire rate (parsed from the narration), not a static FX table — a static table drifts from the actual rate the bank applied and produces false mismatches.

## The three reconciliation outputs

1. **Settled (cash audit)** — payout net → bank deposit, cent-proven. Works from payout file + bank statement ALONE (no store needed). This is the founder's #1 question and the most robust layer.
2. **Awaiting payout** — orders paid but not yet in any payout file = money in transit. Amount-level: `sum(gateway sales in AED) − sum(paid out)` — reliable. Per-order: only reliable for WooCommerce via `telr_tranref`; not attempted for Shopify.
3. **Anomalies** — payout order not in `orders`; bank line with no matching payout; delta ≠ 0.

## The dispatch sheet (Google Sheets — operational output, not the database)

`lib/integrations/dispatch-sheet.ts` writes new orders to one of two tabs, split by country: `SMSA Orders` (international → SMSA/DHL) or `Local orders` (UAE → OnTrack, note the tab's real title has a leading space). **Column mapping is per-tab and EXACT** (not generic aliases) — read live from the actual sheet headers every time (`lib/integrations/google-sheets.ts` `readHeaderRow`/`resolveTabName`), never hardcode column positions, because the real sheet has quirks (blank columns, a near-duplicate "Party"/"Part" pair, whitespace in tab/header names) that drift as the team edits it.

**Only unambiguous, order-placement-time fields are filled** at write time (Date, Order #, Total, Party/Customer, a gateway comment). Anything that's the ops team's manual domain (Payment Status, Delivery By, Fee Deducted, etc.) is left blank on purpose — the system proposes the order, it doesn't pre-empt the human confirmation step. **The one deliberate exception**: `markOrderPaidInSheet` — a live gateway-API payment confirmation (Stripe/Telr) is evidence this system trusts, so the payment-confirm flow is allowed to fill "Actual Payment Status" (as `Paid - Stripe` / `Paid - Telr`, naming the source) and "Payment Received Date/on". It only ever updates an existing row (never appends, never touches any other column) — a human's own edits on that row are always left alone.

**Dedup rides `webhook_inbox`** (provider + uid as the unique key) at two independent layers: `dispatch-sheet-write` for the sheet append, `telegram-order-alert` for the chat message, `stripe-payment-confirm`/`telr-payment-confirm` for payment confirmation — deliberately separate from each other so a transient failure in one never blocks or duplicates the other, and a failure rolls its own dedup mark back so the next cycle retries just that piece.

## Founder / ops Telegram (current bots)

`@omnia_cos_bot` (ops group — new-order alerts, dispatch-sheet status, payment-confirmation notices) and `@Omnia_cfo_bot` (CFO digest). The `@Omniafinancebot` bot referenced in the n8n reference file is retired.

## Reference files

- `references/payout-playbooks.md` — **read before touching any payout booking.** Per gateway × currency: file recognition, fee/VAT convention, bank-rate rule, the Zoho documents and accounts (live ids), worked examples from real statements (Tabby20260907AED, Tabby20260706SAR, Tamara P8498683AE260905), refunds/credit notes, invoice-picking rules, idempotency.
- `references/autonomous-booking-agent.md` — **the blueprint for a no-manual-check booking agent**: ingest → match → prove → plan → assert → post → verify → close → report, auto-link and auto-confirm gates, exception reason codes, rules never to relax, and what's already built vs still to build.
- `references/agent-employee-pattern.md` — **the generic, reusable blueprint** distilled from this build: how to structure a persistent scheduler, dedup ledger, audit trail, safe-write guards, and tolerance-based fuzzy matching for ANY always-on ops automation, not just Omnia.
- `references/n8n-recipes.md` — **historical/superseded.** The original n8n prototype's node configs and SDK gotchas. Useful for understanding early design reasoning; do not build against it.
- `references/data-model.md` — the canonical schema design (orders/payments/payouts/ledger/inventory) and the phased roadmap. The "Phase 2/3" Supabase migration it anticipated is now DONE — `db/schema.sql` is the current source of truth for exact columns; this file is still accurate for the *shape* of the model and the reasoning behind it.
