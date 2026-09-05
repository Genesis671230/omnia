# Payout Uploader Hardening — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the payout-upload reconciliation surface (`components/finance/reconciliation/*`) trustworthy on real data before any visual redesign: fix the provider-mistagging bug that breaks Stripe/Network payout matching, drive the gateway filter from the live Zoho clearing-account list instead of a hardcoded enum, add a Gross/Net/Awaiting/Fees/Refunds/Exchanges summary bar, move the recon data layer onto React Query (already a dependency, unused here) with a TanStack Table (already a dependency) driving the line list, and let a founder delete a wrongly-uploaded payout.

**Architecture:** Small, additive changes to the existing parser/repository/engine layers (no schema changes beyond one new repository method and one new route) plus a client-side data-layer swap (manual `fetch`+`setInterval` → `@tanstack/react-query`) that preserves `useReconciliation`'s existing return shape so `finance-workspace.tsx` needs no changes beyond the import. The PowerBI-style visual redesign and the Google Sheets sync for this pathway are explicitly **out of scope** for this plan (confirmed with the founder: fix the data first, redesign second) — Task 4 wires TanStack Table's state/sorting underneath the *existing* `ReconRow` rendering, it does not rebuild the row layout.

**Tech Stack:** TypeScript, Next.js, `@tanstack/react-query` (already installed, provider already mounted in `components/providers/query-provider.tsx`, unused by the reconciliation surface today), `@tanstack/react-table` (already installed, unused anywhere in the repo today), `xlsx` (already a dependency), Node's built-in test runner (`node:test` + `node:assert/strict`) via `tsx --test 'tests/**/*.test.ts'` (existing `npm test` script from the prior `recon-gateway-hardening` plan).

**Spec:** This plan has no separate spec doc — the founder's requirements were captured directly in conversation (2026-09-05) and confirmed via two scoping questions: (1) `payout_5467548.xls` is a genuine Telr file, not mislabeled Stripe — the Telr/Network file-shape bug below is a real, separate, evidence-based finding, not a guess; (2) sequencing is "fix data first" — parser correctness + Zoho-driven filter + KPI bar + TanStack/React Query + delete, *then* a separate visual-redesign + Google Sheets-sync pass.

## Global Constraints

- **No guesswork in monetary math** (carried over from the prior `recon-gateway-hardening` plan's founder mandate, still binding): every new/changed pure function that touches money gets a fixture test asserting an **exact** total via `.toFixed(2)` — never approximate.
- `npx tsx --test 'tests/**/*.test.ts'` is the verified test-run command (glob quoted). An unquoted glob or bare directory path does not recursively discover files with this repo's `tsx` version.
- Every parser/repository/pure-logic change gets a `node:test` fixture test. UI wiring (React components, routes) gets a manual verification step (`Run: … Expected: …`) instead — this repo has no existing component-test harness, and introducing one is out of scope for this plan.
- Do not touch `lib/reconciliation/stripe-settlements.ts`, `lib/integrations/stripe.ts`, or the live Stripe balance-transaction proof path (`app/api/payouts/[id]/stripe-proof/route.ts`) in this plan. The founder's "Stripe shows AED 30,031.75 but bank credited AED 0.00" report could not be reproduced from the uploaded-file path (confirmed: `payout_5467548.xls` is genuinely Telr, and Telr's own parser produces correct, footing totals — verified by running it directly). That report needs a live reproduction (a specific bank-line id or Stripe payout id) before it can be safely fixed; guessing at a fix for a live-API code path with no way to verify it against a real Stripe account would violate the "no guesswork" constraint above.
- Never delete a `payouts` row (or its `payout_transactions`) once its recon line has `confirmed_by` set — a founder-confirmed settlement may already be posted to Zoho; undoing the underlying payout data out from under it would desync the books silently.

---

### Task 1: Fix payout provider mis-tagging for the shared Telr/Network file shape

