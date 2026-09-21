import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE } from "@/lib/auth-config";

// Regression: an expired session used to answer an /api/* fetch with a 307 to
// /login. fetch() follows redirects, so the caller got the login PAGE and every
// `.json()` in the app died on `Unexpected token '<', "<!DOCTYPE "...`. In the
// reconciliation proof panel that surfaced as "no settlement record" against
// orders that were settled and booked, next to a green "Every order on this
// payout is booked" — a network failure wearing the costume of finance data.
//
// An API caller must get a status it can branch on. A browser navigation must
// still land on the login page.

const req = (path: string, cookie?: string) =>
  new NextRequest(`https://omnia.test${path}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : undefined,
  });

test("an unauthenticated /api/* request gets 401 JSON, never an HTML redirect", async () => {
  const res = await middleware(req("/api/reconcile/line/abc/settlements"));

  assert.equal(res.status, 401, "must not be a 3xx redirect into the login page");
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);

  const body = await res.json();
  assert.equal(body.sessionExpired, true);
  assert.ok(typeof body.error === "string" && body.error.length > 0);
});

test("a rejected /api/* request body parses as JSON — the '<!DOCTYPE' crash cannot recur", async () => {
  const res = await middleware(req("/api/reconcile/line/abc/orders"));
  const text = await res.text();

  assert.ok(!text.startsWith("<"), `expected JSON, got markup: ${text.slice(0, 40)}`);
  assert.doesNotThrow(() => JSON.parse(text));
});

test("an expired (not merely absent) session is rejected the same way", async () => {
  // A syntactically valid but unverifiable token — same path as a real expiry.
  const res = await middleware(req("/api/orders", "stale.payload"));

  assert.equal(res.status, 401);
  assert.equal((await res.json()).sessionExpired, true);
});

test("a page navigation still redirects to /login and remembers where it was going", async () => {
  const res = await middleware(req("/reconciliation"));

  assert.equal(res.status, 307);
  const location = new URL(res.headers.get("location")!);
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("from"), "/reconciliation");
});

test("public API paths are untouched by the 401 branch", async () => {
  const res = await middleware(req("/api/login"));
  assert.equal(res.status, 200, "public routes must pass straight through");
});
