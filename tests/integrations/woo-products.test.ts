import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWooProducts } from "@/lib/integrations/woo";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("fetchWooProducts expands variable products into sellable variations", async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.WOO_URL;
  const originalKey = process.env.WOO_CONSUMER_KEY;
  const originalSecret = process.env.WOO_CONSUMER_SECRET;
  const requested: string[] = [];

  process.env.WOO_URL = "https://woo.example";
  process.env.WOO_CONSUMER_KEY = "key";
  process.env.WOO_CONSUMER_SECRET = "secret";

  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);

    if (url.includes("/products/10/variations")) {
      return new Response(JSON.stringify([
        {
          id: 101,
          parent_id: 10,
          sku: "VAR-RED",
          name: "Variable shirt - Red",
          stock_quantity: 7,
          manage_stock: true,
          status: "publish",
          purchasable: true,
        },
        {
          id: 102,
          parent_id: 10,
          sku: "VAR-BLUE",
          name: "Variable shirt - Blue",
          stock_quantity: 4,
          manage_stock: true,
          status: "publish",
          purchasable: true,
        },
        {
          id: 103,
          parent_id: 10,
          sku: "VAR-SOLD-OUT",
          name: "Variable shirt - Sold out",
          stock_quantity: 0,
          manage_stock: true,
          status: "publish",
          purchasable: false,
        },
      ]), { status: 200 });
    }

    return new Response(JSON.stringify([
      {
        id: 10,
        type: "variable",
        sku: "PARENT-SHOULD-NOT-COUNT",
        name: "Variable shirt",
        stock_quantity: null,
        manage_stock: false,
        status: "publish",
        purchasable: true,
      },
      {
        id: 20,
        type: "simple",
        sku: "SIMPLE-ONE",
        name: "Simple item",
        stock_quantity: 3,
        manage_stock: true,
        status: "publish",
        purchasable: true,
      },
    ]), { status: 200 });
  }) as typeof fetch;

  try {
    const products = await fetchWooProducts();

    assert.deepEqual(products.map((product) => product.sku), [
      "VAR-RED",
      "VAR-BLUE",
      "VAR-SOLD-OUT",
      "SIMPLE-ONE",
    ]);
    assert.deepEqual(products.slice(0, 2).map((product) => product.variation_id), [101, 102]);
    assert.ok(requested.some((url) => url.includes("/products/10/variations")));
  } finally {
    global.fetch = originalFetch;
    restoreEnv("WOO_URL", originalUrl);
    restoreEnv("WOO_CONSUMER_KEY", originalKey);
    restoreEnv("WOO_CONSUMER_SECRET", originalSecret);
  }
});

test("fetchWooProducts paginates a variable product's variations", async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.WOO_URL;
  const originalKey = process.env.WOO_CONSUMER_KEY;
  const originalSecret = process.env.WOO_CONSUMER_SECRET;
  process.env.WOO_URL = "https://woo.example";
  process.env.WOO_CONSUMER_KEY = "key";
  process.env.WOO_CONSUMER_SECRET = "secret";

  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes("/variations")) {
      return new Response(JSON.stringify([{
        id: 10,
        type: "variable",
        sku: "",
        name: "Variable",
        stock_quantity: null,
        manage_stock: false,
        status: "publish",
      }]), { status: 200 });
    }

    const page = new URL(url).searchParams.get("page");
    const count = page === "1" ? 100 : 1;
    return new Response(JSON.stringify(Array.from({ length: count }, (_, index) => ({
      id: (page === "1" ? 1000 : 2000) + index,
      parent_id: 10,
      sku: `VAR-${page}-${index}`,
      name: `Variation ${page}-${index}`,
      stock_quantity: index,
      manage_stock: true,
      status: "publish",
      purchasable: true,
    }))), { status: 200 });
  }) as typeof fetch;

  try {
    const products = await fetchWooProducts();
    assert.equal(products.length, 101);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("WOO_URL", originalUrl);
    restoreEnv("WOO_CONSUMER_KEY", originalKey);
    restoreEnv("WOO_CONSUMER_SECRET", originalSecret);
  }
});
