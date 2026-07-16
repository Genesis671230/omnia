# Reconciliation Gateway Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make COD (On Track Delivery) and Checkout.com bank credits resolvable end-to-end, give Tabby/Tamara payouts the same per-order traceability Stripe already has, and fix the reconciliation UI so the "waiting on you" state is visually distinct instead of the flattest color in the palette.

**Architecture:** Additive parser functions in `lib/parsers/payouts.ts` (one per new gateway, same `ParsedPayout` contract every existing parser uses), a behavior-preserving extraction of the pure matching logic out of `lib/reconciliation/engine.ts` so it can be tested without a live database, and a scoped CSS/copy change in `components/finance/finance-workspace.tsx`. No schema changes — `COD` and `Checkout` are already valid `Gateway` values in `lib/gateways.ts`.

**Tech Stack:** TypeScript, Next.js, `xlsx` package (already a dependency) for spreadsheet fixtures/parsing, Node's built-in test runner (`node:test` + `node:assert/strict`) run via `tsx` (already a devDependency — no new dependencies added).

## Global Constraints

- **No guesswork in monetary math** (founder, verbatim: "fully tested to the fill calculation is done no guesswork, real math"). Every parser change gets a fixture test asserting an **exact**, hand-computed total via `.toFixed(2)` — never an approximate/snapshot assertion.
- Checkout and COD are AED-native in this design (Checkout's `Holding Currency Amount` is already AED; COD cash collections are already AED) — their `ParsedPayout` output must never set `originalCurrency`/`netOriginal`. A test in Task 4 and Task 3 asserts this explicitly, per the spec's anti-regression requirement.
- Follow existing file conventions exactly: XLSX parsers scan for a header row within the first N rows (Telr/Tabby/Tamara pattern); CSV parsers via `toRecords(parseCsv(text))` assume row 0 is the header (Stripe/generic pattern). Do not invent a third convention.
- `tsx --test` resolves this repo's `@/*` → `./*` tsconfig path alias correctly (verified empirically before writing this plan) — test files use `@/lib/...` imports, matching the rest of the codebase, not relative paths.
- Run `tsx --test 'tests/**/*.test.ts'` (glob quoted, not shell-expanded) — verified working; an unquoted glob or a bare directory path (`tsx --test tests/`) does NOT recursively discover files with this tsx version and must not be used.

---

### Task 1: Test runner + bank narration invoice-reference fallback

**Files:**
- Modify: `package.json` (add `test` script)
- Modify: `lib/parsers/bank.ts:39, 156, 211, 260` (reference extraction)
- Test: `tests/parsers/bank.test.ts`

**Interfaces:**
- Produces: `extractReference(text: string): string` in `lib/parsers/bank.ts` — used internally by all three statement-format parsers in that file. Not exported (internal helper), but the three call sites it replaces are: the CSV path's `reference` fallback, `parseMergedText`'s `reference`, and `parseLineOriented`'s `reference`.

- [ ] **Step 1: Add the `test` script**

Edit `package.json`, inside `"scripts"`:

```json
  "scripts": {
    "build": "next build",
    "dev": "next dev",
    "lint": "eslint .",
    "start": "next start",
    "test": "tsx --test 'tests/**/*.test.ts'"
  },
```

- [ ] **Step 2: Write the failing test**

Create `tests/parsers/bank.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBankStatement } from "@/lib/parsers/bank";

test("bank parser: On Track Delivery COD credit is classified and carries an INV reference", () => {
  const csv = [
    "Date,Description,Credit,Debit",
    "11/07/2026,\"KWD Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES/AL MARARR 2- 102 PLOT NO 198-0 OFFI/CE 102-448 Dubai UAE//REF/invoice 16964/FT26192VXFKW FT26192VXFKW\",2462.00,",
  ].join("\n");

  const { credits } = parseBankStatement(csv, "statement.csv");

  assert.equal(credits.length, 1);
  const c = credits[0];
  assert.equal(c.provider, "COD");
  assert.equal(c.confidence, "keyword");
  assert.equal(c.amount, 2462);
  // FT... wire code is present too, but the invoice number is what a founder
  // recognizes — REF_RE should still win when both are present (unchanged
  // behavior), so this fixture pins today's precedence explicitly.
  assert.equal(c.reference, "FT26192VXFKW");
});

test("bank parser: falls back to INVOICE number when no FT/DSZ/INSTQ wire code is present", () => {
  const csv = [
    "Date,Description,Credit,Debit",
    "11/07/2026,\"Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES//REF/invoice 16964\",2462.00,",
  ].join("\n");

  const { credits } = parseBankStatement(csv, "statement.csv");

  assert.equal(credits.length, 1);
  assert.equal(credits[0].reference, "INV16964");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: the first test passes already (FT-code path is unchanged behavior), the second test FAILs with `credits[0].reference` equal to `""` (empty string) instead of `"INV16964"`, because no `INVOICE` fallback exists yet.

- [ ] **Step 4: Implement the fallback**

In `lib/parsers/bank.ts`, after the existing `REF_RE` definition (line 39), add:

```ts
const INVOICE_RE = /\bINVOICE\s*#?\s*(\d{3,})\b/i;

// REF_RE (a bank wire code) wins when both are present — it's the bank's own
// transaction id. INVOICE_RE is a fallback for narrations (COD/courier
// remittances) that carry a human-legible invoice number but no wire code,
// so the reconciliation UI shows something a founder recognizes instead of
// an opaque row id.
function extractReference(text: string): string {
  const wire = REF_RE.exec(text)?.[1];
  if (wire) return wire;
  const inv = INVOICE_RE.exec(text)?.[1];
  return inv ? `INV${inv}` : "";
}
```

Then replace the three call sites:

In `tryParseCsvStatement` (around line 154-156), change:
```ts
    const reference =
      refCell.replace(/['"\s]/g, "").replace(/\\HCP$/i, "") ||
      (REF_RE.exec(narration)?.[1] ?? "");
```
to:
```ts
    const reference =
      refCell.replace(/['"\s]/g, "").replace(/\\HCP$/i, "") ||
      extractReference(narration);
```

In `parseMergedText` (around line 211), change:
```ts
    const reference = REF_RE.exec(seg.slice(0, last.index))?.[1] ?? "";
```
to:
```ts
    const reference = extractReference(seg.slice(0, last.index));
```

In `parseLineOriented` (around line 260), change:
```ts
      reference: REF_RE.exec(block)?.[1] ?? "",
```
to:
```ts
      reference: extractReference(block),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 2`, `pass 2`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json lib/parsers/bank.ts tests/parsers/bank.test.ts
git commit -m "$(cat <<'EOF'
Add test runner + invoice-number fallback for bank credit references

COD/courier remittance narrations carry a human-legible invoice number but
no FT/DSZ/INSTQ wire code, so they showed an opaque row-id fragment in the
reconciliation UI instead of anything recognizable.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extract pure `computeReconLines` from `runReconciliation`

**Files:**
- Modify: `lib/reconciliation/engine.ts:110-232`
- Test: `tests/reconciliation/engine.test.ts`

**Interfaces:**
- Consumes: `PayoutWithRefs` (already defined at `lib/reconciliation/engine.ts:85`), `ReconLine`/`ReconState`/`QualityIssue` (already defined at top of same file), `expectedNetFor`/`refCandidates`/`TOLERANCE_AED` (already defined in same file, unchanged).
- Produces: `export type BankCreditInput`, `export type ComputeReconOrderInput`, `export type ComputeReconInputs`, `export function computeReconLines(inputs: ComputeReconInputs): ReconLine[]` — all in `lib/reconciliation/engine.ts`. Task 7's engine-level fixture tests call `computeReconLines` directly (no database).

This is a **behavior-preserving refactor**: `runReconciliation()` must produce byte-identical output to today for the same inputs. The only reason to do it is that `runReconciliation()` currently imports `@/lib/supabase` at module load and hits a live database — it cannot be unit tested without one. Splitting out the pure matching logic makes Task 7's "no guesswork" fixture tests possible.

- [ ] **Step 1: Write the failing test**

Create `tests/reconciliation/engine.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";

test("computeReconLines: exact-amount match settles the order", () => {
  const lines = computeReconLines({
    credits: [{
      id: "C001", statement_date: "2026-07-11", description: "TEST NARRATION",
      reference: "INV1001", amount: 100, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: "COD-1001", gateway: "COD", net_amount: 100, gross_amount: 100, fee_amount: 0,
      source: "test.csv", status: "uploaded", order_refs: ["5001"],
      original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5001" }],
    confirmations: new Map(),
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].state, "SETTLED");
  assert.equal(lines[0].variance, 0);
  assert.deepEqual(lines[0].resolvedOrders, ["5001"]);
});

test("computeReconLines: amount mismatch beyond tolerance is PAYOUT_VARIANCE, not silently accepted", () => {
  const lines = computeReconLines({
    credits: [{
      id: "C002", statement_date: "2026-07-11", description: "TEST NARRATION",
      reference: "INV1002", amount: 100, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: "COD-1002", gateway: "COD", net_amount: 90, gross_amount: 90, fee_amount: 0,
      source: "test.csv", status: "uploaded", order_refs: ["5002"],
      original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5002" }],
    confirmations: new Map(),
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].state, "PAYOUT_VARIANCE");
  assert.equal(lines[0].variance, 10);
});

test("computeReconLines: no matching payout leaves the credit AWAITING_PAYOUT", () => {
  const lines = computeReconLines({
    credits: [{
      id: "C003", statement_date: "2026-07-11", description: "TEST NARRATION",
      reference: "INV1003", amount: 100, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [],
    orders: [],
    confirmations: new Map(),
  });

  assert.equal(lines[0].state, "AWAITING_PAYOUT");
  assert.equal(lines[0].payout, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL — `computeReconLines is not a function` (or a TS type error on import), since it doesn't exist yet.

- [ ] **Step 3: Extract the pure function**

In `lib/reconciliation/engine.ts`, replace the existing `export async function runReconciliation()` (currently lines 110-232) with:

```ts
export type BankCreditInput = {
  id: string;
  statement_date: string | null;
  description: string;
  reference: string;
  amount: number;
  gateway_guess: string | null;
  confidence: string | null;
};

export type ComputeReconOrderInput = { order_number: string };

export type ComputeReconInputs = {
  credits: BankCreditInput[];
  payouts: PayoutWithRefs[];
  orders: ComputeReconOrderInput[];
  confirmations: Map<string, { by: string; at: string }>;
};

// Pure: bank → payout → orders matching, no I/O. Split out of
// runReconciliation() so it can be fixture-tested without a live database —
// see tests/reconciliation/engine.test.ts.
export function computeReconLines(inputs: ComputeReconInputs): ReconLine[] {
  const { credits, payouts, orders, confirmations } = inputs;
  const orderNumbers = new Set(orders.map((o) => o.order_number));
  const claimedPayouts = new Set<string>();
  const lines: ReconLine[] = [];

  for (const credit of credits) {
    const provider = credit.gateway_guess || "Unclassified";

    const payout = payouts.find(
      (p) =>
        !claimedPayouts.has(p.id) &&
        p.gateway === provider &&
        Math.abs(expectedNetFor(p, credit).net - credit.amount) <=
          Math.max(TOLERANCE_AED, credit.amount * 0.02),
    );

    const confirmation = confirmations.get(credit.id);
    const base = {
      id: credit.id,
      date: credit.statement_date,
      narration: credit.description,
      reference: credit.reference,
      provider,
      confidence: credit.confidence || "unknown",
      bankAmount: Number(credit.amount),
      confirmedBy: confirmation?.by ?? null,
      confirmedAt: confirmation?.at ?? null,
    };

    if (!payout) {
      lines.push({
        ...base,
        payout: null,
        variance: 0,
        resolvedOrders: [],
        unresolvedRefs: [],
        refundedOrders: [],
        qualityIssues: [],
        state: "AWAITING_PAYOUT",
      });
      continue;
    }

    claimedPayouts.add(payout.id);
    const expected = expectedNetFor(payout, credit);
    const variance = +(Number(credit.amount) - expected.net).toFixed(2);

    const txByRef = new Map(payout.transactions.map((t) => [t.order_ref, t]));

    const resolvedOrders: string[] = [];
    const unresolvedRefs: string[] = [];
    const refundedOrders: string[] = [];
    const qualityIssues: QualityIssue[] = [];
    for (const ref of payout.order_refs) {
      const hit = refCandidates(ref).find((c) => orderNumbers.has(c));
      const tx = txByRef.get(ref);
      const isRefund = tx?.is_refund ?? false;

      if (isRefund) {
        if (hit) refundedOrders.push(hit);
        else qualityIssues.push({ ref, quality: "refund_unmatched" });
      } else if (hit) {
        resolvedOrders.push(hit);
      } else {
        unresolvedRefs.push(ref);
      }

      if (tx?.quality && tx.quality !== "clean" && tx.quality !== "refund") {
        qualityIssues.push({ ref, quality: tx.quality });
      }
    }

    let state: ReconState;
    if (Math.abs(variance) > TOLERANCE_AED) state = "PAYOUT_VARIANCE";
    else if (unresolvedRefs.length > 0) state = "ORDERS_UNRESOLVED";
    else if (resolvedOrders.length > 0) state = "SETTLED";
    else state = "ORDERS_UNRESOLVED";

    lines.push({
      ...base,
      payout: {
        id: payout.id, net: expected.net, source: payout.source,
        currency: expected.currency, fxRate: expected.fxRate, fxSource: expected.fxSource,
      },
      variance,
      resolvedOrders,
      unresolvedRefs,
      refundedOrders,
      qualityIssues,
      state,
    });
  }

  return lines;
}

export async function runReconciliation(): Promise<ReconLine[]> {
  const [credits, payouts, orders] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
    OrdersRepository.listAll(),
  ]);

  const { data: existing } = await supabase
    .from("recon_lines")
    .select("bank_line_id, confirmed_by, confirmed_at");
  const confirmations = new Map(
    (existing ?? [])
      .filter((r) => r.confirmed_by)
      .map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]),
  );

  const lines = computeReconLines({ credits, payouts, orders, confirmations });
  await persistResults(lines, orders);
  return lines;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 5` (2 from Task 1 + 3 new), `pass 5`, `fail 0`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (This also verifies `runReconciliation()`'s call to `computeReconLines` type-checks against the real `BankRepository.listCredits()` / `OrdersRepository.listAll()` return shapes, even though those are structurally wider than `BankCreditInput`/`ComputeReconOrderInput`.)

- [ ] **Step 6: Commit**

```bash
git add lib/reconciliation/engine.ts tests/reconciliation/engine.test.ts
git commit -m "$(cat <<'EOF'
Extract pure computeReconLines from runReconciliation

Behavior-preserving split: the bank-to-payout-to-order matching logic had
no way to be tested without a live Supabase instance. Pulling it out as a
pure function (same inputs/outputs, zero I/O) makes the "real math, no
guesswork" fixture tests in the following tasks possible.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: COD (On Track Delivery) payout parser

**Files:**
- Modify: `lib/parsers/payouts.ts` (add near the end, after `parseGenericPayoutCsv`)
- Test: `tests/parsers/payouts-cod.test.ts`

**Interfaces:**
- Produces: `export function parseCodCsv(text: string, filename: string): ParsedPayout[]`, `export function parseCodXlsx(buf: Buffer | ArrayBuffer, filename: string): ParsedPayout[]` in `lib/parsers/payouts.ts`. Task 6 wires both into `parsePayoutFile`'s detection.
- Consumes: `ParsedPayout` type, `parseCsv`/`toRecords` from `@/lib/parsers/csv`, the module-local `sheetRows` helper (already defined in `lib/parsers/payouts.ts`, used by Tabby/Tamara).

- [ ] **Step 1: Write the failing tests**

Create `tests/parsers/payouts-cod.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseCodCsv, parseCodXlsx } from "@/lib/parsers/payouts";

function xlsxBuffer(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("parseCodCsv: sums COD Amount column exactly and extracts order refs", () => {
  const csv = [
    "Invoice No,Order Number,COD Amount",
    "16964,5001,1230.50",
    "16964,5002,1231.50",
  ].join("\n");

  const [payout] = parseCodCsv(csv, "on-track-delivery.csv");

  assert.equal(payout.provider, "COD");
  assert.equal(payout.id, "COD-16964");
  assert.equal(payout.net, 2462.00); // hand-computed: 1230.50 + 1231.50
  assert.deepEqual(payout.orderRefs, ["5001", "5002"]);
  // AED-native by design — must never guess an FX rate for COD cash.
  assert.equal(payout.originalCurrency, undefined);
  assert.equal(payout.netOriginal, undefined);
});

test("parseCodXlsx: finds the header row after a banner, extracts invoice number from the banner text", () => {
  const buf = xlsxBuffer([
    ["ON TRACK DELIVERY SERVICES — INVOICE #16964"],
    [""],
    ["Order No.", "Amount Collected"],
    ["5001", "1230.50"],
    ["5002", "1231.50"],
  ]);

  const [payout] = parseCodXlsx(buf, "remittance.xlsx");

  assert.equal(payout.id, "COD-16964");
  assert.equal(payout.net, 2462.00);
  assert.deepEqual(payout.orderRefs, ["5001", "5002"]);
});

test("parseCodXlsx: falls back to the filename for the invoice number when no banner or column has one", () => {
  const buf = xlsxBuffer([
    ["Order No.", "Net Amount"],
    ["5001", "500"],
  ]);

  const [payout] = parseCodXlsx(buf, "cod-statement-16999.xlsx");

  assert.equal(payout.id, "COD-16999");
  assert.equal(payout.net, 500);
});

test("parseCodCsv: throws with the seen columns when no amount column is found", () => {
  const csv = ["Order Number,Notes", "5001,foo"].join("\n");
  assert.throws(
    () => parseCodCsv(csv, "bad.csv"),
    /no amount column found in \[order number, notes\]/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL — `parseCodCsv`/`parseCodXlsx` are not exported yet.

- [ ] **Step 3: Implement the parser**

In `lib/parsers/payouts.ts`, add after the existing `parseGenericPayoutCsv` function (after line 236):

```ts
// ── COD (On Track Delivery courier remittance): CSV or XLSX ──────────────
// Column names vary by courier — kept generous on purpose, same spirit as
// parseGenericPayoutCsv, but tuned to COD-specific vocabulary and able to
// recover the invoice number from a banner row (couriers print "INVOICE
// #16964" above the table, not in a clean column) or from the filename —
// matching the bank narration's own "invoice 16964" reference so the two
// sides can be matched by a founder at a glance.
const COD_INVOICE_COL_RE = /^invoice\s*(no\.?|number|#)?$/i;
const COD_INVOICE_BANNER_RE = /INVOICE\s*#?\s*(\d{3,})/i;
const COD_REF_COL_RE = /^(order|order\s*no\.?|order\s*number|order\s*id|awb|awb\s*no\.?|tracking|tracking\s*no\.?|reference)$/i;
const COD_AMOUNT_COL_RE = /^(cod\s*amount|amount\s*collected|collection\s*amount|net\s*amount|net|amount)$/i;

function codInvoiceNumber(rawText: string, filename: string): string {
  const banner = COD_INVOICE_BANNER_RE.exec(rawText)?.[1];
  if (banner) return banner;
  const fname = /(\d{3,})/.exec(filename)?.[1];
  return fname ?? "UNKNOWN";
}

function parseCodRecords(records: Record<string, string>[], rawText: string, filename: string): ParsedPayout[] {
  if (records.length === 0) throw new Error("Empty COD file");
  const cols = Object.keys(records[0]);
  const cInvoice = cols.find((c) => COD_INVOICE_COL_RE.test(c.trim()));
  const cRef = cols.find((c) => COD_REF_COL_RE.test(c.trim()));
  const cAmount = cols.find((c) => COD_AMOUNT_COL_RE.test(c.trim()));
  if (!cAmount) throw new Error(`COD file: no amount column found in [${cols.join(", ")}]`);

  let net = 0;
  const orderRefs: string[] = [];
  let invoiceFromColumn = "";
  for (const row of records) {
    const n = parseFloat((row[cAmount] || "0").replace(/,/g, ""));
    if (!Number.isNaN(n)) net += n;
    if (cRef && row[cRef]) {
      const ref = row[cRef].replace(/^#/, "").trim();
      if (ref && !orderRefs.includes(ref)) orderRefs.push(ref);
    }
    if (!invoiceFromColumn && cInvoice && row[cInvoice]) invoiceFromColumn = row[cInvoice].trim();
  }

  const invoiceNo = invoiceFromColumn || codInvoiceNumber(rawText.toUpperCase(), filename);
  return [{
    id: `COD-${invoiceNo}`,
    provider: "COD",
    net: +net.toFixed(2),
    orderRefs,
    source: filename,
    notes: `${records.length} rows; amount column: ${cAmount}${cRef ? `, refs: ${cRef}` : ", no ref column found"}`,
  }];
}

export function parseCodCsv(text: string, filename: string): ParsedPayout[] {
  const records = toRecords(parseCsv(text));
  return parseCodRecords(records, text, filename);
}

export function parseCodXlsx(buf: Buffer | ArrayBuffer, filename: string): ParsedPayout[] {
  const buffer = buf instanceof ArrayBuffer ? Buffer.from(buf) : buf;
  for (const rows of sheetRows(buffer)) {
    const rawText = rows.slice(0, 40).map((r) => r.join(" ")).join("\n");
    const headerIdx = rows.findIndex((r) => r.some((c) => COD_AMOUNT_COL_RE.test(c.trim())));
    if (headerIdx === -1) continue;
    const header = rows[headerIdx].map((c) => c.trim());
    const records = rows.slice(headerIdx + 1)
      .filter((r) => r.some((c) => c.trim() !== ""))
      .map((r) => {
        const rec: Record<string, string> = {};
        header.forEach((h, i) => { rec[h] = r[i] ?? ""; });
        return rec;
      });
    if (records.length === 0) continue;
    try {
      return parseCodRecords(records, rawText, filename);
    } catch {
      continue;
    }
  }
  throw new Error("COD statement: no header row with a recognizable amount column found.");
}
```

Note: `parseCodRecords`'s column matching runs against `toRecords`'s lowercased headers for the CSV path, and against raw (non-lowercased) headers for the XLSX path — `COD_*_RE` all carry the `i` flag, so both work.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 9`, `pass 9`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/payouts.ts tests/parsers/payouts-cod.test.ts
git commit -m "$(cat <<'EOF'
Add COD (On Track Delivery) payout parser

Bank credits from the courier were structurally unmatchable — classification
already tagged them COD correctly, but no parser existed for the courier's
remittance invoice, so every COD credit was stuck in AWAITING_PAYOUT with
no path forward regardless of what a founder tried to upload.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Checkout.com settlement parser

**Files:**
- Modify: `lib/parsers/payouts.ts` (add after the COD parser from Task 3)
- Test: `tests/parsers/payouts-checkout.test.ts`

**Interfaces:**
- Produces: `export function parseCheckoutCsv(text: string, filename: string): ParsedPayout[]` in `lib/parsers/payouts.ts`. Task 6 wires it into `parsePayoutFile`.
- Consumes: `ParsedPayout`, `PayoutTransactionShare`, `StripeQuality` types (already defined earlier in the same file), `parseCsv`/`toRecords`.

- [ ] **Step 1: Write the failing tests**

Create `tests/parsers/payouts-checkout.test.ts`. The header row and the three fee-breakdown rows are taken directly from the founder's real Checkout.com export sample (Network Token Update fee, Authorization fee, Scheme fee) so the "no guesswork" net is hand-computed from those exact numbers:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCheckoutCsv } from "@/lib/parsers/payouts";

const HEADER = [
  "Client Entity ID", "Client Entity Name", "Sub Entity ID", "Sub Entity Name",
  "Processing Channel ID", "Merchant Category Code", "Currency Account ID",
  "Currency Account Name", "Currency Account Custom ID", "Action Type", "Action ID",
  "Payment ID", "Requested On", "Processed On", "Processing Currency",
  "FX Rate Applied", "Holding Currency", "FX Trade ID", "Payout ID", "Reference",
  "Payment Method", "Card Type", "Card Category", "Issuer Country", "Entity Country",
  "Region", "MID", "Response Code", "Response Description", "Breakdown Type",
  "Processing Currency Amount", "Holding Currency Amount", "Entity Country Tax Currency",
  "Tax Fx Rate", "Tax Currency Amount", "Fee Detail",
].join(",");

function row(fields: Record<string, string>): string {
  return HEADER.split(",").map((h) => `"${(fields[h] ?? "").replace(/"/g, '""')}"`).join(",");
}

test("parseCheckoutCsv: nets fee rows against a charge row exactly, groups by account+date when Payout ID is blank", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Network Token Update",
      "Payment ID": "nt_flt5z2o4qffyvhrk72wwtsxs6m", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "-0.35",
    }),
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Network Token Update",
      "Payment ID": "nt_flt5z2o4qffyvhrk72wwtsxs6m", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "-0.0175",
    }),
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Authorization",
      "Payment ID": "pay_yfhvnmqbrjtijdowmje5xwmumy", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "500.00", "Reference": "#5204",
    }),
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Authorization",
      "Payment ID": "pay_yfhvnmqbrjtijdowmje5xwmumy", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "-0.65", "Reference": "#5204",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  const [payout] = parseCheckoutCsv(csv, "checkout.csv");

  // hand-computed: -0.35 + -0.0175 + 500.00 + -0.65 = 498.9825 → 498.98
  assert.equal(payout.net, 498.98);
  assert.equal(payout.id, "CKO-ca_kmocqoe55bmubetiumsz6lgxau_2026-07-07");
  assert.equal(payout.provider, "Checkout");
  assert.deepEqual(payout.orderRefs, ["5204"]);
  assert.equal(payout.originalCurrency, undefined);
  assert.equal(payout.netOriginal, undefined);

  const tx = payout.transactions!.find((t) => t.ref === "5204")!;
  assert.equal(tx.netShare, 499.35); // 500.00 + -0.65
  assert.equal(tx.grossShare, 500.00);
  assert.equal(tx.feeShare, 0.65);
  assert.equal(tx.isRefund, false);
  assert.equal(tx.quality, "clean");
});

test("parseCheckoutCsv: prefers a populated Payout ID over the date+account fallback", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_1", "Payout ID": "po_123", "Action Type": "Authorization",
      "Payment ID": "pay_a", "Processed On": "2026-07-07 10:00:00",
      "Holding Currency": "AED", "Holding Currency Amount": "100.00", "Reference": "#7001",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  const [payout] = parseCheckoutCsv(csv, "checkout.csv");
  assert.equal(payout.id, "CKO-po_123");
});

test("parseCheckoutCsv: flags multi quality when two References land under one Payment ID", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_b",
      "Processed On": "2026-07-08 10:00:00", "Holding Currency": "AED",
      "Holding Currency Amount": "50.00", "Reference": "#7002",
    }),
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_b",
      "Processed On": "2026-07-08 10:00:00", "Holding Currency": "AED",
      "Holding Currency Amount": "30.00", "Reference": "#7003",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  const [payout] = parseCheckoutCsv(csv, "checkout.csv");
  const tx = payout.transactions!.find((t) => t.ref === "7002")!;
  assert.equal(tx.quality, "multi");
  assert.equal(tx.netShare, 80.00);
});

test("parseCheckoutCsv: throws on a mixed holding currency within one payout group instead of averaging", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_c",
      "Processed On": "2026-07-09 10:00:00", "Holding Currency": "AED",
      "Holding Currency Amount": "50.00", "Reference": "#7004",
    }),
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_d",
      "Processed On": "2026-07-09 10:00:00", "Holding Currency": "SAR",
      "Holding Currency Amount": "30.00", "Reference": "#7005",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  assert.throws(() => parseCheckoutCsv(csv, "checkout.csv"), /mixes holding currencies/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL — `parseCheckoutCsv` is not exported yet.

- [ ] **Step 3: Implement the parser**

In `lib/parsers/payouts.ts`, add after the COD parser block from Task 3:

```ts
// ── Checkout.com: Interchange++ settlement export ─────────────────────────
// Every row is a breakdown line (a charge, a fee, a tax) for one Payment ID,
// already in "Holding Currency" — which the founder confirmed is the exact
// figure Checkout wires to the bank. Fee/tax rows carry a negative amount,
// so summing every row in a group already nets fees out — no FX derivation,
// no batch_fx, unlike Tabby/Tamara. Real exports have an empty "Payout ID"
// column per-row (confirmed against the founder's sample) — group by
// (Currency Account ID, Processed On date) in that case, but prefer a
// populated Payout ID when a future export has one.
export function parseCheckoutCsv(text: string, filename: string): ParsedPayout[] {
  const records = toRecords(parseCsv(text));
  if (records.length === 0) throw new Error("Empty Checkout CSV");
  const cols = Object.keys(records[0]);
  const required = ["holding currency amount", "holding currency", "processed on", "currency account id", "payment id", "action type"];
  const missing = required.filter((c) => !cols.includes(c));
  if (missing.length > 0) {
    throw new Error(`Checkout CSV missing column(s) [${missing.join(", ")}] — expected the Interchange++ settlement export.`);
  }

  type Row = { key: string; paymentId: string; ref: string; amount: number; isRefund: boolean; holdingCcy: string };
  const rows: Row[] = [];
  for (const r of records) {
    const amount = parseFloat((r["holding currency amount"] || "0").replace(/,/g, ""));
    if (Number.isNaN(amount)) continue;
    const payoutIdRaw = (r["payout id"] || "").trim();
    const account = (r["currency account id"] || "").trim();
    const date = (r["processed on"] || r["requested on"] || "").slice(0, 10);
    const key = payoutIdRaw || `${account}_${date}`;
    rows.push({
      key,
      paymentId: (r["payment id"] || "").trim(),
      ref: (r["reference"] || "").trim().replace(/^#/, ""),
      amount,
      isRefund: /refund/i.test(r["action type"] || ""),
      holdingCcy: (r["holding currency"] || "AED").trim().toUpperCase(),
    });
  }
  if (rows.length === 0) throw new Error("Checkout CSV: no rows with a numeric Holding Currency Amount found.");

  const byGroup = new Map<string, Row[]>();
  for (const r of rows) {
    const g = byGroup.get(r.key) ?? [];
    g.push(r);
    byGroup.set(r.key, g);
  }

  const payouts: ParsedPayout[] = [];
  for (const [key, groupRows] of byGroup) {
    const holdingCcys = new Set(groupRows.map((r) => r.holdingCcy));
    if (holdingCcys.size > 1) {
      throw new Error(`Checkout CSV: payout group "${key}" mixes holding currencies (${[...holdingCcys].join(", ")}) — expected exactly one settlement currency per batch.`);
    }
    const net = groupRows.reduce((s, r) => s + r.amount, 0);
    const grossTotal = groupRows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const feeTotal = Math.abs(groupRows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));

    const byPayment = new Map<string, Row[]>();
    for (const r of groupRows) {
      const g = byPayment.get(r.paymentId) ?? [];
      g.push(r);
      byPayment.set(r.paymentId, g);
    }

    const orderRefs: string[] = [];
    const transactions: PayoutTransactionShare[] = [];
    for (const paymentRows of byPayment.values()) {
      const refs = [...new Set(paymentRows.map((r) => r.ref).filter(Boolean))];
      if (refs.length === 0) continue; // fee-only maintenance rows (e.g. Network Token Update) carry no reference by design — they still count toward net above, just unattributed to an order.
      const netShare = +paymentRows.reduce((s, r) => s + r.amount, 0).toFixed(2);
      const grossShare = +paymentRows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0).toFixed(2);
      const feeShare = +Math.abs(paymentRows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0)).toFixed(2);
      const isRefund = paymentRows.some((r) => r.isRefund) || netShare < 0;
      const quality: StripeQuality = refs.length > 1 ? "multi" : isRefund ? "refund" : "clean";
      const ref = refs[0];
      if (!orderRefs.includes(ref)) orderRefs.push(ref);
      transactions.push({ ref, netShare, grossShare, feeShare, isRefund, quality });
    }

    payouts.push({
      id: `CKO-${key}`,
      provider: "Checkout",
      net: +net.toFixed(2),
      gross: +grossTotal.toFixed(2),
      fees: +feeTotal.toFixed(2),
      orderRefs,
      source: filename,
      notes: `${groupRows.length} breakdown rows across ${byPayment.size} payments`,
      transactions,
    });
  }
  return payouts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 13`, `pass 13`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/payouts.ts tests/parsers/payouts-checkout.test.ts
git commit -m "$(cat <<'EOF'
Add Checkout.com settlement parser

The real export (Interchange++ breakdown: fees/taxes/authorizations as
separate rows) was falling through to the generic CSV parser, which would
have summed every fee and tax row as if it were an order amount. Groups by
Payout ID when present, else Currency Account + settlement date; nets
Holding Currency Amount directly since fee rows are already negative and
Checkout confirmed this is the exact figure wired to the bank.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Tabby & Tamara — emit per-order `transactions[]`

**Files:**
- Modify: `lib/parsers/payouts.ts` (`parseTabbyXlsx` at ~line 385-441, `parseTamaraXlsx` at ~line 322-381)
- Test: `tests/parsers/payouts-tabby-tamara.test.ts`

**Interfaces:**
- Consumes/modifies existing `parseTabbyXlsx`/`parseTamaraXlsx` signatures — unchanged. Both now additionally populate `ParsedPayout.transactions`.

- [ ] **Step 1: Write the failing tests**

Create `tests/parsers/payouts-tabby-tamara.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseTabbyXlsx, parseTamaraXlsx } from "@/lib/parsers/payouts";

function xlsxBuffer(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("parseTabbyXlsx: transactions[] sums to exactly the aggregate net, refund shares are negative", () => {
  const buf = xlsxBuffer([
    ["Statement # TabbyTEST"],
    ["Order Number", "Order Amount", "Transferred amount", "Total deduction", "Currency", "Type"],
    ["SA1001", "100", "95", "5", "SAR", "Sale"],
    ["SA1002", "50", "-47.50", "2.50", "SAR", "Refund"],
  ]);

  const [payout] = parseTabbyXlsx(buf, "tabby.xlsx");
  const sumNetShares = +payout.transactions!.reduce((s, t) => s + t.netShare, 0).toFixed(2);

  assert.equal(sumNetShares, payout.net);
  const sale = payout.transactions!.find((t) => t.ref === "SA1001")!;
  const refund = payout.transactions!.find((t) => t.ref === "SA1002")!;
  assert.equal(sale.isRefund, false);
  assert.equal(sale.quality, "clean");
  assert.equal(refund.isRefund, true);
  assert.equal(refund.quality, "refund");
  assert.ok(refund.netShare < 0);
});

test("parseTabbyXlsx: a duplicated order ref sums its shares instead of overwriting", () => {
  const buf = xlsxBuffer([
    ["Statement # TabbyTEST"],
    ["Order Number", "Order Amount", "Transferred amount", "Total deduction", "Currency", "Type"],
    ["SA2001", "50", "48", "2", "SAR", "Sale"],
    ["SA2001", "50", "48", "2", "SAR", "Sale"],
  ]);

  const [payout] = parseTabbyXlsx(buf, "tabby.xlsx");
  assert.equal(payout.transactions!.length, 1);
  const tx = payout.transactions![0];
  assert.equal(tx.quality, "multi");
  assert.equal(+(tx.netShare).toFixed(2), +(payout.net).toFixed(2));
});

test("parseTamaraXlsx: transactions[] sums to exactly the aggregate net", () => {
  const buf = xlsxBuffer([
    ["Merchant Order ID", "Tamara Order ID", "Order Amount", "Total Fees", "Total Payable to Merchant", "Currency", "Merchant Refund ID"],
    ["WA3001", "tam_1", "200", "10", "190", "AED", ""],
    ["WA3002", "tam_2", "80", "4", "76", "AED", ""],
  ]);

  const [payout] = parseTamaraXlsx(buf, "tamara.xlsx");
  const sumNetShares = +payout.transactions!.reduce((s, t) => s + t.netShare, 0).toFixed(2);

  assert.equal(sumNetShares, payout.net);
  assert.equal(payout.transactions!.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL — `payout.transactions` is `undefined`, so `.reduce` throws / assertions fail.

- [ ] **Step 3: Implement — Tabby**

In `lib/parsers/payouts.ts`, inside `parseTabbyXlsx`, replace the loop body (the `for (const r of rows.slice(h + 1)) { ... }` block) with a version that also builds `shareByRef`:

```ts
    let net = 0, gross = 0, fees = 0, sales = 0, refunds = 0, netOriginal = 0;
    const orderRefs: string[] = [];
    const currencies = new Set<string>();
    const shareByRef = new Map<string, PayoutTransactionShare>();
    for (const r of rows.slice(h + 1)) {
      const ref = String(r[jRef] ?? "").trim();
      if (!ref || !/^#?[A-Za-z0-9-]{1,20}$/.test(ref)) continue;
      if (!/\d/.test(String(r[jNet] ?? ""))) continue;
      const ccy = ((jCcy >= 0 && r[jCcy]?.trim()) || "AED").toUpperCase();
      currencies.add(ccy);
      const isRefund = jType >= 0 && /refund/i.test(String(r[jType] ?? ""));
      const sign = isRefund ? -1 : 1;
      const rowNetAed = sign * Math.abs(toAed(num(r[jNet]), ccy));
      const rowGrossAed = jGross >= 0 ? sign * Math.abs(toAed(num(r[jGross]), ccy)) : 0;
      const rowFeeAed = jFees >= 0 ? Math.abs(toAed(num(r[jFees]), ccy)) : 0;
      netOriginal += sign * Math.abs(num(r[jNet]));
      net += rowNetAed;
      if (jGross >= 0) gross += rowGrossAed;
      if (jFees >= 0) fees += rowFeeAed;
      if (isRefund) refunds += 1; else sales += 1;
      const clean = ref.replace(/^#/, "");
      if (clean && !orderRefs.includes(clean)) orderRefs.push(clean);

      if (clean) {
        const prior = shareByRef.get(clean);
        shareByRef.set(clean, prior
          ? {
              ref: clean,
              netShare: +(prior.netShare + rowNetAed).toFixed(2),
              grossShare: +(prior.grossShare + rowGrossAed).toFixed(2),
              feeShare: +(prior.feeShare + rowFeeAed).toFixed(2),
              isRefund: prior.isRefund || isRefund,
              quality: "multi",
            }
          : {
              ref: clean,
              netShare: +rowNetAed.toFixed(2),
              grossShare: +rowGrossAed.toFixed(2),
              feeShare: +rowFeeAed.toFixed(2),
              isRefund,
              quality: isRefund ? "refund" : "clean",
            });
      }
    }
    if (sales + refunds === 0) continue;
```

Then in the same function's `return` statement, add `transactions: [...shareByRef.values()],` alongside the existing fields (`id`, `provider`, `net`, `gross`, `fees`, `orderRefs`, `source`, `notes`, `originalCurrency`, `netOriginal`).

- [ ] **Step 4: Implement — Tamara**

In `lib/parsers/payouts.ts`, inside `parseTamaraXlsx`, apply the same pattern. Replace the loop body with:

```ts
    let net = 0, gross = 0, fees = 0, tx = 0, netOriginal = 0;
    const orderRefs: string[] = [];
    const currencies = new Set<string>();
    const shareByRef = new Map<string, PayoutTransactionShare>();
    for (const r of rows.slice(h + 1)) {
      const ref = String(r[jRef] ?? "").trim();
      const tamaraId = jTamaraId >= 0 ? String(r[jTamaraId] ?? "").trim() : "";
      if (!ref || !tamaraId) continue;
      const isRefund = jRefundId >= 0 && String(r[jRefundId] ?? "").trim() !== "";
      const sign = isRefund ? -1 : 1;
      const ccy = ((jCcy >= 0 && r[jCcy]?.trim()) || "AED").toUpperCase();
      currencies.add(ccy);
      const rowNetAed = sign * Math.abs(toAed(num(r[jNet]), ccy));
      const rowGrossAed = jGross >= 0 ? sign * Math.abs(toAed(num(r[jGross]), ccy)) : 0;
      const rowFeeAed = jFees >= 0 ? Math.abs(toAed(num(r[jFees]), ccy)) : 0;
      netOriginal += sign * Math.abs(num(r[jNet]));
      net += rowNetAed;
      if (jGross >= 0) gross += rowGrossAed;
      if (jFees >= 0) fees += rowFeeAed;
      tx += 1;
      const clean = ref.replace(/^#/, "");
      if (clean && !orderRefs.includes(clean)) orderRefs.push(clean);

      if (clean) {
        const prior = shareByRef.get(clean);
        shareByRef.set(clean, prior
          ? {
              ref: clean,
              netShare: +(prior.netShare + rowNetAed).toFixed(2),
              grossShare: +(prior.grossShare + rowGrossAed).toFixed(2),
              feeShare: +(prior.feeShare + rowFeeAed).toFixed(2),
              isRefund: prior.isRefund || isRefund,
              quality: "multi",
            }
          : {
              ref: clean,
              netShare: +rowNetAed.toFixed(2),
              grossShare: +rowGrossAed.toFixed(2),
              feeShare: +rowFeeAed.toFixed(2),
              isRefund,
              quality: isRefund ? "refund" : "clean",
            });
      }
    }
    if (tx === 0) continue;
```

Then in the same function's `return` statement, add `transactions: [...shareByRef.values()],`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 16`, `pass 16`, `fail 0`.

- [ ] **Step 6: Run the full suite to confirm no regressions in existing aggregate math**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: all prior tests from Tasks 1-4 still pass unchanged — `transactions[]` is additive; `net`/`gross`/`fees`/`orderRefs` computation is untouched.

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/payouts.ts tests/parsers/payouts-tabby-tamara.test.ts
git commit -m "$(cat <<'EOF'
Emit per-order transactions[] from Tabby and Tamara parsers

Both parsers already computed per-row net/fee/refund while looping, but
only ever surfaced the aggregate total — the per-order breakdown was
discarded before reaching ParsedPayout. The reconciliation engine and
payout_transactions table already fully support transactions[] (it's how
Stripe gets per-order refund badges and quality flags); Tabby/Tamara just
never populated it, so every non-Stripe payout was untraceable below the
statement-total level.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire COD and Checkout into `parsePayoutFile` detection

**Files:**
- Modify: `lib/parsers/payouts.ts:446-487` (the `parsePayoutFile` entry point)
- Test: `tests/parsers/payouts-detect.test.ts`

**Interfaces:**
- Consumes: `parseCodCsv`, `parseCodXlsx` (Task 3), `parseCheckoutCsv` (Task 4) — all already exported.
- Modifies: `parsePayoutFile(buf, filename, hint?)` — same signature, same `ParsedPayout[]` return, no breaking change for existing Telr/Tamara/Tabby/Stripe/generic call sites.

- [ ] **Step 1: Write the failing tests**

Create `tests/parsers/payouts-detect.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayoutFile } from "@/lib/parsers/payouts";

test("parsePayoutFile: detects a COD file by 'ON TRACK DELIVERY' content even without a hint", () => {
  const csv = [
    "ON TRACK DELIVERY SERVICES — INVOICE #16964",
    "Order Number,COD Amount",
    "5001,100.00",
  ].join("\n");
  const buf = Buffer.from(csv, "utf8");

  const [payout] = parsePayoutFile(buf, "remittance.csv");
  assert.equal(payout.provider, "COD");
  assert.equal(payout.id, "COD-16964");
});

test("parsePayoutFile: routes to the COD parser via hint when content sniffing doesn't recognize the file", () => {
  const csv = ["Order Number,Net Amount", "5001,100.00"].join("\n");
  const buf = Buffer.from(csv, "utf8");

  const [payout] = parsePayoutFile(buf, "courier.csv", "COD");
  assert.equal(payout.provider, "COD");
});

test("parsePayoutFile: detects a Checkout.com export by its header shape even without a hint", () => {
  const csv = [
    "Client Entity Name,Currency Account ID,Action Type,Payment ID,Processed On,Holding Currency,Holding Currency Amount,Breakdown Type,Reference",
    "OmniaStores LLC,ca_1,Authorization,pay_x,2026-07-10 10:00:00,AED,100.00,Authorization Fixed Fee,#8001",
  ].join("\n");
  const buf = Buffer.from(csv, "utf8");

  const [payout] = parsePayoutFile(buf, "checkout.csv");
  assert.equal(payout.provider, "Checkout");
});

test("parsePayoutFile: existing Telr/Tabby/Tamara/Stripe detection is unaffected", () => {
  const stripeCsv = [
    "automatic_payout_id,net,gross,fee,description",
    "po_1,95,100,5,#9001",
  ].join("\n");
  const [payout] = parsePayoutFile(Buffer.from(stripeCsv, "utf8"), "stripe.csv");
  assert.equal(payout.provider, "Stripe");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: FAIL on the three new COD/Checkout tests — `parsePayoutFile` currently has no routing for either, so they'd either throw "Could not detect the payout format" or hit `parseGenericPayoutCsv` and get the wrong `provider`/shape. The Stripe test should already pass (pins existing behavior).

- [ ] **Step 3: Implement the routing**

In `lib/parsers/payouts.ts`, replace the body of `parsePayoutFile` (currently lines 446-487) with:

```ts
export function parsePayoutFile(
  buf: Buffer | ArrayBuffer,
  filename: string,
  hint?: Gateway,
): ParsedPayout[] {
  const buffer = buf instanceof ArrayBuffer ? Buffer.from(buf) : buf;
  const name = filename.toLowerCase();
  const isSheet = /\.(xls|xlsx)$/.test(name);

  let sniff = "";
  try {
    sniff = sheetRows(buffer)
      .flatMap((rows) => rows.slice(0, 40))
      .map((r) => r.join(" "))
      .join("\n")
      .toUpperCase();
  } catch {
    sniff = buffer.toString("utf8", 0, 4000).toUpperCase();
  }

  if (/PAYOUT\s*ID\s*\d/.test(sniff) || (sniff.includes("CARTID") && sniff.includes("NET"))) {
    return parseTelrXls(buffer, filename);
  }
  if (sniff.includes("TAMARA")) return parseTamaraXlsx(buffer, filename);
  if (sniff.includes("TABBY") || sniff.includes("TRANSFERRED AMOUNT")) return parseTabbyXlsx(buffer, filename);
  if (sniff.includes("ON TRACK DELIVERY") || hint === "COD") {
    return isSheet ? parseCodXlsx(buffer, filename) : parseCodCsv(buffer.toString("utf8"), filename);
  }
  if ((sniff.includes("CLIENT ENTITY NAME") && sniff.includes("BREAKDOWN TYPE")) || hint === "Checkout") {
    return parseCheckoutCsv(buffer.toString("utf8"), filename);
  }

  if (!isSheet) {
    const text = buffer.toString("utf8");
    const head = text.slice(0, 2000);
    if (/automatic_payout_id|payout_id/i.test(head) || /\bch_[0-9A-Za-z]{8,}/.test(text) || hint === "Stripe") {
      return parseStripeCsv(text, filename);
    }
    if (hint && hint !== "Unclassified") return parseGenericPayoutCsv(text, filename, hint);
    throw new Error("Could not detect the payout format — pass a provider or use a Telr/Tamara/Tabby/Stripe/Checkout/COD export.");
  }

  if (hint === "Telr") return parseTelrXls(buffer, filename);
  if (hint === "Tamara") return parseTamaraXlsx(buffer, filename);
  if (hint === "Tabby") return parseTabbyXlsx(buffer, filename);
  throw new Error("Unrecognised spreadsheet — expected a Telr payout, Tamara statement, Tabby settlement report, or COD statement.");
}
```

Note: the `hint === "Checkout"` branch is placed before the `!isSheet` block's generic-CSV fallback so an explicit hint always reaches the dedicated parser even if content sniffing misses an unusual export variant — matches the same precedence Task 3/4's dedicated parsers get.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 20`, `pass 20`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/payouts.ts tests/parsers/payouts-detect.test.ts
git commit -m "$(cat <<'EOF'
Wire COD and Checkout parsers into parsePayoutFile detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Engine-level fixture tests for the new providers

**Files:**
- Test: `tests/reconciliation/engine-providers.test.ts`

**Interfaces:**
- Consumes: `computeReconLines` (Task 2), `parseCodCsv`/`parseCheckoutCsv` (Tasks 3-4) — proves the parser output and the matching engine agree end-to-end on realistic data, closing the loop the spec calls for.

- [ ] **Step 1: Write the tests**

Create `tests/reconciliation/engine-providers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";
import { parseCodCsv, parseCheckoutCsv } from "@/lib/parsers/payouts";

test("COD: a parsed remittance file resolves its bank credit to SETTLED with zero variance", () => {
  const [codPayout] = parseCodCsv(
    ["Invoice No,Order Number,COD Amount", "16964,5001,2462.00"].join("\n"),
    "on-track-delivery.csv",
  );
  assert.equal(codPayout.originalCurrency, undefined, "COD must never carry a guessed FX currency");

  const lines = computeReconLines({
    credits: [{
      id: "C-COD-1", statement_date: "2026-07-11",
      description: "KWD Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES//REF/invoice 16964",
      reference: "INV16964", amount: 2462.00, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: codPayout.id, gateway: codPayout.provider, net_amount: codPayout.net,
      gross_amount: codPayout.gross ?? codPayout.net, fee_amount: codPayout.fees ?? 0,
      source: codPayout.source, status: "uploaded", order_refs: codPayout.orderRefs,
      original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5001" }],
    confirmations: new Map(),
  });

  assert.equal(lines[0].state, "SETTLED");
  assert.equal(lines[0].variance, 0);
  assert.deepEqual(lines[0].resolvedOrders, ["5001"]);
});

test("Checkout: a parsed settlement resolves its bank credit to SETTLED with zero variance", () => {
  const header = "Currency Account ID,Action Type,Payment ID,Processed On,Holding Currency,Holding Currency Amount,Reference";
  const csv = [
    header,
    "ca_1,Authorization,pay_a,2026-07-10 10:00:00,AED,499.35,#5300",
    "ca_1,Network Token Update,nt_a,2026-07-10 10:00:00,AED,-0.37,",
  ].join("\n");
  const [checkoutPayout] = parseCheckoutCsv(csv, "checkout.csv");
  assert.equal(checkoutPayout.originalCurrency, undefined, "Checkout must never carry a guessed FX currency");

  const lines = computeReconLines({
    credits: [{
      id: "C-CKO-1", statement_date: "2026-07-10",
      description: "NETWORK INTERNATIONAL LLC STRIPEXXXXXXXX", // irrelevant text, provider comes from gateway_guess
      reference: "REF001", amount: +(499.35 - 0.37).toFixed(2), gateway_guess: "Checkout", confidence: "keyword",
    }],
    payouts: [{
      id: checkoutPayout.id, gateway: checkoutPayout.provider, net_amount: checkoutPayout.net,
      gross_amount: checkoutPayout.gross ?? checkoutPayout.net, fee_amount: checkoutPayout.fees ?? 0,
      source: checkoutPayout.source, status: "uploaded", order_refs: checkoutPayout.orderRefs,
      original_currency: null, net_original: null,
      transactions: checkoutPayout.transactions!.map((t) => ({
        order_ref: t.ref, is_refund: t.isRefund, quality: t.quality, net_aed: t.netShare,
      })),
    }],
    orders: [{ order_number: "5300" }],
    confirmations: new Map(),
  });

  assert.equal(lines[0].state, "SETTLED");
  assert.equal(lines[0].variance, 0);
  assert.deepEqual(lines[0].resolvedOrders, ["5300"]);
});

test("PAYOUT_VARIANCE still fires for a new provider when the parsed net doesn't match the bank credit", () => {
  const [codPayout] = parseCodCsv(
    ["Invoice No,Order Number,COD Amount", "17000,5002,1000.00"].join("\n"),
    "on-track-delivery.csv",
  );

  const lines = computeReconLines({
    credits: [{
      id: "C-COD-2", statement_date: "2026-07-12", description: "invoice 17000",
      reference: "INV17000", amount: 950.00, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: codPayout.id, gateway: codPayout.provider, net_amount: codPayout.net,
      gross_amount: codPayout.net, fee_amount: 0, source: codPayout.source, status: "uploaded",
      order_refs: codPayout.orderRefs, original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5002" }],
    confirmations: new Map(),
  });

  assert.equal(lines[0].state, "PAYOUT_VARIANCE");
  assert.equal(lines[0].variance, -50); // 950 (bank) - 1000 (payout net)
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 23`, `pass 23`, `fail 0`. (If any fail, do not adjust the test's expected numbers to match — re-check the hand computation first; a failing exact-math assertion here means either the parser or this task's fixture has a real arithmetic error.)

- [ ] **Step 3: Commit**

```bash
git add tests/reconciliation/engine-providers.test.ts
git commit -m "$(cat <<'EOF'
Add engine-level fixture tests proving COD/Checkout resolve end-to-end

Bank credit → parsed payout → order resolves to SETTLED with exact
variance=0.00 on matching fixtures, and PAYOUT_VARIANCE (not a silent
near-miss) on a mismatched one — closes the loop from parser output to
reconciliation state for both new providers.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: UI — `info` tone, situational AWAITING_PAYOUT copy, reference display

**Files:**
- Modify: `components/finance/finance-workspace.tsx`

**Interfaces:** None — this is leaf UI, no other file depends on it.

- [ ] **Step 1: Add the `info` tone to the CSS palette**

In `components/finance/finance-workspace.tsx`, inside the `CSS` template literal (currently starting at line 670), find this line:

```
    --warn: #B0742E; --warn-wash: #FBF2E6;
```

Add immediately after it:

```
    --info: #2E6B7A; --info-wash: #E8F1F3;
```

- [ ] **Step 2: Apply the `info` tone to every place `ok`/`warn`/`bad` already have rules**

In the same `CSS` block, each existing selector list below currently has `.ok`/`.bad`/`.warn`/`.muted` variants — add a matching `.info` variant next to each:

Find:
```
  .row.ok { border-left: 3px solid var(--ok); } .row.bad { border-left: 3px solid var(--bad); }
  .row.warn { border-left: 3px solid var(--warn); } .row.muted { border-left: 3px solid var(--line-strong); }
```
Replace with:
```
  .row.ok { border-left: 3px solid var(--ok); } .row.bad { border-left: 3px solid var(--bad); }
  .row.warn { border-left: 3px solid var(--warn); } .row.muted { border-left: 3px solid var(--line-strong); }
  .row.info { border-left: 3px solid var(--info); }
```

Find:
```
  .pill.ok { background: var(--ok-wash); color: var(--ok); } .pill.bad { background: var(--bad-wash); color: var(--bad); }
  .pill.warn { background: var(--warn-wash); color: var(--warn); } .pill.muted { background: #F3EFE7; color: var(--muted); }
```
Replace with:
```
  .pill.ok { background: var(--ok-wash); color: var(--ok); } .pill.bad { background: var(--bad-wash); color: var(--bad); }
  .pill.warn { background: var(--warn-wash); color: var(--warn); } .pill.muted { background: #F3EFE7; color: var(--muted); }
  .pill.info { background: var(--info-wash); color: var(--info); }
```

Find:
```
  .doc-chip.bad { background: var(--bad-wash); color: var(--bad); }
  .doc-chip.warn { background: var(--warn-wash); color: var(--warn); }
  .doc-chip.ok { background: var(--ok-wash); color: var(--ok); }
```
Replace with:
```
  .doc-chip.bad { background: var(--bad-wash); color: var(--bad); }
  .doc-chip.warn { background: var(--warn-wash); color: var(--warn); }
  .doc-chip.ok { background: var(--ok-wash); color: var(--ok); }
  .doc-chip.info { background: var(--info-wash); color: var(--info); }
```

Find:
```
  .kpi.ok .kpi-value { color: var(--ok); } .kpi.bad .kpi-value { color: var(--bad); } .kpi.warn .kpi-value { color: var(--warn); }
```
Replace with:
```
  .kpi.ok .kpi-value { color: var(--ok); } .kpi.bad .kpi-value { color: var(--bad); } .kpi.warn .kpi-value { color: var(--warn); }
  .kpi.info .kpi-value { color: var(--info); }
```

- [ ] **Step 3: Switch `AWAITING_PAYOUT` to the `info` tone**

Find (near line 110):
```ts
const STATE_META = {
  SETTLED: { label: "Settled", tone: "ok", icon: Check },
  PAYOUT_VARIANCE: { label: "Variance", tone: "bad", icon: AlertTriangle },
  ORDERS_UNRESOLVED: { label: "Orders unresolved", tone: "warn", icon: HelpCircle },
  AWAITING_PAYOUT: { label: "Awaiting payout", tone: "muted", icon: Clock },
} as const;
```
Replace with:
```ts
const STATE_META = {
  SETTLED: { label: "Settled", tone: "ok", icon: Check },
  PAYOUT_VARIANCE: { label: "Variance", tone: "bad", icon: AlertTriangle },
  ORDERS_UNRESOLVED: { label: "Orders unresolved", tone: "warn", icon: HelpCircle },
  AWAITING_PAYOUT: { label: "Awaiting payout", tone: "info", icon: Clock },
} as const;
```

The KPI at line ~595 (`<Kpi label="Awaiting payout file" ... tone="muted" />`) also switches:

Find:
```tsx
          <Kpi label="Awaiting payout file" value={aed(sum(buckets.awaiting))} note={`${buckets.awaiting.length} lines · money in transit`} tone="muted" />
```
Replace with:
```tsx
          <Kpi label="Awaiting payout file" value={aed(sum(buckets.awaiting))} note={`${buckets.awaiting.length} lines · money in transit`} tone="info" />
```

- [ ] **Step 4: Situational copy for the AWAITING_PAYOUT explanation note**

Find (around line 289-303):
```tsx
          {r.state === "ORDERS_UNRESOLVED" && (
            <div className="note bad">
              Payout net matches the bank, but order <b>#{r.unresolvedRefs.join(", #")}</b> {r.unresolvedRefs.length > 1 ? "aren't" : "isn't"} in the synced orders.
              Run a sync (or widen the window) — this credit can't be called Settled until every order it pays for is accounted for.
            </div>
          )}
          {r.state === "AWAITING_PAYOUT" && (
            <div className="note muted">
              {r.confidence === "unknown"
                ? "No classification rule matches this narration. Add a descriptor rule, then upload the payout file that explains it."
                : r.confidence === "inferred"
                  ? `Provider inferred from the settlement bank, not confirmed. Upload the ${r.provider} payout file to prove which gateway and which orders this pays for.`
                  : `Bank credit confirmed. Upload the ${r.provider} payout file to explain it and resolve its orders.`}
            </div>
          )}
```

Replace with:

```tsx
          {r.state === "ORDERS_UNRESOLVED" && (
            <div className="note bad">
              Payout net matches the bank, but order <b>#{r.unresolvedRefs.join(", #")}</b> {r.unresolvedRefs.length > 1 ? "aren't" : "isn't"} in the synced orders.
              Run a sync (or widen the window) — this credit can't be called Settled until every order it pays for is accounted for.
            </div>
          )}
          {r.state === "AWAITING_PAYOUT" && (
            <div className="note info">
              {r.confidence === "unknown"
                ? "No classification rule matches this narration. Add a descriptor rule, then upload the payout file that explains it."
                : r.confidence === "inferred"
                  ? `Provider inferred from the settlement bank, not confirmed. Upload the ${r.provider} payout file to prove which gateway and which orders this pays for.`
                  : (() => {
                      const statementNoun: Record<string, string> = {
                        Tabby: "settlement report", Tamara: "merchant statement", COD: "remittance invoice",
                        Stripe: "payout reconciliation report", Checkout: "settlement export", Telr: "payout file",
                      };
                      const noun = statementNoun[r.provider] ?? "payout file";
                      const refPart = r.reference ? ` (ref **${r.reference}**)` : "";
                      return `Bank credit confirmed as ${r.provider}${refPart}. Upload the ${r.provider} ${noun} that explains it — the invoice/reference number visible here should match the file.`;
                    })()}
            </div>
          )}
```

Add `.note.info { background: var(--info-wash); color: var(--gold-deep); }` to the `CSS` block next to the existing `.note.bad`/`.note.muted` rules:

Find:
```
  .note.bad { background: var(--bad-wash); color: var(--bad); } .note.muted { background: #F3EFE7; color: var(--gold-deep); }
```
Replace with:
```
  .note.bad { background: var(--bad-wash); color: var(--bad); } .note.muted { background: #F3EFE7; color: var(--gold-deep); }
  .note.info { background: var(--info-wash); color: var(--gold-deep); }
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors introduced by this file.

- [ ] **Step 6: Visual verification**

Run: `npm run dev`, open the finance workspace's Reconciliation tab in a browser, and confirm:
- Any `AWAITING_PAYOUT` row now renders with a teal/blue left border and pill instead of flat grey.
- Expanding a COD or otherwise-unmatched row shows the new situational copy (provider name, reference if present, and the correct statement noun for that provider) instead of the old generic sentence.

If there is no live data to exercise this against, use the `verify` skill's guidance for this project to drive the page with representative fixture data instead of skipping this step.

- [ ] **Step 7: Commit**

```bash
git add components/finance/finance-workspace.tsx
git commit -m "$(cat <<'EOF'
Give AWAITING_PAYOUT its own color and situational explanation copy

It was rendering in the flattest, least distinct color in the palette
despite being the state most in need of a founder's attention, and its
explanation text was a fixed sentence regardless of what the system
actually knew about the credit (provider, reference number, which kind of
statement file to look for).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Full regression pass

**Files:** None modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: `tests 23`, `pass 23`, `fail 0`.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint the whole project**

Run: `npm run lint`
Expected: no new errors in files touched by this plan.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds (catches any server/client component or import issue the type-checker alone wouldn't).

- [ ] **Step 5: Manual verification against a live upload (if a Supabase dev instance is reachable)**

Use the `verify` skill to drive the actual finance workspace: upload a small synthetic COD CSV (same shape as the Task 3 fixture) and a small synthetic Checkout CSV (same shape as the Task 4 fixture) through the existing upload UI, confirm the resulting rows reach `SETTLED`, and confirm the `info`-tone styling and new copy from Task 8 render correctly on any row still `AWAITING_PAYOUT`. If no reachable dev database exists in this environment, state that explicitly rather than claiming it was verified — the automated test suite in Tasks 1-7 is what stands behind the "no guesswork, real math" requirement; this step is the UI/integration confirmation on top of it.
