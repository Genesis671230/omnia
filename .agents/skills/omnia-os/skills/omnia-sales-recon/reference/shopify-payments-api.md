# Shopify Payments via Admin GraphQL

Docs: ShopifyPaymentsPayout, ShopifyPaymentsPayoutConnection, shopifyPaymentsAccount,
ShopifyPaymentsBalanceTransaction (shopify.dev/docs/api/admin-graphql/latest).

## Request

```
POST https://{store}.myshopify.com/admin/api/{SHOPIFY_API_VERSION}/graphql.json
Content-Type: application/json
X-Shopify-Access-Token: <custom-app token, from env — never hard-code or paste>
```

In code always go through `graphqlRequest(store, query, vars)` in
`lib/integrations/shopify.ts` — it builds the endpoint from `getShopifyStores()`.

## Scopes

`read_shopify_payments_payouts` + `read_shopify_payments_accounts` on the store's
custom app (reinstall, then update `SHOPIFY_<CODE>_TOKEN`). Missing scope comes back
as **HTTP 200** with `errors[].extensions.code = "ACCESS_DENIED"` — rethrown as
`ShopifyPaymentsAccessError` naming the scopes, shown on the dashboard as
"Automatic payout sync is blocked". A store with no Shopify Payments account returns
`shopifyPaymentsAccount: null` → skipped quietly (WA).

Status on 2026-09-22: MAIN works; UAE and KSA lack the scopes.

## Queries used

Payouts (newest first, stop at a cutoff):
```graphql
shopifyPaymentsAccount {
  payouts(first: 50, after: $after, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id legacyResourceId issuedAt status transactionType externalTraceId
            net { amount currencyCode }
            summary { chargesGross{amount} chargesFee{amount} refundsFeeGross{amount}
                      refundsFee{amount} adjustmentsGross{amount} adjustmentsFee{amount} } }
  }
}
```
Keep `transactionType = DEPOSIT` and status in PAID / IN_TRANSIT / SCHEDULED.

Per-payout lines: `balanceTransactions(query: "payments_transfer_id:<legacyResourceId>")`,
every node re-checked against `associatedPayout.id`.

Pending charges (no payout yet):
```graphql
balanceTransactions(first: 100, after: $after, reverse: true) {
  nodes { id type test transactionDate
          amount { amount currencyCode } fee { amount } net { amount }
          associatedOrder { id name } associatedPayout { id status } }
}
```
`associatedPayout { id: null, status: "PENDING" }` = charged, not yet paid out.
Keep `type = CHARGE`, `test = false`, with an order; `name` minus `#` = order_number
(e.g. `OS3777`). Stored in `gateway_pending_charges`, replaced per store each sync.

Other useful fields: `sourceType`, `sourceOrderTransactionId`, `adjustmentsOrders`,
`adjustmentReason`.

## Limits and errors

- Cost-based rate limit: `extensions.cost.throttleStatus` (MAIN: 20,000 available,
  restore 1,000/s). A 100-node balanceTransactions page costs ~20 points.
- Single query max cost 1,000 → `MAX_COST_EXCEEDED`. Use bulk operations beyond that.
- GraphQL returns **200 with `errors`** for most failures; always check `json.errors`.
- 402 frozen shop, 403 fraudulent shop, 423 locked (repeated rate-limit abuse), 5xx Shopify side.

## CSV route

Shopify admin → Finances → Payouts → export transactions. Detected by headers
`PAYOUT ID` + `CARD BRAND` + `AVAILABLE ON` (`isShopifyPaymentsExport`); grouped by
Payout ID; store assigned by majority of order stores, SAR → KSA fallback
(`lib/finance/shopify-payout-store.ts`), or the `store` form field on upload.