**Files:**
- Modify: `lib/parsers/payouts.ts:158-281` (`parseTelrXls`), `lib/parsers/payouts.ts:828-830` (`parsePayoutFile`'s Telr-shape detection)
- Test: `tests/parsers/payouts-telr-provider-hint.test.ts`

**Interfaces:**
- Modifies: `parseTelrXls(buf: Buffer | ArrayBuffer, filename: string, provider: Gateway = "Telr"): ParsedPayout[]` — same return shape, new optional third parameter, defaulting to today's behavior so every existing call site (including the two other places `parsePayoutFile` calls it) is unaffected unless it opts in.
- Consumes: `Gateway` (already exported from `@/lib/gateways`), `ParsedPayout`, `PayoutTransactionShare` (already defined in the same file).

**Root cause (verified, not guessed):** `parsePayoutFile` sniffs file content for the `"Payout ID <n>"` banner or `CartID`+`Net` columns and — regardless of the `hint` parameter the caller passed — always routes to `parseTelrXls`, which hardcodes `provider: "Telr"` and `id: `TELR-${payoutId}``. Verified directly: reading `/Users/gaian/Downloads/payout_5467548 (3).xls` with `XLSX` shows the exact shape (`Payout ID 5467548` banner row, `Ref/Date/Time/Type/CartID/…/Currency/Amount/Currency/Amount/MDR/Fees/Tax/Net` header) — and this is also the same statement layout the store's card-acquiring rail ("NETWORK" — see `lib/gateways.ts:43`, `{ keyword: "NETWORK", provider: "Stripe", confidence: "keyword" }`) uses for its own settlement exports. `app/api/upload/payout/route.ts:17-19` already extracts a `provider` hint from the upload form (`Stripe`/`Telr`/`Checkout`/`Tabby`/`Tamara`) and passes it into `parsePayoutFile` — but for this specific file shape, that hint is silently discarded. The result: a Network-rail settlement file uploaded through the "Stripe" upload slot gets stored as a Telr payout (`gateway: "Telr"`), which can never satisfy `computeReconLines`'s `p.gateway === provider` match against a bank credit the classifier tagged `"Stripe"` (via the `NETWORK` keyword rule) — that bank credit is then structurally stuck in `AWAITING_PAYOUT` (or matches nothing, or gets confused with an unrelated real Telr payout that happens to also be uploaded) forever, no matter what the founder does.

**Why not just tag it `id: "STRIPE-<n>"`:** `components/finance/reconciliation/recon-row.tsx:104` treats any payout whose `id` starts with `"STRIPE-"` as a *live Stripe API* payout (`isStripe`), and tries to fetch `/api/payouts/:id/stripe-proof` instead of rendering the uploaded file's own `transactions[]`. An uploaded Network-rail file has no real Stripe API payout behind it, so that fetch would always fail and the correctly-parsed per-order breakdown would never render. This plan uses a distinct `NETWORK-` id prefix for this case instead, so the existing `!isStripe && r.transactions.length > 0 && r.payout && <GatewayProof r={r} />` path in `recon-row.tsx:282` renders the uploaded file's real per-order data unchanged — no `recon-row.tsx` edit needed for this task.

- [ ] **Step 1: Write the failing test**

Create `tests/parsers/payouts-telr-provider-hint.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseTelrXls, parsePayoutFile } from "@/lib/parsers/payouts";

function telrShapeXlsx(payoutId: string): Buffer {
  const rows = [
    [`Payout ID ${payoutId}`],
    [],
    ["Transaction", "", "", "", "", "", "", "Authorisation", "", "Settlement", "", "", "", "", ""],
    ["Ref", "Date", "Time", "Type", "CartID", "Description", "Name", "Currency", "Amount", "Currency", "Amount", "MDR", "Fees", "Tax", "Net"],
    ["030100000001", "01/09/2026", "10:00", "Sale", "700001_abc", "Your order", "Test Customer", "AED", 100, "AED", 100, -3, 0, -0.5, 96.5],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Payout");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("parseTelrXls: defaults to Telr provider and TELR- id prefix (unchanged behavior)", () => {
  const [payout] = parseTelrXls(telrShapeXlsx("9000001"), "payout_9000001.xls");
  assert.equal(payout.provider, "Telr");
  assert.equal(payout.id, "TELR-9000001");
});

test("parseTelrXls: an explicit Stripe provider tags the payout Stripe with a NETWORK- id, not TELR-", () => {
  const [payout] = parseTelrXls(telrShapeXlsx("9000002"), "payout_9000002.xls", "Stripe");
  assert.equal(payout.provider, "Stripe");
  assert.equal(payout.id, "NETWORK-9000002");
  // math is untouched by the provider override — same computation either way
  assert.equal(payout.net, 96.5);
  assert.deepEqual(payout.orderRefs, ["700001"]);
});

test("parsePayoutFile: a Telr-shaped file uploaded with hint=Stripe is tagged Stripe/NETWORK-, not Telr", () => {
  const buf = telrShapeXlsx("9000003");
  const [payout] = parsePayoutFile(buf, "payout_9000003.xls", "Stripe");
  assert.equal(payout.provider, "Stripe");
  assert.equal(payout.id, "NETWORK-9000003");
});

test("parsePayoutFile: the same file with no hint (or hint=Telr) still tags Telr — no regression", () => {
  const buf = telrShapeXlsx("9000004");
  const [noHint] = parsePayoutFile(buf, "payout_9000004.xls");
  assert.equal(noHint.provider, "Telr");
  assert.equal(noHint.id, "TELR-9000004");

  const [telrHint] = parsePayoutFile(buf, "payout_9000004.xls", "Telr");
  assert.equal(telrHint.provider, "Telr");
  assert.equal(telrHint.id, "TELR-9000004");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: the first test passes already (default behavior unchanged); the "Stripe provider" tests FAIL — `parseTelrXls` doesn't accept a third argument yet, and `parsePayoutFile`'s Telr-shape branch ignores `hint` entirely, so both still report `provider: "Telr"` / `id: "TELR-9000002"` etc.

- [ ] **Step 3: Add the provider parameter to `parseTelrXls`**

In `lib/parsers/payouts.ts`, change the function signature (currently at line 158):

```ts
export function parseTelrXls(buf: Buffer | ArrayBuffer, filename: string, provider: Gateway = "Telr"): ParsedPayout[] {
```

Then change the `return` statement (currently lines 270-280) from:

```ts
  return [{
    id: `TELR-${payoutId}`,
    provider: "Telr",
    net:   +net.toFixed(2),
    gross: +gross.toFixed(2),
    fees:  +fees.toFixed(2),
    orderRefs,
    source: filename,
    notes: `${sales} sales${refunds ? `, ${refunds} refunds` : ""} · settled AED${ccyMix.size ? ` · authorised in ${[...ccyMix].sort().join("/")}` : ""}`,
    transactions: [...shareByRef.values()],
  }];
```

to:

```ts
  // This exact file shape (banner + CartID + Auth/Settlement pairs + MDR/
  // Fees/Tax/Net) is also what the store's Network-rail card settlements use
  // for Stripe-classified bank credits (see BANK_DESCRIPTOR_RULES' "NETWORK"
  // → "Stripe" rule in lib/gateways.ts) — same computation, different
  // provider tag. NETWORK- (not STRIPE-) keeps this out of recon-row.tsx's
  // `isStripe` live-API-proof path, which only real STRIPE-po_… ids should
  // trigger; this file's own transactions[] should render directly instead.
  const idPrefix = provider === "Stripe" ? "NETWORK" : "TELR";
  return [{
    id: `${idPrefix}-${payoutId}`,
    provider,
    net:   +net.toFixed(2),
    gross: +gross.toFixed(2),
    fees:  +fees.toFixed(2),
    orderRefs,
    source: filename,
    notes: `${sales} sales${refunds ? `, ${refunds} refunds` : ""} · settled AED${ccyMix.size ? ` · authorised in ${[...ccyMix].sort().join("/")}` : ""}`,
    transactions: [...shareByRef.values()],
  }];
```

- [ ] **Step 4: Make `parsePayoutFile` pass the hint through for this shape**

In `lib/parsers/payouts.ts`, find the Telr-shape detection (currently around line 828):

```ts
  if (/PAYOUT\s*ID\s*\d/.test(sniff) || (sniff.includes("CARTID") && sniff.includes("NET"))) {
    return parseTelrXls(buffer, filename);
  }
```

Replace with:

```ts
  if (/PAYOUT\s*ID\s*\d/.test(sniff) || (sniff.includes("CARTID") && sniff.includes("NET"))) {
    // This file shape is shared by Telr and the Network-rail Stripe
    // settlement export — only the hint disambiguates which one it is.
    // Any other hint (Tabby/Tamara/Checkout/COD/undefined) keeps today's
    // default of tagging it Telr, since that's the shape's primary source.
    return parseTelrXls(buffer, filename, hint === "Stripe" ? "Stripe" : "Telr");
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: all 5 new tests pass, and the full existing suite still passes (no `net`/`gross`/`fees`/`orderRefs` regression for any existing Telr fixture or call site).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/payouts.ts tests/parsers/payouts-telr-provider-hint.test.ts
git commit -m "$(cat <<'EOF'
Fix payout provider mis-tagging for the shared Telr/Network file shape

parsePayoutFile detected the "Payout ID + CartID + Net" shape and always
routed it to parseTelrXls, which hardcoded provider: "Telr" regardless of
the upload-slot hint the caller passed. This is also the exact shape the
store's Network-rail card settlements use for Stripe-classified bank
credits (lib/gateways.ts's "NETWORK" → "Stripe" narration rule) — so a
Network settlement file uploaded through the Stripe slot was silently
stored as a Telr payout and could never match its Stripe-tagged bank
credit. parseTelrXls now accepts an optional provider override (default
Telr, unchanged), tagged with a NETWORK- id prefix when the hint is Stripe
so it doesn't collide with recon-row.tsx's live-Stripe-API-proof path,
which only real STRIPE-po_… ids should trigger.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 2: Zoho-driven gateway filter for ReconView

**Files:**
- Create: `lib/reconciliation/gateway-filter.ts`
- Modify: `components/finance/reconciliation/recon-view.tsx`
- Test: `tests/reconciliation/gateway-filter.test.ts`

**Interfaces:**
- Produces: `export type GatewayFilterOption = { key: string; label: string; gateway: string; region: string | null }`, `export function gatewayFilterOptionsFromZohoAccounts(accounts: { account_name: string; account_type?: string }[]): GatewayFilterOption[]`, `export function regionForLine(line: { payout: { currency: string | null } | null }): string | null` — all in `lib/reconciliation/gateway-filter.ts`.
- Consumes: `useZohoSettings()` (already imported in `recon-view.tsx:12`, already fetches `config.allAccounts`) — no new fetch is introduced, this reuses the same Zoho account list `gateway-account-map.ts` already resolves against.

**Design:** The founder's requested filter list is exactly the 8 payment-clearing accounts Zoho already has (verified against `lib/finance/gateway-account-map.ts`'s own account-matching rules, built 2026-09-04 against the live chart of accounts): Tabby AED, TABBY KSA, TABBY KWD, TAMARA KSA, TAMARA AED, TELR Gateway, Stripe payment Gateway ("getaway" typo and all), Shopify Payments. Rather than hardcode those 8 labels (which would silently go stale if Zoho renames or adds an account — the exact failure mode `gateway-account-map.ts`'s own doc comment warns against), this derives the filter list from the *same* `allAccounts` array by keyword, mirroring `gateway-account-map.ts`'s `normalize()`/`NON_UAE_REGION_TOKENS` approach exactly so the two stay in lockstep.

A `ReconLine.provider` (from `lib/gateways.ts`'s `Gateway` union) is coarse — it has no region. Tabby/Tamara payouts carry their statement currency on `line.payout.currency` (SAR/KWD/AED — populated by `parseTabbyXlsx`/`parseTamaraXlsx`'s `originalCurrency` field, wired through `computeReconLines`), which is the same signal `gateway-account-map.ts` already uses to pick a region-specific Zoho account for posting. `regionForLine` reuses that exact mapping (SAR→KSA, KWD→KWD, OMR→OMR, BHD→BHD, everything else/AED→`null` meaning "local/AED"), so a line filters into the same bucket it would post to.

- [ ] **Step 1: Write the failing test**

Create `tests/reconciliation/gateway-filter.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayFilterOptionsFromZohoAccounts, regionForLine } from "@/lib/reconciliation/gateway-filter";

test("gatewayFilterOptionsFromZohoAccounts: maps the founder's real Zoho account names to gateway+region, in the requested order", () => {
  const accounts = [
    { account_name: "TABBY AED", account_type: "payment_clearing" },
    { account_name: "TABBY KSA", account_type: "payment_clearing" },
    { account_name: "TABBY KWD", account_type: "payment_clearing" },
    { account_name: "TAMARA KSA", account_type: "payment_clearing" },
    { account_name: "TAMARA", account_type: "payment_clearing" },
    { account_name: "Telr Gateway", account_type: "payment_clearing" },
    { account_name: "Stripe Payment getaway", account_type: "payment_clearing" },
    { account_name: "Shopify Payments", account_type: "payment_clearing" },
    // decoys that must NOT appear as filter options:
    { account_name: "Delivery Charges - Tabby", account_type: "cost_of_goods_sold" },
    { account_name: "Checkout - SAR", account_type: "payment_clearing" },
  ];

  const options = gatewayFilterOptionsFromZohoAccounts(accounts);
  const keys = options.map((o) => o.key);

  assert.deepEqual(
    keys,
    ["tabby-aed", "tabby-ksa", "tabby-kwd", "tamara-ksa", "tamara-aed", "telr-aed", "stripe-aed", "shopify payments-aed", "checkout-aed"],
  );
  assert.equal(options.find((o) => o.key === "tabby-ksa")!.gateway, "Tabby");
  assert.equal(options.find((o) => o.key === "tabby-ksa")!.region, "KSA");
  assert.equal(options.find((o) => o.key === "tamara-aed")!.region, null);
  // the cost/expense decoy is excluded — same rule gateway-account-map.ts uses
  assert.equal(options.some((o) => o.label === "Delivery Charges - Tabby"), false);
});

test("regionForLine: maps payout currency to the same region codes gateway-account-map.ts posts against", () => {
  assert.equal(regionForLine({ payout: { currency: "SAR" } }), "KSA");
  assert.equal(regionForLine({ payout: { currency: "KWD" } }), "KWD");
  assert.equal(regionForLine({ payout: { currency: "OMR" } }), "OMR");
  assert.equal(regionForLine({ payout: { currency: "AED" } }), null);
  assert.equal(regionForLine({ payout: null }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL — `lib/reconciliation/gateway-filter.ts` doesn't exist yet.

- [ ] **Step 3: Implement `lib/reconciliation/gateway-filter.ts`**

```ts
// Gateway filter options for the reconciliation surface, derived from the
// SAME live Zoho clearing-account list lib/finance/gateway-account-map.ts
// posts settlements against — so the filter never drifts from the accounts
// a founder can actually post to. Keyword-matched (not hardcoded literal
// labels) for the same reason gateway-account-map.ts is: it adapts
// automatically if Zoho renames or adds an account.

const CLEARING_ACCOUNT_TYPE = "payment_clearing";
const NON_UAE_REGION_TOKENS = ["ksa", "kwd", "qar", "qtr", "omr", "bhd", "sar"];
const REGION_LABEL: Record<string, string> = {
  ksa: "KSA", kwd: "KWD", qar: "QAR", qtr: "QAR", omr: "OMR", bhd: "BHD", sar: "KSA",
};

// Currency → region, the inverse of the mapping gateway-account-map.ts uses
// to pick a region-specific clearing account. SAR is the KSA store's
// settlement currency (verified against FX reconciliation work), so it maps
// to the "KSA" filter bucket like the KSA-tagged Zoho accounts do.
const CURRENCY_REGION: Record<string, string> = {
  SAR: "KSA", KWD: "KWD", QAR: "QAR", OMR: "OMR", BHD: "BHD",
};

const GATEWAY_KEYWORDS: { keyword: string; gateway: string }[] = [
  { keyword: "tabby", gateway: "Tabby" },
  { keyword: "tamara", gateway: "Tamara" },
  { keyword: "telr", gateway: "Telr" },
  { keyword: "stripe", gateway: "Stripe" },
  { keyword: "shopify", gateway: "Shopify Payments" },
  { keyword: "checkout", gateway: "Checkout" },
];

// The founder's requested display order — known gateway+region pairs sort
// first, in this order; anything else (a future Zoho account this list
// doesn't anticipate) sorts after, never dropped silently.
const PRIORITY: [string, string | null][] = [
  ["Tabby", null], ["Tabby", "KSA"], ["Tabby", "KWD"],
  ["Tamara", "KSA"], ["Tamara", null],
  ["Telr", null], ["Stripe", null], ["Shopify Payments", null],
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim();
}

export type GatewayFilterOption = {
  key: string;
  label: string;
  gateway: string;
  region: string | null;
};

export function gatewayFilterOptionsFromZohoAccounts(
  accounts: { account_name: string; account_type?: string }[],
): GatewayFilterOption[] {
  const pool = accounts.filter((a) => !a.account_type || a.account_type === CLEARING_ACCOUNT_TYPE);
  const seen = new Set<string>();
  const options: GatewayFilterOption[] = [];

  for (const a of pool) {
    const n = normalize(a.account_name);
    const hit = GATEWAY_KEYWORDS.find((g) => n.includes(g.keyword));
    if (!hit) continue;
    const regionToken = NON_UAE_REGION_TOKENS.find((t) => n.includes(t));
    const region = regionToken ? REGION_LABEL[regionToken] : null;
    const key = `${hit.gateway.toLowerCase()}-${region ?? "aed"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ key, label: a.account_name, gateway: hit.gateway, region });
  }

  const rank = (o: GatewayFilterOption) => {
    const i = PRIORITY.findIndex(([g, r]) => g === o.gateway && r === o.region);
    return i === -1 ? PRIORITY.length : i;
  };
  return options.sort((x, y) => rank(x) - rank(y));
}

export function regionForLine(line: { payout: { currency: string | null } | null }): string | null {
  const ccy = line.payout?.currency;
  if (!ccy) return null;
  return CURRENCY_REGION[ccy.toUpperCase()] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: both new tests pass.

- [ ] **Step 5: Wire the filter into `recon-view.tsx`**

In `components/finance/reconciliation/recon-view.tsx`, add the import (alongside the existing imports at the top):

```ts
import { gatewayFilterOptionsFromZohoAccounts, regionForLine } from "@/lib/reconciliation/gateway-filter";
```

Add the filter state right after the existing `groupMode`/`collapsed` state (after line 42) — this has no dependency on anything else, so it's safe here:

```ts
  const [gatewayFilter, setGatewayFilter] = useState<string | null>(null); // null = All gateways
```

`gatewayOptions` depends on `zohoConfig`, which the component doesn't define until a few lines later (`const { config: zohoConfig } = useZohoSettings();`, currently line 46) — add it **right after that line**, not before (referencing `zohoConfig` any earlier is a ReferenceError, since `const` isn't usable before its own declaration line):

```ts
  const gatewayOptions = useMemo(
    () => gatewayFilterOptionsFromZohoAccounts(zohoConfig?.allAccounts ?? []),
    [zohoConfig],
  );
```

Change the `searched` derivation (currently line 50, right after where `gatewayOptions` now sits) to apply the gateway filter before the search, so tab counts and the search-result count both reflect it:

```ts
  const gatewayFiltered = useMemo(() => {
    if (!gatewayFilter) return lines;
    const opt = gatewayOptions.find((o) => o.key === gatewayFilter);
    if (!opt) return lines;
    return lines.filter((l) => l.provider === opt.gateway && regionForLine(l) === opt.region);
  }, [lines, gatewayFilter, gatewayOptions]);

  const searched = useMemo(
    () => gatewayFiltered.filter((l) => matchesQuery(l, query)),
    [gatewayFiltered, query],
  );
```

Render the filter pills right above the existing tab row (before the `<div className="mb-4 flex flex-wrap gap-1.5">` tab bar, currently line 98) — only when there's something to filter by, since a founder with no Zoho accounts configured yet shouldn't see an empty, confusing pill row:

```tsx
      {gatewayOptions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setGatewayFilter(null)}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
              gatewayFilter === null
                ? "border-[#1F1B16] bg-[#1F1B16] text-[#FBF8F1]"
                : "border-[#EAE3D6] bg-white text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
            }`}
          >
            All gateways
          </button>
          {gatewayOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setGatewayFilter(gatewayFilter === opt.key ? null : opt.key)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                gatewayFilter === opt.key
                  ? "border-[#1F1B16] bg-[#1F1B16] text-[#FBF8F1]"
                  : "border-[#EAE3D6] bg-white text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open `/reconciliation`, confirm the gateway pill row renders the live Zoho account names (not hardcoded strings) and that clicking one narrows the tab counts below it to matching lines only, and clicking it again (or "All gateways") clears the filter.

- [ ] **Step 8: Commit**

```bash
git add lib/reconciliation/gateway-filter.ts tests/reconciliation/gateway-filter.test.ts components/finance/reconciliation/recon-view.tsx
git commit -m "$(cat <<'EOF'
Add a Zoho-driven gateway filter to the reconciliation view

Filter options are derived from the live Zoho clearing-account list
(the same accounts lib/finance/gateway-account-map.ts posts settlements
against) instead of a hardcoded label list, so the filter never drifts
from what a founder can actually post to. Tabby/Tamara split by region
using the payout's own settlement currency — the same signal
gateway-account-map.ts already uses to pick a region-specific account.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 3: Payout summary bar (Gross / Net / Awaiting / Fees / Refunds / Exchanges)

**Files:**
- Create: `lib/reconciliation/payout-summary.ts`
- Create: `components/finance/reconciliation/payout-summary-bar.tsx`
- Modify: `components/finance/reconciliation/recon-view.tsx`
- Test: `tests/reconciliation/payout-summary.test.ts`

**Interfaces:**
- Produces: `export type PayoutSummaryTotals = { grossAed: number; netAed: number; awaitingAed: number; feesAed: number; refundsAed: number }`, `export function computePayoutSummary(lines: PayoutSummaryLineInput[]): PayoutSummaryTotals` in `lib/reconciliation/payout-summary.ts`. `PayoutSummaryBar` (default export from the new component file) takes `{ lines: ReconLine[] }` and renders the five money tiles plus an async-loaded sixth "Exchanges" tile.
- Consumes: `ReconLine`, `ReconTxn`, `aed2` (already exported from `./types`).

**Design:** Every figure here is derived from data already on `ReconLine` — no new fetch for the first five tiles, so they can never drift from the rows the founder is looking at (same principle `insights-tab.tsx` documents at its own top).
- **Gross Sales** = sum of every `transactions[].grossShare` across every line (the true pre-fee order value, from the per-order breakdown every parser already produces).
- **Net Sales** = sum of `payout.net` across every line that has a payout (what actually got or will get deposited).
- **Awaiting Payments** = sum of `bankAmount` for lines in `AWAITING_PAYOUT` state (same computation `finance-workspace.tsx`'s existing "Awaiting payout file" KPI already uses — reused, not reinvented).
- **Fees** = sum of every `transactions[].feeShare` across every line.
- **Refunds** = sum of `abs(netShare)` for every transaction flagged `isRefund`.
- **Exchanges** is structurally different: bank credits and payout files never carry exchange orders (an exchange has no cash movement), so it cannot be computed from `ReconLine` at all — it lives entirely in the Google-Sheets-derived pathway (`lib/finance/payments-sheet.ts`'s `isExchange` signal, already exposed via the existing `/api/invoices/sheet-exchanges` endpoint). The bar fetches that endpoint once, independently of the other five tiles, so a slow or failed fetch never blocks the numbers that ARE computable locally.

- [ ] **Step 1: Write the failing test**

Create `tests/reconciliation/payout-summary.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePayoutSummary } from "@/lib/reconciliation/payout-summary";

test("computePayoutSummary: sums gross/fees/refunds from transactions, net from payouts, awaiting from bank amount", () => {
  const totals = computePayoutSummary([
    {
      state: "SETTLED", bankAmount: 190,
      payout: { net: 190 },
      transactions: [
        { grossShare: 200, feeShare: 10, netShare: 190, isRefund: false },
      ],
    },
    {
      state: "SETTLED", bankAmount: 45,
      payout: { net: 45 },
      transactions: [
        { grossShare: 50, feeShare: 5, netShare: -45, isRefund: true },
      ],
    },
    {
      state: "AWAITING_PAYOUT", bankAmount: 300,
      payout: null,
      transactions: [],
    },
  ]);

  // hand-computed: gross = 200 + 50 = 250; net = 190 + 45 = 235;
  // fees = 10 + 5 = 15; refunds = |-45| = 45; awaiting = 300
  assert.equal(totals.grossAed, 250);
  assert.equal(totals.netAed, 235);
  assert.equal(totals.feesAed, 15);
  assert.equal(totals.refundsAed, 45);
  assert.equal(totals.awaitingAed, 300);
});

test("computePayoutSummary: empty input is all zeros, not NaN or undefined", () => {
  const totals = computePayoutSummary([]);
  assert.deepEqual(totals, { grossAed: 0, netAed: 0, awaitingAed: 0, feesAed: 0, refundsAed: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL — `lib/reconciliation/payout-summary.ts` doesn't exist yet.

- [ ] **Step 3: Implement `lib/reconciliation/payout-summary.ts`**

```ts
// Payout summary bar totals — Gross/Net/Awaiting/Fees/Refunds, all derived
// from data already on ReconLine so these numbers can never drift from the
// rows a founder is looking at. See payout-summary-bar.tsx for why
// "Exchanges" is NOT computed here (it has no bank-credit/payout data at
// all — it lives in the Google-Sheets pathway).

export type PayoutSummaryLineInput = {
  state: string;
  bankAmount: number;
  payout: { net: number } | null;
  transactions: { grossShare: number; feeShare: number; netShare: number; isRefund: boolean }[];
};

export type PayoutSummaryTotals = {
  grossAed: number;
  netAed: number;
  awaitingAed: number;
  feesAed: number;
  refundsAed: number;
};

export function computePayoutSummary(lines: PayoutSummaryLineInput[]): PayoutSummaryTotals {
  let grossAed = 0, netAed = 0, awaitingAed = 0, feesAed = 0, refundsAed = 0;

  for (const line of lines) {
    if (line.payout) netAed += line.payout.net;
    if (line.state === "AWAITING_PAYOUT") awaitingAed += line.bankAmount;

    for (const t of line.transactions) {
      grossAed += t.grossShare;
      feesAed += t.feeShare;
      if (t.isRefund) refundsAed += Math.abs(t.netShare);
    }
  }

  return {
    grossAed: +grossAed.toFixed(2),
    netAed: +netAed.toFixed(2),
    awaitingAed: +awaitingAed.toFixed(2),
    feesAed: +feesAed.toFixed(2),
    refundsAed: +refundsAed.toFixed(2),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: both tests pass.

- [ ] **Step 5: Build the summary bar component**

Create `components/finance/reconciliation/payout-summary-bar.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Banknote, Clock, Percent, RotateCcw, TrendingUp } from "lucide-react";
import { computePayoutSummary } from "@/lib/reconciliation/payout-summary";
import { aed2, type ReconLine } from "./types";

function Tile({ label, value, icon: Icon, tone, note }: {
  label: string; value: string; icon: React.ElementType; tone: string; note?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11.5px] text-[#8A8175]">
        <Icon size={13} style={{ color: tone }} /> {label}
      </div>
      <div className="mt-1.5 font-serif text-[22px] tabular-nums" style={{ color: tone }}>{value}</div>
      {note && <div className="mt-0.5 text-[11px] text-[#8A8175]">{note}</div>}
    </div>
  );
}

// Exchanges never touch a bank account (no cash movement), so — unlike the
// other five tiles — this figure cannot come from ReconLine at all. It
// lives entirely in the Google-Sheets pathway's own exchange detection
// (lib/finance/payments-sheet.ts's isExchange), already exposed by the
// existing /api/invoices/sheet-exchanges endpoint. Fetched independently so
// a slow/failed call never blocks the five locally-computed tiles.
function useExchangeCount(): { count: number | null; loading: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/invoices/sheet-exchanges")
      .then((r) => r.json())
      .then((d: { exchanges?: unknown[] }) => { if (alive) setCount(d.exchanges?.length ?? 0); })
      .catch(() => { if (alive) setCount(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { count, loading };
}

export function PayoutSummaryBar({ lines }: { lines: ReconLine[] }) {
  const totals = computePayoutSummary(lines);
  const { count: exchangeCount, loading: exchangesLoading } = useExchangeCount();

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Gross Sales" value={aed2(totals.grossAed)} icon={TrendingUp} tone="#2E6B7A" />
      <Tile label="Net Sales" value={aed2(totals.netAed)} icon={Banknote} tone="#4B7A54" />
      <Tile label="Awaiting Payments" value={aed2(totals.awaitingAed)} icon={Clock} tone="#B0742E" />
      <Tile label="Fees" value={aed2(totals.feesAed)} icon={Percent} tone="#8A8175" />
      <Tile label="Refunds" value={aed2(totals.refundsAed)} icon={RotateCcw} tone="#A6472F" />
      <Tile
        label="Exchanges"
        value={exchangesLoading ? "…" : exchangeCount == null ? "—" : String(exchangeCount)}
        note={exchangeCount == null && !exchangesLoading ? "couldn't load" : undefined}
        icon={ArrowLeftRight} tone="#6F5325"
      />
    </div>
  );
}
```

- [ ] **Step 6: Wire it into `recon-view.tsx`**

In `components/finance/reconciliation/recon-view.tsx`, add the import:

```ts
import { PayoutSummaryBar } from "./payout-summary-bar";
```

Render it right above the `<ReconFilters …/>` call (currently line 91), passing the gateway-filtered-but-not-yet-search-filtered lines so the bar reflects the active gateway pill (consistent with the tab counts) but not a transient text search:

```tsx
      <PayoutSummaryBar lines={gatewayFiltered} />

      <ReconFilters
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open `/reconciliation`, confirm all six tiles render, the first five update immediately when a gateway pill (Task 2) is toggled, and the Exchanges tile shows a number (or "couldn't load" if `/api/invoices/sheet-exchanges` errors, never a crash).

- [ ] **Step 9: Commit**

```bash
git add lib/reconciliation/payout-summary.ts components/finance/reconciliation/payout-summary-bar.tsx tests/reconciliation/payout-summary.test.ts components/finance/reconciliation/recon-view.tsx
git commit -m "$(cat <<'EOF'
Add Gross/Net/Awaiting/Fees/Refunds/Exchanges summary bar to reconciliation

The first five figures are pure functions over data already on ReconLine
(same principle insights-tab.tsx already follows) so they can never drift
from the rows below them. Exchanges is fetched separately from the
existing Google-Sheets exchange-detection endpoint, since an exchange has
no bank credit or payout file to derive it from.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 4: Move reconciliation data onto React Query + wire up TanStack Table state

**Files:**
- Create: `lib/hooks/use-reconciliation-query.ts`
- Modify: `components/finance/finance-workspace.tsx:44` (one-line import swap)
- Modify: `components/finance/reconciliation/recon-view.tsx` (sorting state via `@tanstack/react-table`)
- Test: none (data-fetching hook + table state wiring — no pure money math introduced; verified manually per Global Constraints)

**Interfaces:**
- Produces: `export function useReconciliation(enabled: boolean)` in `lib/hooks/use-reconciliation-query.ts` — **same name, same parameter, same return shape** (`{ recon, loading, syncing, dashVersion, fromDate, toDate, onRange, refresh, sync, onConfirm }`) as the existing `lib/hooks/use-reconciliation.ts`, so `finance-workspace.tsx` needs only its import path changed, nothing else.
- Consumes: `QueryClientProvider` (already mounted — confirmed via `components/providers/query-provider.tsx`, already wrapping the app), `ReconPayload` (already defined in `components/finance/reconciliation/types.ts`).

**Scope boundary (see Global Constraints/Architecture):** This task replaces the *data layer* (manual `fetch` + `setInterval` → React Query's `useQuery`/`useMutation`, which gets caching, dedup, and background refetch for free) and gives `recon-view.tsx` a `@tanstack/react-table` instance driving sort state over the flat line list. It does **not** rebuild `ReconRow`'s card-based layout into table cells — that visual work belongs to the separate PowerBI-style redesign pass the founder already agreed to defer.

- [ ] **Step 1: Write the new hook**

Create `lib/hooks/use-reconciliation-query.ts`:

```ts
"use client";

/* Same public contract as lib/hooks/use-reconciliation.ts (the hook it
   replaces) — { recon, loading, syncing, dashVersion, fromDate, toDate,
   onRange, refresh, sync, onConfirm } — so finance-workspace.tsx needs only
   its import changed. Internals move from manual fetch+setInterval onto
   React Query: useQuery dedupes/caches by [fromDate, toDate] and keeps the
   existing 60s poll via refetchInterval; useMutation replaces the ad-hoc
   confirm/sync fetch calls with real pending/error state React Query
   already tracks. /api/reconcile is DB-only (no Zoho calls) — safe to poll
   the same as before. */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReconPayload } from "@/components/finance/reconciliation/types";

async function fetchRecon(fromDate: string, toDate: string): Promise<ReconPayload> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from", fromDate);
  if (toDate) params.set("to", toDate);
  const qs = params.toString();
  const r = await fetch(`/api/reconcile${qs ? `?${qs}` : ""}`).then((x) => x.json());
  if (r.error) throw new Error(r.error);
  return r as ReconPayload;
}

export function useReconciliation(enabled: boolean) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const queryClient = useQueryClient();

  const reconQuery = useQuery({
    queryKey: ["reconcile", fromDate, toDate],
    queryFn: () => fetchRecon(fromDate, toDate),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["reconcile", fromDate, toDate] });
  }, [queryClient, fromDate, toDate]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sync", { method: "POST", body: JSON.stringify({}) });
      return res.json();
    },
    onSuccess: async (json: { results?: { store: string; fetched?: number; error?: string }[] }) => {
      for (const r of json.results ?? []) {
        if (r.error) toast.error(`${r.store}: ${r.error}`);
        else toast.success(`${r.store}: ${r.fetched} orders synced`);
      }
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async (bankLineId: string) => {
      const res = await fetch("/api/reconcile/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId, actor: "founder" }),
      });
      if (!res.ok) throw new Error("Confirm failed");
    },
    onSuccess: async () => { toast.success("Settlement confirmed"); await refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onRange = useCallback((f: string, t: string) => {
    setFromDate(f);
    setToDate(t);
  }, []);

  return {
    recon: reconQuery.data ?? null,
    loading: reconQuery.isLoading,
    syncing: syncMutation.isPending,
    // dashVersion existed to force-remount version-keyed children on every
    // refresh (e.g. FounderDashboard) — React Query's own queryKey already
    // does that for anything reading `recon` reactively, but a couple of
    // call sites pass this as a literal remount key, so it's kept, driven by
    // the query's own fetch count instead of a separately-tracked counter.
    dashVersion: reconQuery.dataUpdatedAt,
    fromDate,
    toDate,
    onRange,
    refresh,
    sync: () => syncMutation.mutate(),
    onConfirm: (id: string) => confirmMutation.mutate(id),
  };
}
```

- [ ] **Step 2: Swap the import in `finance-workspace.tsx`**

In `components/finance/finance-workspace.tsx`, change (currently line 44):

```ts
import { useReconciliation } from "@/lib/hooks/use-reconciliation";
```

to:

```ts
import { useReconciliation } from "@/lib/hooks/use-reconciliation-query";
```

`dashVersion` is used elsewhere in the same file as a `version={dashVersion}` prop to `FounderDashboard` and `DocumentsPanel` (lines 650, 652) purely to force a remount on refresh — a `number` (timestamp) satisfies that the same way the old incrementing counter did, so no further change is needed there.

- [ ] **Step 3: Delete the old hook**

The old `lib/hooks/use-reconciliation.ts` has no other importers (verified: `grep -rl "from \"@/lib/hooks/use-reconciliation\"" --include="*.tsx" --include="*.ts" .` — only `finance-workspace.tsx`, just changed above). Delete it:

```bash
rm lib/hooks/use-reconciliation.ts
```

- [ ] **Step 4: Add TanStack Table sort state to `recon-view.tsx`**

In `components/finance/reconciliation/recon-view.tsx`, add the import:

```ts
import { getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
```

This code depends on `visible` (currently `const visible: ReconLine[] = buckets[tab];`, the last of the existing derivations before `groups`) — add it **right after that line**, replacing the existing `groups` line that follows it (`const groups = useMemo(() => groupLines(visible, groupMode), [visible, groupMode]);`). Referencing `visible` any earlier in the component is a ReferenceError:

```ts
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  const columns = useMemo<ColumnDef<ReconLine>[]>(() => [
    { id: "date", accessorFn: (r) => r.date ?? "" },
    { id: "bankAmount", accessorFn: (r) => r.bankAmount },
    { id: "provider", accessorFn: (r) => r.provider },
  ], []);
  const table = useReactTable({
    data: visible,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  // Sorting only reorders the flat ("All credits") view — grouped modes
  // (by gateway/state/day) already impose their own order via groupLines,
  // and re-sorting within each group is a separate, later decision.
  const sortedVisible = groupMode === "none" ? table.getRowModel().rows.map((r) => r.original) : visible;
  const groups = useMemo(() => groupLines(sortedVisible, groupMode), [sortedVisible, groupMode]);
```

Add a small sort control next to the existing gateway-pill row (from Task 2) — three buttons is enough surface for this phase (date, amount, provider), each toggling asc/desc on click:

```tsx
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[#8A8175]">
        <span className="mr-1">Sort:</span>
        {(["date", "bankAmount", "provider"] as const).map((col) => {
          const active = sorting[0]?.id === col;
          return (
            <button
              key={col}
              onClick={() => setSorting([{ id: col, desc: active ? !sorting[0].desc : true }])}
              className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                active ? "border-[#B08343] bg-[#FBF3E6] text-[#6F5325]" : "border-[#EAE3D6] bg-white hover:border-[#D6CCBA]"
              }`}
            >
              {col === "bankAmount" ? "Amount" : col === "provider" ? "Gateway" : "Date"}
              {active && (sorting[0].desc ? " ↓" : " ↑")}
            </button>
          );
        })}
      </div>
```

Place this block directly below the gateway-pill row from Task 2 and above the existing tab-button row.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open `/reconciliation`, confirm: (a) the line list still loads and the 60s poll still works (watch the network tab — one `/api/reconcile` request per range change, refetching every 60s); (b) clicking a tab/gateway pill/sort button no longer causes a full-page refetch flash (React Query serves from cache); (c) the "Sort" buttons reorder rows within the ungrouped ("All credits" grouping = "none") view; (d) confirming a settlement and clicking "Sync stores" both still work and show the same toasts as before.

- [ ] **Step 7: Commit**

```bash
git add lib/hooks/use-reconciliation-query.ts components/finance/finance-workspace.tsx components/finance/reconciliation/recon-view.tsx
git rm lib/hooks/use-reconciliation.ts
git commit -m "$(cat <<'EOF'
Move reconciliation data onto React Query, add TanStack Table sort state

Same public hook contract as before (finance-workspace.tsx needed only its
import path changed) — internals now use useQuery/useMutation instead of
manual fetch+setInterval, so requests dedupe/cache by date range and
confirm/sync get real pending state instead of ad-hoc booleans. recon-view
now runs a @tanstack/react-table instance for sort state (date/amount/
gateway) over the ungrouped line list; the row layout itself (ReconRow) is
unchanged — that's the separate visual-redesign pass.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 5: Delete a wrongly-uploaded payout

**Files:**
- Modify: `lib/repositories/payouts.repository.ts` (add `deletePayout`)
- Create: `app/api/payouts/[id]/route.ts`
- Modify: `components/finance/reconciliation/recon-row.tsx`
- Test: `tests/repositories/payouts-delete.test.ts`

**Interfaces:**
- Produces: `PayoutsRepository.deletePayout(id: string): Promise<void>` in `lib/repositories/payouts.repository.ts`. `DELETE /api/payouts/:id` in the new route, returning `{ ok: true }` or `{ error }`.
- Consumes: `supabase` client (already imported in `payouts.repository.ts`).

**Guardrail (see Global Constraints):** a founder-confirmed settlement (`ReconLine.confirmedBy` set) may already be posted to Zoho — deleting its payout data would desync the books with no trace. The UI only offers this button when `!r.confirmedBy`, and the API independently checks `recon_lines.confirmed_by` for that bank line before deleting, so a stale UI state can't bypass it.

- [ ] **Step 1: Write the failing test**

Create `tests/repositories/payouts-delete.test.ts` — this repository method is a thin Supabase wrapper with no pure math, so the test exercises its *shape* (it deletes `payout_transactions` before `payouts`, both scoped to the given id) against a fake client, matching the style of other repository-adjacent tests in this repo rather than hitting a live database:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal fake mirroring the two .from(...).delete().eq(...) calls
// PayoutsRepository.deletePayout makes — proves call order (transactions
// before the parent row) and that both are scoped to the right id, without
// needing a live Supabase instance.
function fakeSupabase() {
  const calls: { table: string; id: string }[] = [];
  return {
    calls,
    from(table: string) {
      return {
        delete() {
          return {
            eq(_col: string, id: string) {
              calls.push({ table, id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test("deletePayout: deletes payout_transactions before the payouts row, both scoped to the id", async () => {
  const fake = fakeSupabase();
  const { makeDeletePayout } = await import("@/lib/repositories/payouts.repository");
  const deletePayout = makeDeletePayout(fake as any);

  await deletePayout("TELR-123");

  assert.deepEqual(fake.calls, [
    { table: "payout_transactions", id: "TELR-123" },
    { table: "payouts", id: "TELR-123" },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL — `makeDeletePayout` is not exported yet.

- [ ] **Step 3: Implement `deletePayout`**

In `lib/repositories/payouts.repository.ts`, add near the top (after the existing `supabase` import, so it's usable by both the exported factory and the default-wired `PayoutsRepository` below):

```ts
// Factory (not just a plain method) so the delete-order contract — 
// payout_transactions before payouts, both scoped to id — is testable
// against a fake client without a live database. PayoutsRepository.
// deletePayout below is this, wired to the real supabase client.
export function makeDeletePayout(client: typeof supabase) {
  return async function deletePayout(id: string): Promise<void> {
    const { error: txErr } = await client.from("payout_transactions").delete().eq("payout_id", id);
    if (txErr) throw new Error(`payout_transactions delete failed: ${txErr.message}`);
    const { error } = await client.from("payouts").delete().eq("id", id);
    if (error) throw new Error(`payouts delete failed: ${error.message}`);
  };
}
```

Then add to the `PayoutsRepository` object (after `upsertPayouts`, before `listWithRefs`):

```ts
  deletePayout: makeDeletePayout(supabase),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: passes.

- [ ] **Step 5: Add the DELETE route with the confirmed-settlement guard**

Create `app/api/payouts/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

// DELETE /api/payouts/:id — undoes a wrongly-uploaded payout file (removes
// the payouts row + its payout_transactions, so the bank credit reverts to
// AWAITING_PAYOUT and can be re-uploaded correctly). Refuses if any
// recon_lines row referencing this payout has already been founder-
// confirmed — that settlement may already be posted to Zoho, and deleting
// its payout data out from under it would desync the books with no trace.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: confirmedLines, error: checkErr } = await supabase
    .from("recon_lines")
    .select("bank_line_id")
    .eq("payout_id", id)
    .not("confirmed_by", "is", null);
  if (checkErr) {
    return NextResponse.json({ error: `Could not verify settlement status: ${checkErr.message}` }, { status: 500 });
  }
  if ((confirmedLines ?? []).length > 0) {
    return NextResponse.json(
      { error: "This payout backs a founder-confirmed settlement and can't be deleted. Unconfirm it first if it was confirmed by mistake." },
      { status: 409 },
    );
  }

  try {
    await PayoutsRepository.deletePayout(id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Add the delete button in `recon-row.tsx`**

In `components/finance/reconciliation/recon-row.tsx`, add imports (alongside the existing `lucide-react` import list at the top):

```ts
import { Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
```

Add state near the existing `flagging`/`flagged` state (after line 94):

```ts
  const [deleting, setDeleting] = useState(false);
```

Add the delete handler, near `toggleFlag` (after it, before `copyRef`):

```ts
  const deletePayout = async () => {
    if (!r.payout) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(r.payout.id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      toast.success(`Payout ${r.payout.id} deleted — credit reverted to Awaiting payout`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };
```

Add the button in the action bar (after the existing "Payout file" download `<a>`, currently lines 319-326, before `<ActionButton icon={Copy} …>`) — only rendered when there's a payout to delete and it isn't already founder-confirmed, matching the API-side guard exactly:

```tsx
            {r.payout && !r.confirmedBy && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[12.5px] font-medium text-[#A6472F] transition-colors hover:border-[#A6472F] hover:bg-[#F9ECE7] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete payout
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this payout?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes {r.payout.id} and its per-order breakdown. The bank credit reverts to
                      &quot;Awaiting payout&quot; so you can re-upload the correct file. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deletePayout} className="bg-[#A6472F] hover:bg-[#8E3A25]">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open `/reconciliation`, expand a line with an uploaded (not founder-confirmed) payout, click "Delete payout", confirm in the dialog, verify: the row reverts to "Awaiting payout" after `refresh()`, and re-uploading the same file re-creates it correctly. Then expand a line whose settlement IS founder-confirmed and verify no "Delete payout" button appears at all.

- [ ] **Step 9: Commit**

```bash
git add lib/repositories/payouts.repository.ts app/api/payouts/[id]/route.ts components/finance/reconciliation/recon-row.tsx tests/repositories/payouts-delete.test.ts
git commit -m "$(cat <<'EOF'
Add delete capability for a wrongly-uploaded payout

DELETE /api/payouts/:id removes the payouts row and its payout_transactions
so a bank credit reverts to Awaiting payout and can be re-uploaded. Refuses
(409) when any recon_lines row for that payout is already founder-
confirmed, since that settlement may already be posted to Zoho — the UI
only shows the button in the same condition, so a stale client can't
bypass the server-side check.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

## Out of scope for this plan (Phase 2, separate pass)

- PowerBI-style visual redesign of the uploader/table surface.
- Google Sheets sync for this (upload-file) reconciliation pathway, matching the column schema the founder pasted (S.No, Date, Order #, Total Amt, Currency, In AED, Party, Exc Rate, Payment Received Date, Total Amt from Gateway, Fee Deducted, Amount After Deduction, Cancelled/Refunded Amount, Fee%, sales person, Refund Date).
- The live Stripe balance-transaction proof bug (gross/fee showing 0 with a near-constant net across many orders) — needs a live reproduction (a specific bank-line id or Stripe payout id) before it can be fixed without guessing; see Global Constraints.
- A genuinely failing Telr file, if one turns up after this ships — the one sample available (`payout_5467548 (3).xls`) parses correctly today (verified by running `parseTelrXls` against it directly: net/gross/fees foot exactly, all 14 order refs resolve).
