import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkForInFilter } from "@/lib/repositories/in-filter-chunks";

// A real month-to-date ENBD narration is ~150 chars; 400 of them in one
// `in.(…)` filter was ~70 KB of URL and the request never left the process.
const narration = (i: number) =>
  `2026-09-29|FT26272X${i}|6049.91|FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/AE/SIB.CUST//REF/${i}`;

test("400 statement keys split into requests that each fit the URL budget", () => {
  const keys = Array.from({ length: 400 }, (_, i) => narration(i));
  const chunks = chunkForInFilter(keys);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.map((v) => encodeURIComponent(`"${v}",`).length).reduce((a, b) => a + b, 0) <= 6_000);
  }
  assert.deepEqual(chunks.flat(), keys, "every key kept, in order");
});

test("a short list stays one request; empty input makes none", () => {
  assert.deepEqual(chunkForInFilter(["a", "b"]), [["a", "b"]]);
  assert.deepEqual(chunkForInFilter([]), []);
});

test("a single value over the budget still goes out on its own", () => {
  const huge = "x".repeat(10_000);
  assert.deepEqual(chunkForInFilter([huge, "y"]), [[huge], ["y"]]);
});
