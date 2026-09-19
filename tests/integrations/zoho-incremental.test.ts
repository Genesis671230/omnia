import { test } from "node:test";
import assert from "node:assert/strict";
import { toZohoTimestamp } from "@/lib/integrations/zoho";

test("toZohoTimestamp: Zoho wants an explicit offset, not the Z that toISOString emits", () => {
  // Zoho Books rejects/ignores a trailing Z on last_modified_time. Getting
  // this wrong is silent: the filter is dropped and the full catalogue comes
  // back, which is the 278-request cycle this whole change exists to avoid.
  assert.equal(toZohoTimestamp("2026-09-19T14:52:37.771Z"), "2026-09-19T14:52:37+0000");
  assert.equal(toZohoTimestamp("2026-01-01T00:00:00.000Z"), "2026-01-01T00:00:00+0000");
  // A local-offset input is normalised to UTC rather than passed through.
  assert.equal(toZohoTimestamp("2026-09-19T18:52:37+04:00"), "2026-09-19T14:52:37+0000");
});

test("toZohoTimestamp: refuses a timestamp it cannot parse", () => {
  // Better to fail the sync than to send garbage Zoho will ignore, because an
  // ignored filter returns everything and quietly costs the day's budget.
  assert.throws(() => toZohoTimestamp("not a date"), /Invalid timestamp/);
});
