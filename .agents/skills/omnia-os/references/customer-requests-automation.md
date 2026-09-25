# Cancellations, refunds, exchanges as one automated flow

## Today (Sept 2026)

Customer support receives the request. One person (Ranjit) then works it by hand
across four places: the store (cancel/refund), the gateway (refund), Zoho (credit note,
sometimes), and the dispatch sheet (comments, Cancelled / Refunded Amount, Refund Date).
Nothing links them, so they drift:

- 63 exchanges in the sheet vs 21 exchange credit notes in Zoho (stock not returned in the books).
- Refunds marked in the sheet with no credit note (WA55658, 3497, OS3761, OS3771, OS3770).
- Credit notes raised at full item value while the customer got about 3.2% less back, so
  23 credit notes stay open.
- Exchanges invoiced again at full price while only a top-up was collected.

## Target: one request record drives every system

1. **Intake.** One `customer_requests` row per request: order, type (cancel before
   dispatch, cancel after dispatch, return and refund, partial refund, exchange), items,
   amount to return, deduction and its reason, requested by, status. Filled from a small
   form in the app or a Telegram command used by support; Shopify's `refunds/create`
   webhook (already wired) creates or completes the row when a refund is done in Shopify.
2. **Approve.** One click (app or Telegram button). The policy decides amounts, not the
   person: deduction rules (restocking, shipping, FX) are set once by the CEO.
3. **Act, in order, each step idempotent and logged:**
   - Store: cancel / refund / create the exchange order through the Shopify API.
   - Gateway: refund through Stripe / Shopify Payments API; Tabby / Tamara / Telr refunds
     through their merchant APIs where access exists, else a task with the exact amount.
   - Courier: cancel the OnTrack / SMSA shipment or book the return pickup.
   - Zoho: credit note for **exactly** what the customer gets back (so it closes when the
     gateway refund lands); exchange = zero-value stock return + replacement invoice + the
     returned item's credit applied + top-up payment link.
   - Dispatch sheet: update only that order's row (Comments, Cancelled / Refunded Amount,
     Refund Date) the way `markOrderPaidInSheet` already updates payment cells.
4. **Close automatically.** When the refund shows up in a payout, the refund engine
   books it against that credit note (charge and VAT per gateway). Leftovers disappear
   because the note equals the refund.
5. **Report.** Daily Telegram: requests opened, done, stuck (with reason); the
   returns/exchanges report compares sheet and Zoho and must show zero mismatches.

## Build order (smallest useful first)

1. Request log + dispatch sheet auto-update + credit note at the refunded amount.
2. Exchange flow (credit applied to the new invoice, top-up link).
3. Gateway refunds via API (Stripe, Shopify Payments first; others as access allows).
4. Daily auto-close of the clean group with evidence gates (see
   `skills/omnia-finance/references/autonomous-booking-agent.md`) and a Telegram report;
   people only handle exceptions.

## Blockers to clear

Telr API access (403), Shopify payouts scope on UAE/KSA tokens, Zoho sales-returns
scope, automatic bank statement feed, auto-confirming credits that pass the evidence gates.
