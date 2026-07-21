import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchShopifyOrders } from "@/lib/integrations/shopify";

// Real timers, kept short via a tiny Retry-After / high restoreRate so these
// tests run fast without needing to fake Node's timer internals — the retry
// *logic* under test (does it retry, does it give up after MAX_ATTEMPTS) is
// what matters, not the actual backoff duration.

test("fetchShopifyOrders retries once on HTTP 429 then succeeds", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("rate limited", { status: 429, headers: { "Retry-After": "0.01" } });
    }
    return new Response(
      JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const result = await fetchShopifyOrders({ code: "KSA", url: "https://x.myshopify.com", token: "t" }, "2024-01-01");
    assert.equal(calls, 2, "should have retried exactly once after the 429");
    assert.deepEqual(result, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchShopifyOrders gives up after repeated 429s and throws via the existing !res.ok path", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls += 1;
    return new Response("rate limited", { status: 429, headers: { "Retry-After": "0.01" } });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchShopifyOrders({ code: "KSA", url: "https://x.myshopify.com", token: "t" }, "2024-01-01"),
      /HTTP 429/,
    );
    assert.equal(calls, 5, "should stop after MAX_RETRY_ATTEMPTS attempts");
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchShopifyOrders retries on GraphQL THROTTLED error then succeeds", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          errors: [{ message: "Throttled", extensions: { code: "THROTTLED", cost: { throttleStatus: { restoreRate: 1000 } } } }],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const result = await fetchShopifyOrders({ code: "UAE", url: "https://x.myshopify.com", token: "t" }, "2024-01-01");
    assert.equal(calls, 2, "should have retried exactly once after THROTTLED");
    assert.deepEqual(result, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchShopifyOrders calls onPage incrementally per page, in addition to accumulating the full result", async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls += 1;
    const hasNextPage = calls === 1;
    return new Response(
      JSON.stringify({
        data: {
          orders: {
            pageInfo: { hasNextPage, endCursor: hasNextPage ? "cursor1" : null },
            nodes: [{ id: `gid://shopify/Order/${calls}`, name: `#${calls}` }],
          },
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const pages: unknown[][] = [];
  try {
    const result = await fetchShopifyOrders(
      { code: "KSA", url: "https://x.myshopify.com", token: "t" },
      "2024-01-01",
      async (orders) => {
        pages.push(orders);
      },
    );
    assert.equal(pages.length, 2, "onPage should fire once per page");
    assert.equal(result.length, 2, "the accumulated return value should still contain both pages");
  } finally {
    global.fetch = originalFetch;
  }
});
