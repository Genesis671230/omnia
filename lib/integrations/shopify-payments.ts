// Shopify Payments payouts — pulled straight from the Admin GraphQL API, so
// Shopify Payments orders match their payout (and, through the reconciler,
// their bank credit) without anyone downloading a payout CSV.
//
//   ShopifyPaymentsPayout            one transfer to the bank: net, issuedAt,
//                                    status, externalTraceId (the bank's ref)
//     └ ShopifyPaymentsBalanceTransaction   one row per charge / refund /
//                                    adjustment: amount (gross), fee, net,
//                                    associatedOrder { name } ← the order
//
// ACCESS. The store's app token needs `read_shopify_payments_payouts` (and
// `read_shopify_payments_accounts` to see the account). Without it Shopify
// answers ACCESS_DENIED — that is reported as a setup problem with the exact
// scope to add, never swallowed as "no payouts".
//
// A store with no Shopify Payments account (WA sells through Stripe / Tabby /
// Tamara links) returns shopifyPaymentsAccount: null and is skipped quietly.

import { graphqlRequest, type ShopifyStoreConfig } from "@/lib/integrations/shopify";
import { toAed } from "@/lib/fx";
import type { ParsedPayout, PayoutTransactionShare } from "@/lib/parsers/payouts";

export const SHOPIFY_PAYOUT_SCOPE = "read_shopify_payments_payouts";

const PAYOUTS_QUERY = /* GraphQL */ `
  query ShopifyPaymentsPayouts($first: Int!, $after: String) {
    shopifyPaymentsAccount {
      id
      payouts(first: $first, after: $after, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          legacyResourceId
          issuedAt
          status
          transactionType
          externalTraceId
          net { amount currencyCode }
          summary {
            chargesGross { amount }
            chargesFee { amount }
            refundsFeeGross { amount }
            refundsFee { amount }
            adjustmentsGross { amount }
            adjustmentsFee { amount }
          }
        }
      }
    }
  }
`;

// `payments_transfer_id` scopes balance transactions to one payout. Every node
// is still checked against associatedPayout below, so a filter Shopify chose
// to ignore could only cost extra pages, never put a charge on the wrong payout.
const BALANCE_TX_QUERY = /* GraphQL */ `
  query ShopifyPaymentsPayoutTransactions($first: Int!, $after: String, $query: String) {
    shopifyPaymentsAccount {
      balanceTransactions(first: $first, after: $after, query: $query) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          type
          test
          transactionDate
          amount { amount currencyCode }
          fee { amount }
          net { amount }
          associatedOrder { id name }
          associatedPayout { id status }
        }
      }
    }
  }
`;

export type ShopifyPayoutNode = {
  id: string;
  legacyResourceId: string;
  issuedAt: string;
  status: string; // SCHEDULED | IN_TRANSIT | PAID | FAILED | CANCELED
  transactionType: string; // DEPOSIT | WITHDRAWAL
  externalTraceId: string | null;
  net: { amount: string; currencyCode: string };
  summary: {
    chargesGross: { amount: string };
    chargesFee: { amount: string };
    refundsFeeGross: { amount: string };
    refundsFee: { amount: string };
    adjustmentsGross: { amount: string };
    adjustmentsFee: { amount: string };
  } | null;
};

export type ShopifyBalanceTxNode = {
  id: string;
  type: string; // CHARGE | REFUND | ADJUSTMENT | DISPUTE | ...
  test: boolean;
  transactionDate: string;
  amount: { amount: string; currencyCode: string };
  fee: { amount: string };
  net: { amount: string };
  associatedOrder: { id: string; name: string } | null;
  associatedPayout: { id: string | null; status: string } | null;
};

export class ShopifyPaymentsAccessError extends Error {}

const num = (v: { amount: string } | null | undefined) => (v ? Number(v.amount) || 0 : 0);
const r2 = (n: number) => +n.toFixed(2);

/** Statuses where the money has left, or is scheduled to leave, for the bank. */
const LIVE_STATUSES = new Set(["PAID", "IN_TRANSIT", "SCHEDULED"]);

function rethrowAccess(e: unknown, store: ShopifyStoreConfig): never {
  const msg = (e as Error).message || "";
  if (msg.includes("ACCESS_DENIED")) {
    throw new ShopifyPaymentsAccessError(
      `Shopify ${store.code}: the app token cannot read Shopify Payments payouts. ` +
        `Add the \`${SHOPIFY_PAYOUT_SCOPE}\` and \`read_shopify_payments_accounts\` Admin API scopes ` +
        `to the store's custom app, reinstall it, and update SHOPIFY_${store.code}_TOKEN.`,
    );
  }
  throw e;
}

