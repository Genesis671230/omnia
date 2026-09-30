import { test } from "node:test";
import assert from "node:assert/strict";
import { funnelSteps, productHandle, productLeaks, worstLeak } from "../../lib/storefront/funnel-leaks";

test("funnelSteps counts who left at each step", () => {
  const s = funnelSteps({ sessions: 1000, addedToCart: 80, reachedCheckout: 40, completed: 20 });
  assert.deepEqual(s.map((x) => x.lost), [0, 920, 40, 20]);
  assert.equal(s[1].dropRate, 0.92);
  assert.equal(s[3].ofTotal, 0.02);
});

test("worstLeak is the step losing the most visitors; none without traffic", () => {
  assert.equal(worstLeak({ sessions: 1000, addedToCart: 80, reachedCheckout: 40, completed: 20 })?.key, "addedToCart");
  assert.equal(worstLeak({ sessions: 0, addedToCart: 0, reachedCheckout: 0, completed: 0 }), null);
});

test("funnelSteps never reports negative loss when a later step exceeds an earlier one", () => {
  const s = funnelSteps({ sessions: 10, addedToCart: 12, reachedCheckout: 5, completed: 5 });
  assert.equal(s[1].lost, 0);
});

test("productHandle reads localized and collection product paths", () => {
  assert.equal(productHandle("/products/malia-set"), "malia-set");
  assert.equal(productHandle("/ar/collections/bridal/products/charlotte-gold?variant=1"), "charlotte-gold");
  assert.equal(productHandle("/collections/all"), null);
});

test("productLeaks merges locales, drops thin pages, ranks by visitors lost", () => {
  const rows = [
    { path: "/products/a", sessions: 100, addedToCart: 5, reachedCheckout: 2, completed: 1 },
    { path: "/ar/products/a", sessions: 20, addedToCart: 5, reachedCheckout: 1, completed: 1 },
    { path: "/products/b", sessions: 300, addedToCart: 150, reachedCheckout: 60, completed: 30 },
    { path: "/products/c", sessions: 3, addedToCart: 0, reachedCheckout: 0, completed: 0 },
    { path: "/", sessions: 999, addedToCart: 1, reachedCheckout: 1, completed: 1 },
  ];
  const out = productLeaks(rows);
  assert.deepEqual(out.map((p) => p.handle), ["b", "a"]);
  const a = out.find((p) => p.handle === "a")!;
  assert.equal(a.sessions, 120);
  assert.equal(a.bounced, 110);
});
