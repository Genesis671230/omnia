import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveZohoLabel } from "@/lib/integrations/zoho-throttle";

test("deriveZohoLabel: names the endpoint, not the call site", () => {
  const B = "https://www.zohoapis.com/books/v3";
  assert.equal(deriveZohoLabel(`${B}/invoices?organization_id=1&per_page=200`), "books.invoices.list");
  assert.equal(deriveZohoLabel(`${B}/customerpayments?organization_id=1`, { method: "POST" }), "books.customerpayments.create");
  assert.equal(deriveZohoLabel(`${B}/settings/taxes?organization_id=1`), "books.settings.taxes.list");
});

test("deriveZohoLabel: an id in the path makes it a single-record read", () => {
  const B = "https://www.zohoapis.com/books/v3";
  // Ids are what make a per-order N+1 loop expensive, so list and get must
  // never collapse into the same row in the usage table.
  assert.equal(deriveZohoLabel(`${B}/invoices/903000000123456?organization_id=1`), "books.invoices.get");
  assert.equal(deriveZohoLabel(`${B}/customerpayments/903000000987654?organization_id=1`, { method: "PUT" }), "books.customerpayments.update");
});

test("deriveZohoLabel: inventory and books are told apart", () => {
  assert.equal(
    deriveZohoLabel("https://www.zohoapis.com/inventory/v1/items?organization_id=1"),
    "inventory.items.list",
  );
  assert.equal(
    deriveZohoLabel("https://www.zohoapis.com/inventory/v1/inventoryadjustments?organization_id=1", { method: "POST" }),
    "inventory.inventoryadjustments.create",
  );
});

test("deriveZohoLabel: never throws on junk, so it cannot break a real call", () => {
  // This runs inside the quota path on every request. A throw here would take
  // down invoicing to save a log line.
  assert.equal(deriveZohoLabel("not a url"), "unparsed");
  assert.ok(deriveZohoLabel("https://www.zohoapis.com/").length > 0);
});
