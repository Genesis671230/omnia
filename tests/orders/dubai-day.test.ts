import { test } from "node:test";
import assert from "node:assert/strict";
import { dubaiDayKey, utcMs } from "@/lib/dubai-day";

// orders.order_date comes back from Supabase with no offset and is UTC.
// These must hold whatever timezone the host runs in.
test("an offset-less order_date is read as UTC, not host-local time", () => {
  // SA3905: 02:19 Dubai on Sep 1 = 22:19 UTC on Aug 31
  assert.equal(dubaiDayKey("2026-08-31T22:19:31"), "2026-09-01");
  // 804804: 00:10 Dubai on Sep 2
  assert.equal(dubaiDayKey("2026-09-01T20:10:53"), "2026-09-02");
  assert.equal(dubaiDayKey("2026-09-01T19:59:59"), "2026-09-01");
  assert.equal(dubaiDayKey("2026-08-31 22:19:31"), "2026-09-01");
});

test("explicit offsets and date-only values are respected", () => {
  assert.equal(dubaiDayKey("2026-08-31T22:19:31Z"), "2026-09-01");
  assert.equal(dubaiDayKey("2026-08-31T22:19:31+00:00"), "2026-09-01");
  assert.equal(dubaiDayKey("2026-09-01T02:19:31+04:00"), "2026-09-01");
  assert.equal(utcMs("2026-09-01"), Date.UTC(2026, 8, 1));
  assert.equal(dubaiDayKey(null), null);
  assert.equal(dubaiDayKey("garbage"), null);
});