/** Payouts issued on or after `sinceIso`, newest first. Null = no Shopify Payments account. */
export async function listShopifyPayouts(
  store: ShopifyStoreConfig,
  sinceIso: string,
): Promise<ShopifyPayoutNode[] | null> {
  const out: ShopifyPayoutNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    let json: any;
    try {
      json = await graphqlRequest(store, PAYOUTS_QUERY, { first: 50, after });
    } catch (e) {
      rethrowAccess(e, store);
    }
    const account = json.data?.shopifyPaymentsAccount;
    if (!account) return null;
    const conn = account.payouts;
    let reachedCutoff = false;
    for (const p of conn.nodes as ShopifyPayoutNode[]) {
      if (p.issuedAt < sinceIso) { reachedCutoff = true; break; }
      out.push(p);
    }
    if (reachedCutoff || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

export async function listPayoutTransactions(
  store: ShopifyStoreConfig,
  payout: ShopifyPayoutNode,
): Promise<ShopifyBalanceTxNode[]> {
  const out: ShopifyBalanceTxNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 30; page++) {
    let json: any;
    try {
      json = await graphqlRequest(store, BALANCE_TX_QUERY, {
        first: 100,
        after,
        query: `payments_transfer_id:${payout.legacyResourceId}`,
      });
    } catch (e) {
      rethrowAccess(e, store);
    }
    const conn = json.data?.shopifyPaymentsAccount?.balanceTransactions;
    if (!conn) break;
    for (const t of conn.nodes as ShopifyBalanceTxNode[]) {
      if (t.associatedPayout?.id === payout.id) out.push(t);
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

/**
 * One Shopify payout + its balance transactions → the ParsedPayout every other
 * gateway produces. Pure.
 *
 * Every order line carries its real gross / fee / net, so the dashboard shows
 * a measured fee per order, not an estimate. Amounts are converted to AED for
 * the ledger; a SAR (KSA) payout also keeps its original-currency totals so
 * the reconciler can apply the bank's own quoted wire rate.
 */
export function toParsedShopifyPayout(
  storeCode: string,
  payout: ShopifyPayoutNode,
  txs: ShopifyBalanceTxNode[],
): ParsedPayout {
  const currency = payout.net.currencyCode || "AED";
  const aed = (n: number) => (currency === "AED" ? r2(n) : toAed(n, currency));
  const net = num(payout.net);

  const orderRefs: string[] = [];
  const transactions: PayoutTransactionShare[] = [];
  let fees = 0;
  let gross = 0;
  for (const t of txs) {
    if (t.test) continue;
    const g = num(t.amount);
    const f = num(t.fee);
    const n = num(t.net);
    fees += f;
    gross += g;
    const ref = t.associatedOrder?.name?.replace(/^#/, "");
    if (!ref) continue; // payout-level adjustment/reserve: counts toward net, belongs to no order
    const isRefund = t.type.toUpperCase().includes("REFUND");
    if (!orderRefs.includes(ref)) orderRefs.push(ref);
    transactions.push({
      ref,
      isRefund,
      quality: isRefund ? "refund" : "clean",
      grossShare: aed(g),
      feeShare: aed(f),
      netShare: aed(n),
      grossOriginal: r2(g),
      feeOriginal: r2(f),
      netOriginal: r2(n),
    });
  }

  // The summary is Shopify's own total; fall back to the summed rows only if
  // the summary is missing.
  const s = payout.summary;
  const summaryGross = s ? num(s.chargesGross) + num(s.refundsFeeGross) + num(s.adjustmentsGross) : null;
  const summaryFees = s ? num(s.chargesFee) + num(s.refundsFee) + num(s.adjustmentsFee) : null;

  return {
    id: `SHOPIFY-${storeCode}-${payout.legacyResourceId}`,
    statementNo: `SHOPIFY-${storeCode}-${payout.legacyResourceId}`,
    provider: "Shopify Payments",
    net: aed(net),
    gross: aed(summaryGross ?? gross),
    fees: aed(summaryFees ?? fees),
    orderRefs,
    transactions,
    store: `Shopify ${storeCode}`,
    source: "shopify-payments-api",
    notes:
      `Fetched live via Shopify Payments API · ${storeCode} · ${payout.status.toLowerCase()} · ` +
      `issued ${payout.issuedAt.slice(0, 10)}` +
      (payout.externalTraceId ? ` · bank trace ${payout.externalTraceId}` : ""),
    ...(currency !== "AED" ? { originalCurrency: currency, netOriginal: r2(net) } : {}),
  };
}

export type ShopifyPayoutSyncResult = {
  store: string;
  payouts: ParsedPayout[];
  paid: { id: string; issuedDate: string }[];
  skipped?: "no_account";
};

/** Pull and normalise one store's recent payouts. Deposits only — a withdrawal
 *  is money going back to Shopify, never a bank credit to reconcile. */
export async function fetchStoreShopifyPayouts(
  store: ShopifyStoreConfig,
  sinceIso: string,
): Promise<ShopifyPayoutSyncResult> {
  const nodes = await listShopifyPayouts(store, sinceIso);
  if (nodes === null) return { store: store.code, payouts: [], paid: [], skipped: "no_account" };

  const payouts: ParsedPayout[] = [];
  const paid: { id: string; issuedDate: string }[] = [];
  for (const p of nodes) {
    if (p.transactionType !== "DEPOSIT" || !LIVE_STATUSES.has(p.status)) continue;
    const txs = await listPayoutTransactions(store, p);
    const parsed = toParsedShopifyPayout(store.code, p, txs);
    payouts.push(parsed);
    if (p.status === "PAID") paid.push({ id: parsed.id, issuedDate: p.issuedAt.slice(0, 10) });
  }
  return { store: store.code, payouts, paid };
}
