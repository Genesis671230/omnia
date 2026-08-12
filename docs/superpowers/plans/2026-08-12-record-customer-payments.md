# Record Customer Payments From a Payout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch-record Zoho customer payments (marking invoices paid) for every order in a settled, founder-confirmed payout, driven by a new "Record payments" button inside the reconciliation UI's payout proof panel.

**Architecture:** Extend the existing, working-but-unwired pipeline (`settlement_records` → `evidence_confirmed` → `POST /api/settlements/publish` → `createZohoCustomerPayment` in `lib/integrations/zoho.ts`) with the three things it's missing — the real bank-credit date instead of `today()`, a deposit account, and the Credit-Card/Cash-on-Delivery payment-mode rule — then build a shadcn `Dialog` UI on top of it. Delete the unrelated, unfinished duplicate scaffold (`lib/zoho/client.ts` etc.) that never got wired up.

**Tech Stack:** Next.js App Router route handlers, Supabase (`settlement_records` table), Zoho Inventory API (`createZohoCustomerPayment`), shadcn/ui (`Dialog`, `Select`, `Checkbox`, `Input`), framer-motion, node's built-in test runner (`tsx --test`).

## Global Constraints

- Payment mode: `gateway.toUpperCase() === "COD" ? "Cash on Delivery" : "Credit Card"` — literal strings, must match this Zoho org's actual payment-mode picklist labels exactly.
- Deposit account: reuse `zoho_account_config.bank_account_id` (already "where the wire actually lands," used today by the journal-transfer flow). No new DB column, no new settings-panel field.
- Payment date: always the settlement's own `settlement_date` (the bank credit date) when called from the publish route. Never a date picker in this dialog, never left to `createZohoCustomerPayment`'s own `today()` fallback (that fallback stays only for other/future callers).
- Amount: always `settlement_records.gross_aed`, never editable in this UI.
- Reference number sent to Zoho: the settlement's `bank_reference` by default; a bookkeeper-entered override replaces it only when explicitly opted into via a checkbox. This narrows the existing invoice-level defense-in-depth dedupe check for that specific payment — accepted tradeoff, documented in the spec, not to be re-litigated mid-implementation.
- The dialog renders through a Radix `Portal` to `document.body`, outside the `.wrap` element that carries this workspace's `--gold`/`--ink`/`--cream` custom properties. Every accent color in the new component must be a literal hex Tailwind class (e.g. `text-[#1F1B16]`), never `var(--token)` — this exact trap is documented in `components/finance/reconciliation/zoho-post-dialog.tsx`'s header comment.
- Spec: `docs/superpowers/specs/2026-08-12-record-customer-payments-design.md`. If anything here conflicts with it, the spec wins — flag the conflict rather than silently picking one.

---

### Task 1: `zohoPaymentModeFor` — new Credit-Card/Cash-on-Delivery rule

**Files:**
- Modify: `lib/integrations/zoho.ts:117-126`
- Modify: `tests/integrations/zoho-payment-mapping.test.ts` (full rewrite)

**Interfaces:**
- Produces: `zohoPaymentModeFor(gateway: string): string` — unchanged signature, new behavior. Consumed later by `buildCustomerPaymentBody` (Task 2).

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/integrations/zoho-payment-mapping.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { zohoPaymentModeFor } from "@/lib/integrations/zoho";

test("zohoPaymentModeFor: COD is Cash on Delivery, case-insensitively", () => {
  assert.equal(zohoPaymentModeFor("COD"), "Cash on Delivery");
  assert.equal(zohoPaymentModeFor("cod"), "Cash on Delivery");
});

test("zohoPaymentModeFor: every other gateway is Credit Card", () => {
  // Collapsed deliberately: this Zoho org's payment_mode picklist is Credit
  // Card / Cash on Delivery, not one custom mode per gateway. Which gateway
  // actually paid is still recorded on our side, in settlement_records.gateway
  // — the audit trail doesn't depend on Zoho's own payment_mode field.
  assert.equal(zohoPaymentModeFor("Stripe"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Tabby"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Tamara"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Checkout.com"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Unclassified"), "Credit Card");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/integrations/zoho-payment-mapping.test.ts`
Expected: FAIL — `zohoPaymentModeFor("Stripe")` currently returns `"Stripe"`, not `"Credit Card"`.

- [ ] **Step 3: Implement the new rule**

In `lib/integrations/zoho.ts`, replace lines 117-126:

```ts
export function zohoPaymentModeFor(gateway: string): string {
  const map: Record<string, string> = {
    COD: "Cash on Delivery",
    Stripe: "Stripe",
    Tabby: "Tabby",
    Tamara: "Tamara",
    "Checkout.com": "Checkout.com",
  };
  return map[gateway] ?? "Bank Transfer";
}
```

with:

```ts
export function zohoPaymentModeFor(gateway: string): string {
  return gateway.toUpperCase() === "COD" ? "Cash on Delivery" : "Credit Card";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/integrations/zoho-payment-mapping.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/zoho.ts tests/integrations/zoho-payment-mapping.test.ts
git commit -m "feat: collapse Zoho payment mode to Credit Card / Cash on Delivery"
```

---

### Task 2: `buildCustomerPaymentBody` — pure payload builder with date/account/reference support

**Files:**
- Modify: `lib/integrations/zoho.ts:128-226`
- Create: `tests/integrations/zoho-customer-payment-body.test.ts`

**Interfaces:**
- Consumes: `zohoPaymentModeFor` (Task 1).
- Produces:
  - `type ZohoCustomerPaymentInput = { invoiceReferenceNumber: string; amount: number; gateway: string; bankReference: string; date?: string; accountId?: string; referenceNumberOverride?: string }` — the three new fields are optional additions to the existing type.
  - `type CustomerPaymentBody = { customer_id: string; payment_mode: string; amount: number; date: string; reference_number: string; account_id?: string; invoices: Array<{ invoice_id: string; amount_applied: number }> }`
  - `buildCustomerPaymentBody(input: ZohoCustomerPaymentInput & { customerId: string; invoiceId: string }): CustomerPaymentBody` — pure function, no I/O. Consumed by `createZohoCustomerPayment` in this same task, and later directly by the Task 4 tests' mental model (not imported there, but its date/account/reference behavior is what Task 4's route relies on).
  - `createZohoCustomerPayment(input: ZohoCustomerPaymentInput, accessToken: string): Promise<{ payment_id: string }>` — same signature as before, now threading the three new optional fields through to `buildCustomerPaymentBody`. Consumed by `/api/settlements/publish` (Task 4, already an existing consumer — only its call site changes, not its import).

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/zoho-customer-payment-body.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCustomerPaymentBody } from "@/lib/integrations/zoho";

const BASE = {
  invoiceReferenceNumber: "SH-10234",
  amount: 250.5,
  gateway: "Stripe",
  bankReference: "po_1ABC123",
  customerId: "CUST1",
  invoiceId: "INV1",
};

test("buildCustomerPaymentBody: defaults date to today and reference_number to the bank reference", () => {
  const body = buildCustomerPaymentBody(BASE);
  assert.equal(body.date, new Date().toISOString().slice(0, 10));
  assert.equal(body.reference_number, "po_1ABC123");
  assert.equal(body.payment_mode, "Credit Card");
  assert.equal(body.amount, 250.5);
  assert.deepEqual(body.invoices, [{ invoice_id: "INV1", amount_applied: 250.5 }]);
  assert.equal("account_id" in body, false);
});

test("buildCustomerPaymentBody: an explicit date wins over today", () => {
  const body = buildCustomerPaymentBody({ ...BASE, date: "2026-07-19" });
  assert.equal(body.date, "2026-07-19");
});

test("buildCustomerPaymentBody: accountId, when given, is sent as account_id", () => {
  const body = buildCustomerPaymentBody({ ...BASE, accountId: "BANK1" });
  assert.equal(body.account_id, "BANK1");
});

test("buildCustomerPaymentBody: referenceNumberOverride replaces the bank reference", () => {
  const body = buildCustomerPaymentBody({ ...BASE, referenceNumberOverride: "Batch 42" });
  assert.equal(body.reference_number, "Batch 42");
});

test("buildCustomerPaymentBody: COD gateway gets Cash on Delivery", () => {
  const body = buildCustomerPaymentBody({ ...BASE, gateway: "COD" });
  assert.equal(body.payment_mode, "Cash on Delivery");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/integrations/zoho-customer-payment-body.test.ts`
Expected: FAIL — `buildCustomerPaymentBody` doesn't exist yet.

- [ ] **Step 3: Implement**

In `lib/integrations/zoho.ts`, replace lines 128-226 (the `ZohoCustomerPaymentInput` type through the end of `createZohoCustomerPayment`) with:

```ts
export type ZohoCustomerPaymentInput = {
  invoiceReferenceNumber: string; // matches Omnia's order_number
  amount: number;
  gateway: string;
  bankReference: string;
  date?: string;                    // yyyy-mm-dd; defaults to today when omitted
  accountId?: string;               // Zoho chart-of-accounts id for the deposit account
  referenceNumberOverride?: string; // replaces bankReference in what's sent to Zoho
};

const AMOUNT_TOLERANCE_AED = 0.01; // absorbs FX-conversion rounding drift only

type ZohoInvoiceListRow = {
  invoice_id: string;
  reference_number: string;
  customer_id: string;
  balance: number;
};

export type CustomerPaymentBody = {
  customer_id: string;
  payment_mode: string;
  amount: number;
  date: string;
  reference_number: string;
  account_id?: string;
  invoices: Array<{ invoice_id: string; amount_applied: number }>;
};

// Pure: builds the exact JSON body sent to POST /customerpayments. Split out
// from createZohoCustomerPayment so the date/account/reference-override
// logic is unit-testable without a network call — same pattern as
// buildPayoutPostings in lib/integrations/zoho-banking.ts.
export function buildCustomerPaymentBody(
  input: ZohoCustomerPaymentInput & { customerId: string; invoiceId: string },
): CustomerPaymentBody {
  return {
    customer_id: input.customerId,
    payment_mode: zohoPaymentModeFor(input.gateway),
    amount: input.amount,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    reference_number: input.referenceNumberOverride || input.bankReference,
    ...(input.accountId ? { account_id: input.accountId } : {}),
    invoices: [{ invoice_id: input.invoiceId, amount_applied: input.amount }],
  };
}

// Finds the Zoho invoice matching our order_number, tolerating Zoho's
// reference-number formatting drift the same way lib/inventory-compare.ts's
// findOrdersMissingFromZoho does: try Zoho's own server-side filter first
// (fast path — works whenever formats already agree), and only fall back to
// pulling the full invoice list and comparing normalizeRef()'d values when
// the fast path finds nothing.
async function findZohoInvoice(orderNumber: string, accessToken: string, orgId: string): Promise<ZohoInvoiceListRow> {
  const normalized = normalizeRef(orderNumber);
  const invoiceQs = new URLSearchParams({ organization_id: orgId, reference_number: orderNumber });
  const invoiceRes = await fetch(`${API_BASE}/invoices?${invoiceQs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  if (!invoiceRes.ok) throw new Error(`Zoho invoice lookup HTTP ${invoiceRes.status}`);
  const invoiceJson = await invoiceRes.json();
  let matches: ZohoInvoiceListRow[] = (invoiceJson.invoices ?? []).filter(
    (inv: ZohoInvoiceListRow) => normalizeRef(inv.reference_number || "") === normalized,
  );
  if (matches.length === 0) {
    const all = await zohoGetPaginated<ZohoInvoiceListRow>("/invoices", "invoices", accessToken);
    matches = all.filter((inv) => normalizeRef(inv.reference_number || "") === normalized);
  }
  if (matches.length === 0) throw new Error(`No Zoho invoice found for reference_number ${orderNumber}`);
  if (matches.length > 1) throw new Error(`Ambiguous Zoho invoice match for reference_number ${orderNumber} (${matches.length} results)`);
  return matches[0];
}

// Records a Customer Payment against the matched invoice via the Inventory
// API (the Books API 401s under this token's ZohoInventory.fullaccess.all
// scope, but /inventory/v1/customerpayments works — verified live against
// the org). `accessToken` is threaded in by the caller (fetched once per
// publish batch, not once per settlement) rather than fetched here.
//
// Defense-in-depth dedup: checks the matched invoice's own payment history
// for one already carrying this bank_reference before creating a new
// payment — covers the case where a prior attempt's Zoho write actually
// succeeded but the caller's own DB write failed (timeout/5xx), which the
// route's claim mechanism alone can't distinguish from "never attempted".
// Note: this check is keyed on bankReference specifically, so a payment
// posted with a referenceNumberOverride won't be found by it on a later
// retry — accepted, since the primary defense (the caller's atomic claim
// before any Zoho call) is unaffected, and truly ambiguous failures are
// routed to manual review rather than blindly retried.
export async function createZohoCustomerPayment(input: ZohoCustomerPaymentInput, accessToken: string): Promise<{ payment_id: string }> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const invoice = await findZohoInvoice(input.invoiceReferenceNumber, accessToken, orgId);

  const detailRes = await fetch(`${API_BASE}/invoices/${invoice.invoice_id}?organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  if (!detailRes.ok) throw new Error(`Zoho invoice detail HTTP ${detailRes.status}`);
  const detailJson = await detailRes.json();
  const invoiceDetail = detailJson.invoice ?? invoice;
  const existingPayment = (invoiceDetail.payments ?? []).find(
    (p: { reference_number?: string; payment_id: string }) => normalizeRef(p.reference_number || "") === normalizeRef(input.bankReference),
  );
  if (existingPayment) return { payment_id: existingPayment.payment_id };

  const balance = typeof invoiceDetail.balance === "number" ? invoiceDetail.balance : invoice.balance;
  if (typeof balance !== "number") {
    throw new Error(`Zoho invoice ${invoice.invoice_id} response has no balance field — cannot safely validate amount`);
  }
  if (input.amount > balance + AMOUNT_TOLERANCE_AED) {
    throw new Error(`Amount ${input.amount} exceeds Zoho invoice ${invoice.invoice_id} balance ${balance} — refusing to over-apply`);
  }

  const paymentRes = await fetch(`${API_BASE}/customerpayments?organization_id=${orgId}`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(
      buildCustomerPaymentBody({ ...input, customerId: invoice.customer_id, invoiceId: invoice.invoice_id }),
    ),
    cache: "no-store",
  });
  if (!paymentRes.ok) {
    const body = await paymentRes.text();
    throw new Error(`Zoho customer payment HTTP ${paymentRes.status}: ${body.slice(0, 300)}`);
  }
  const paymentJson = await paymentRes.json();
  if (paymentJson.code !== 0) throw new Error(`Zoho customer payment error ${paymentJson.code}: ${paymentJson.message}`);
  return { payment_id: paymentJson.payment.payment_id };
}
```

(This is the existing code with `AMOUNT_TOLERANCE_AED`/`ZohoInvoiceListRow` left in place, `CustomerPaymentBody` + `buildCustomerPaymentBody` inserted, and the inline fetch body in `createZohoCustomerPayment` replaced by a call to `buildCustomerPaymentBody`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/integrations/zoho-customer-payment-body.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full test suite to check nothing else broke**

Run: `npm test`
Expected: PASS (all files, including Task 1's rewritten test)

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/zoho.ts tests/integrations/zoho-customer-payment-body.test.ts
git commit -m "feat: support date/account/reference overrides in Zoho customer payments"
```

---

### Task 3: `SettlementsRepository.listByBankLineId`

**Files:**
- Modify: `lib/repositories/settlements.repository.ts:206-211` (insert after `listByIds`)

**Interfaces:**
- Consumes: nothing new (same `supabase` client, same `SettlementRecord` type already in this file).
- Produces: `SettlementsRepository.listByBankLineId(bankLineId: string): Promise<SettlementRecord[]>`. Consumed by Task 4 (`/api/settlements/publish`) and Task 5 (`GET .../settlements`).

No automated test for this task: this codebase's established convention (see `tests/repositories/settlement-documents.test.ts`, which deliberately tests only the pure token-generation logic and skips the Supabase-hitting method) is to not unit-test repository methods that hit Supabase directly. `listByBankLineId` mirrors the already-trusted `listByIds` method exactly. Verified by `tsc` (Step 2) and by manual QA in Task 9.

- [ ] **Step 1: Add the method**

In `lib/repositories/settlements.repository.ts`, immediately after the closing `},` of `listByIds` (line 211) and before `getByOrderUid`, insert:

```ts

  // Powers both the Record Payments dialog (preview: which orders in this
  // payout are ready/already posted) and /api/settlements/publish's
  // bankLineId mode.
  async listByBankLineId(bankLineId: string): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("bank_line_id", bankLineId)
      .order("order_number", { ascending: true });
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/repositories/settlements.repository.ts
git commit -m "feat: add SettlementsRepository.listByBankLineId"
```

---

### Task 4: `/api/settlements/publish` — bankLineId mode + account/reference passthrough

**Files:**
- Modify: `app/api/settlements/publish/route.ts`

**Interfaces:**
- Consumes: `SettlementsRepository.listByBankLineId` (Task 3), `createZohoCustomerPayment` with its new optional fields (Task 2).
- Produces: same response shape as before (`{ results: ZohoPublishResult[] }`), now reachable via `{ bankLineId, accountId?, referenceNumberOverride? }` in addition to the existing `{ settlementIds }`. Consumed by the UI (Task 6).

No automated test for this task, for the same reason as Task 3 — this route hits both Supabase and the live Zoho API with no existing mocking convention in this repo to extend. Verified by `tsc` and manual QA (Task 9).

- [ ] **Step 1: Accept `bankLineId` and the two override fields**

In `app/api/settlements/publish/route.ts`, replace lines 22-26:

```ts
  const body = await request.json().catch(() => ({}));
  const settlementIds = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  if (settlementIds.length === 0) {
    return NextResponse.json({ error: "settlementIds is required" }, { status: 400 });
  }
```

with:

```ts
  const body = await request.json().catch(() => ({}));
  const settlementIds = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  const bankLineId = typeof body.bankLineId === "string" && body.bankLineId ? body.bankLineId : null;
  const accountId = typeof body.accountId === "string" && body.accountId ? body.accountId : undefined;
  const referenceNumberOverride =
    typeof body.referenceNumberOverride === "string" && body.referenceNumberOverride
      ? body.referenceNumberOverride
      : undefined;

  if (settlementIds.length === 0 && !bankLineId) {
    return NextResponse.json({ error: "settlementIds or bankLineId is required" }, { status: 400 });
  }
  if (settlementIds.length > 0 && bankLineId) {
    return NextResponse.json({ error: "pass settlementIds or bankLineId, not both" }, { status: 400 });
  }
```

- [ ] **Step 2: Load settlements from either source**

Replace line 32:

```ts
    const settlements = await SettlementsRepository.listByIds(settlementIds);
```

with:

```ts
    const settlements = bankLineId
      ? await SettlementsRepository.listByBankLineId(bankLineId)
      : await SettlementsRepository.listByIds(settlementIds);
```

- [ ] **Step 3: Pass the new fields through to `createZohoCustomerPayment`**

Replace lines 56-64:

```ts
        const { payment_id } = await createZohoCustomerPayment(
          {
            invoiceReferenceNumber: s.order_number,
            amount: s.gross_aed,
            gateway: s.gateway,
            bankReference: s.bank_reference,
          },
          accessToken,
        );
```

with:

```ts
        const { payment_id } = await createZohoCustomerPayment(
          {
            invoiceReferenceNumber: s.order_number,
            amount: s.gross_aed,
            gateway: s.gateway,
            bankReference: s.bank_reference,
            date: s.settlement_date ?? undefined,
            accountId,
            referenceNumberOverride,
          },
          accessToken,
        );
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/settlements/publish/route.ts
git commit -m "feat: publish route accepts bankLineId batches with account/reference overrides"
```

---

### Task 5: `GET /api/reconcile/line/[id]/settlements`

**Files:**
- Create: `app/api/reconcile/line/[id]/settlements/route.ts`

**Interfaces:**
- Consumes: `SettlementsRepository.listByBankLineId` (Task 3).
- Produces: `GET` → `{ settlements: SettlementRecord[] }`. Consumed by the UI (Task 6).

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";

// GET /api/reconcile/line/[id]/settlements — the settlement_records rows
// for one bank line. Doubles as the "preview" for the Record Payments
// dialog: evidence_confirmed and zoho_payment_id are already real, live
// state, so there's nothing a separate dry-run would show that this
// doesn't already have.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const settlements = await SettlementsRepository.listByBankLineId(id);
  return NextResponse.json({ settlements });
}
```

- [ ] **Step 2: Manual smoke test**

Run the dev server (`npm run dev`) and hit `GET http://localhost:3000/api/reconcile/line/<a real bank_line_id>/settlements` (find one via the reconciliation UI or `settlement_records.bank_line_id` in Supabase). Expected: `200` with `{ settlements: [...] }`, or `{ settlements: [] }` for a line with none.

- [ ] **Step 3: Commit**

```bash
git add app/api/reconcile/line/\[id\]/settlements/route.ts
git commit -m "feat: add GET /api/reconcile/line/[id]/settlements"
```

---

### Task 6: `RecordPaymentsBar` + `RecordPaymentsDialog` UI component

**Files:**
- Create: `components/finance/reconciliation/record-payments-dialog.tsx`

**Interfaces:**
- Consumes: `GET /api/reconcile/line/[id]/settlements` (Task 5), `GET /api/integrations/zoho/account-config` (existing, returns `{ bankAccounts: Array<{account_id, account_name, account_type, is_active}>, effective: { bankAccountId, ... } }`), `POST /api/settlements/publish` (Task 4), `aed2` and `ReconLine` from `./types`, `SettlementRecord` (type-only) from `@/lib/repositories/settlements.repository`.
- Produces:
  - `export type PaymentRowStatus = { status: "ready" } | { status: "posted"; paymentId: string } | { status: "failed"; error: string; needsManualReview: boolean }`
  - `export function RecordPaymentsBar({ line, onResult }: { line: ReconLine; onResult: (byOrderNumber: Map<string, PaymentRowStatus>) => void })`
  - `export function PaymentRowPill({ s }: { s: PaymentRowStatus })`

  These three are consumed by `gateway-proof.tsx` in Task 7, replacing `PostToZohoBar`/`ZohoRowPill`/`ZohoRowStatus` from the file being deleted in Task 8.

- [ ] **Step 1: Write the component**

Create `components/finance/reconciliation/record-payments-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { aed2, type ReconLine } from "./types";
import type { SettlementRecord } from "@/lib/repositories/settlements.repository";

/* Record customer payments for every order in a settled, confirmed payout —
 * batch-marks the underlying Zoho invoices paid. Distinct from ReconRow's
 * "Preview & post to Zoho" button, which posts a journal TRANSFER (clearing
 * account -> bank + fee); this posts a CUSTOMER PAYMENT against each order's
 * invoice. Both are real Zoho operations, both are needed, neither implies
 * the other.
 *
 * Renders through a shadcn Dialog, which portals to document.body — outside
 * the .wrap element carrying this workspace's --gold/--ink/--cream custom
 * properties (see zoho-post-dialog.tsx for the original discovery of this
 * trap). Every accent color below is therefore a literal hex Tailwind class,
 * never var(--token).
 */

export type PaymentRowStatus =
  | { status: "ready" }
  | { status: "posted"; paymentId: string }
  | { status: "failed"; error: string; needsManualReview: boolean };

type ZohoAccount = { account_id: string; account_name: string; account_type: string; is_active: boolean };

type PublishResult = { settlementId: string; ok: boolean; error?: string; paymentId?: string; needsManualReview?: boolean };

export function RecordPaymentsBar({
  line,
  onResult,
}: {
  line: ReconLine;
  onResult: (byOrderNumber: Map<string, PaymentRowStatus>) => void;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = !!line.confirmedBy;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!canOpen}
        title={!canOpen ? "A founder must confirm this settlement before invoices can be marked paid" : undefined}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors ${
          canOpen
            ? "border-[#D6CCBA] bg-white text-[#1F1B16] hover:border-[#B08343] hover:text-[#6F5325]"
            : "cursor-not-allowed border-[#EAE3D6] bg-[#F3EFE7] text-[#B8B0A0]"
        }`}
      >
        <BadgeCheck size={12} /> Record payments
      </button>

      {open && <RecordPaymentsDialog line={line} onClose={() => setOpen(false)} onResult={onResult} />}
    </>
  );
}

function RecordPaymentsDialog({
  line,
  onClose,
  onResult,
}: {
  line: ReconLine;
  onClose: () => void;
  onResult: (byOrderNumber: Map<string, PaymentRowStatus>) => void;
}) {
  const [settlements, setSettlements] = useState<SettlementRecord[] | null>(null);
  const [rowStatus, setRowStatus] = useState<Map<string, PaymentRowStatus>>(new Map());
  const [accounts, setAccounts] = useState<ZohoAccount[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [useCustomRef, setUseCustomRef] = useState(false);
  const [customRef, setCustomRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/reconcile/line/${encodeURIComponent(line.id)}/settlements`).then((r) => r.json()),
      fetch("/api/integrations/zoho/account-config").then((r) => r.json()),
    ])
      .then(([settlementsJson, configJson]) => {
        if (!alive) return;
        const rows: SettlementRecord[] = settlementsJson.settlements ?? [];
        setSettlements(rows);
        setRowStatus(
          new Map(
            rows.map((s) => [
              s.order_number,
              (s.zoho_payment_id
                ? { status: "posted", paymentId: s.zoho_payment_id }
                : { status: "ready" }) as PaymentRowStatus,
            ]),
          ),
        );
        setAccounts(configJson.bankAccounts ?? []);
        const def = configJson.effective?.bankAccountId ?? "";
        setDefaultAccountId(def);
        setAccountId(def);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [line.id]);

  const postable = (settlements ?? []).filter((s) => rowStatus.get(s.order_number)?.status === "ready");
  const modeSummary = (() => {
    const cod = postable.filter((s) => s.gateway.toUpperCase() === "COD").length;
    const card = postable.length - cod;
    const parts: string[] = [];
    if (card > 0) parts.push(`Credit Card × ${card}`);
    if (cod > 0) parts.push(`Cash on Delivery × ${cod}`);
    return parts.join(", ");
  })();

  const submit = async () => {
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/settlements/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankLineId: line.id,
          accountId: accountId || undefined,
          referenceNumberOverride: useCustomRef && customRef.trim() ? customRef.trim() : undefined,
        }),
      });
      const json = (await res.json()) as { results?: PublishResult[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const orderNumberBySettlementId = new Map((settlements ?? []).map((s) => [s.id, s.order_number]));
      const next = new Map(rowStatus);
      for (const r of json.results ?? []) {
        const orderNumber = orderNumberBySettlementId.get(r.settlementId);
        if (!orderNumber) continue;
        next.set(
          orderNumber,
          r.ok
            ? { status: "posted", paymentId: r.paymentId! }
            : { status: "failed", error: r.error ?? "Unknown error", needsManualReview: !!r.needsManualReview },
        );
      }
      setRowStatus(next);
      onResult(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto bg-white text-[#1F1B16]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[20px] text-[#1F1B16]">Record payments</DialogTitle>
          <DialogDescription className="text-[#8A8175]">
            {line.provider} · {line.payout?.id ?? line.reference} · bank credit {line.date?.slice(0, 10) ?? "—"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-[#8A8175]">
            <Loader2 size={15} className="animate-spin" /> Loading the orders in this payout…
          </div>
        ) : error && !settlements ? (
          <div className="flex items-start gap-2 rounded-xl bg-[#F9ECE7] px-4 py-3 text-[13px] leading-relaxed text-[#A6472F]">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        ) : (
          <>
            <div className="space-y-1.5 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3">
              {(settlements ?? []).map((s) => {
                const st = rowStatus.get(s.order_number) ?? ({ status: "ready" } as const);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[#1F1B16]">#{s.order_number}</span>
                      <span className="truncate text-[#8A8175]">{s.customer_name}</span>
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      <span className="font-mono tabular-nums text-[#1F1B16]">{aed2(s.gross_aed)}</span>
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={st.status}
                          initial={{ opacity: 0, y: -2 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <PaymentRowPill s={st} />
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  </div>
                );
              })}
              {(settlements ?? []).length === 0 && (
                <p className="px-1 py-2 text-[12.5px] text-[#8A8175]">No settlement records for this payout yet.</p>
              )}
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#1F1B16]">Deposit account</label>
                {accounts.length === 0 ? (
                  <p className="rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
                    No deposit account configured — set one in Zoho Settings before recording payments.
                  </p>
                ) : (
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="w-full border-[#D6CCBA] text-[13px]">
                      <SelectValue placeholder="Select an account…" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.account_id} value={a.account_id}>
                          {a.account_name}
                          {a.account_id === defaultAccountId ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <p className="text-[12.5px] text-[#8A8175]">
                Payment mode: <b className="text-[#1F1B16]">{modeSummary || "—"}</b>
              </p>

              <div>
                <label className="flex items-center gap-2 text-[12.5px] text-[#1F1B16]">
                  <Checkbox checked={useCustomRef} onCheckedChange={(v) => setUseCustomRef(v === true)} />
                  Use a custom reference number instead of the bank reference
                </label>
                <AnimatePresence>
                  {useCustomRef && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <Input
                        value={customRef}
                        onChange={(e) => setCustomRef(e.target.value)}
                        placeholder="e.g. Batch 42"
                        className="mt-1.5 border-[#D6CCBA] text-[13px]"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}

            <DialogFooter className="mt-4">
              <button
                onClick={onClose}
                className="rounded-lg border border-[#D6CCBA] bg-white px-4 py-2 text-[13px] font-medium text-[#1F1B16] hover:border-[#B08343]"
              >
                Close
              </button>
              <button
                onClick={submit}
                disabled={posting || postable.length === 0 || accounts.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[#6F5325] px-4 py-2 text-[13px] font-medium text-[#FBF8F1] hover:bg-[#5A4320] disabled:cursor-not-allowed disabled:bg-[#B8B0A0]"
              >
                {posting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Record {postable.length} payment{postable.length === 1 ? "" : "s"}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PaymentRowPill({ s }: { s: PaymentRowStatus }) {
  const map = {
    ready: { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "ready" },
    posted: { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "posted" },
    failed: { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "failed" },
  } as const;
  const cfg = map[s.status];
  const title = s.status === "posted" ? `payment ${s.paymentId}` : s.status === "failed" ? s.error : undefined;
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cfg.cls}`}>
      {s.status === "posted" && <ExternalLink size={9} />}
      {cfg.text}
    </span>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (`gateway-proof.tsx` will still reference the old `posttozohobar.tsx` at this point — that's fixed in Task 7 — so this file is checked in isolation for now; a stray unused-export warning, if any, is expected until Task 7 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add components/finance/reconciliation/record-payments-dialog.tsx
git commit -m "feat: add RecordPaymentsBar/Dialog for batch customer-payment recording"
```

---

### Task 7: Wire `RecordPaymentsBar` into `gateway-proof.tsx`

**Files:**
- Modify: `components/finance/reconciliation/gateway-proof.tsx:8,136,173,199,261-266,323`

**Interfaces:**
- Consumes: `RecordPaymentsBar`, `PaymentRowPill`, `PaymentRowStatus` (Task 6).

- [ ] **Step 1: Swap the import**

Replace line 8:

```ts
import { PostToZohoBar, ZohoRowPill, type ZohoRowStatus } from "./posttozohobar";
```

with:

```ts
import { RecordPaymentsBar, PaymentRowPill, type PaymentRowStatus } from "./record-payments-dialog";
```

- [ ] **Step 2: Update `ProofRow`'s prop type and pill usage**

In the `ProofRow` component (around line 130-136), replace:

```ts
function ProofRow({ t, order, missing, open, onToggle, zoho }: {
  t: ReconTxn;
  order: OrderDetail | undefined;
  missing: boolean;
  open: boolean;
  onToggle: () => void;
  zoho?: ZohoRowStatus;
}) {
```

with:

```ts
function ProofRow({ t, order, missing, open, onToggle, zoho }: {
  t: ReconTxn;
  order: OrderDetail | undefined;
  missing: boolean;
  open: boolean;
  onToggle: () => void;
  zoho?: PaymentRowStatus;
}) {
```

And around line 173, replace:

```tsx
      {zoho && <ZohoRowPill s={zoho} />}
```

with:

```tsx
      {zoho && <PaymentRowPill s={zoho} />}
```

- [ ] **Step 3: Update the `zohoByRef` state type**

Around line 199, replace:

```ts
  const [zohoByRef, setZohoByRef] = useState<Map<string, ZohoRowStatus>>(new Map());
```

with:

```ts
  const [zohoByRef, setZohoByRef] = useState<Map<string, PaymentRowStatus>>(new Map());
```

- [ ] **Step 4: Swap the bar itself**

Around lines 261-266, replace:

```tsx
    <PostToZohoBar
      line={r}
      txns={txns}
      foots={foots}
      onResult={setZohoByRef}
    />
```

with:

```tsx
    <RecordPaymentsBar
      line={r}
      onResult={setZohoByRef}
    />
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (the one remaining reference to `zohoByRef.get(t.ref)` around line 323 already type-checks against `Map<string, PaymentRowStatus>` with no code change needed there).

- [ ] **Step 6: Commit**

```bash
git add components/finance/reconciliation/gateway-proof.tsx
git commit -m "feat: wire RecordPaymentsBar into the payout proof panel"
```

---

### Task 8: Delete the dead WIP scaffold

**Files:**
- Delete: `lib/zoho/client.ts`
- Delete: `lib/zoho/post-payout.ts`
- Delete: `app/api/reconcile/line/[id]/post-to-zoho/route.ts`
- Delete: `components/finance/reconciliation/posttozohobar.tsx`

These four files (all untracked in git, never committed) are the abandoned Books-API duplicate described in the spec: `lib/zoho/client.ts`/`post-payout.ts` talk to an API that 401s under the current token scope, the route's `loadReconLine` returns `null` unconditionally, and `posttozohobar.tsx` (the only consumer of the route) was fully replaced by `record-payments-dialog.tsx` in Tasks 6-7. Nothing else in the codebase imports any of these four files — confirmed by the Task 7 diff removing the last reference (`./posttozohobar`) and by the fact the route imports a module (`@/lib/zoho/post-payout`) that doesn't export what it imports.

- [ ] **Step 1: Confirm nothing else references them**

Run: `grep -rn "posttozohobar\|lib/zoho/client\|lib/zoho/post-payout\|reconcile/line/\[id\]/post-to-zoho" --include="*.ts" --include="*.tsx" app components lib | grep -v "^lib/zoho/\|^components/finance/reconciliation/posttozohobar.tsx\|^app/api/reconcile/line/\[id\]/post-to-zoho/"`

Expected: no output (nothing outside the four files themselves references them).

- [ ] **Step 2: Delete**

```bash
git rm lib/zoho/client.ts lib/zoho/post-payout.ts
git rm app/api/reconcile/line/\[id\]/post-to-zoho/route.ts
git rm components/finance/reconciliation/posttozohobar.tsx
rmdir lib/zoho app/api/reconcile/line/\[id\]/post-to-zoho 2>/dev/null || true
```

- [ ] **Step 3: Type-check and run full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: both pass — no dangling imports, no broken tests.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove dead-end Books-API scaffold superseded by record-payments-dialog"
```

---

### Task 9: Manual end-to-end verification

This is a real-money-writing feature against a live Zoho org. No test harness in this repo exercises the live Zoho/Supabase path (see Tasks 3-5's notes), so this task is the actual correctness check before calling the feature done.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Find a real settled, confirmed line with at least one small-value order**

In the reconciliation UI, open a `SETTLED` line that's already been through "Confirm settlement" (shows "Confirmed by founder"). Prefer a Stripe line with a cheap order, since this posts a real payment to the live Zoho org.

- [ ] **Step 3: Open the dialog and verify the preview**

Click "Record payments." Verify: the order list matches the payout's orders, amounts match `settlement_records.gross_aed`, the deposit account dropdown defaults to the saved `zoho_account_config.bank_account_id` account (shown "(default)"), and the payment-mode summary reads "Credit Card × N" (or includes "Cash on Delivery × M" if any order's gateway is COD).

- [ ] **Step 4: Toggle the custom reference checkbox**

Verify the input field animates in/out smoothly and that typing a value is retained.

- [ ] **Step 5: Submit and verify in Zoho**

Click "Record N payments." Verify: row pills animate to "posted," and in Zoho Books/Inventory itself, the new Customer Payment shows the correct date (the bank credit date, not today, unless they happen to coincide), the correct deposit account, `payment_mode` = "Credit Card" (or "Cash on Delivery" for a COD order), and the invoice's status flips to paid/partially paid as expected.

- [ ] **Step 6: Verify idempotency**

Close and reopen the dialog for the same line. Verify the just-posted orders now show as "posted" from the initial `GET .../settlements` load (not "ready"), and that the footer's postable count excludes them.

- [ ] **Step 7: Verify the gate**

Open a `SETTLED` line that has NOT been confirmed yet. Verify the "Record payments" button is disabled with the explanatory tooltip.

- [ ] **Step 8: Regression-check the journal-transfer flow**

On the same or another settled+confirmed line, verify "Preview & post to Zoho" (the existing, unrelated journal-transfer button) still works exactly as before — confirms the two Zoho actions remain fully independent.

## Self-review

**Spec coverage:** every section of `docs/superpowers/specs/2026-08-12-record-customer-payments-design.md` maps to a task — payment-mode rule (Task 1), date/account/reference passthrough (Task 2), `listByBankLineId` (Task 3), publish route extension (Task 4), settlements preview endpoint (Task 5), dialog UI incl. read-only date / deposit-account dropdown / payment-mode summary / reference checkbox (Task 6), gateway-proof.tsx wiring (Task 7), dead-scaffold deletion (Task 8), and the spec's manual-verification testing note (Task 9). No spec requirement is without a task.

**Placeholder scan:** no TBD/TODO; every step has literal code, not a description of code.

**Type consistency:** `PaymentRowStatus` is defined once (Task 6) and consumed identically in Task 7 (`ProofRow`'s `zoho` prop, `zohoByRef` state) — no renamed variant. `ZohoCustomerPaymentInput`'s three new fields (`date`, `accountId`, `referenceNumberOverride`) are defined in Task 2 and consumed with matching names in Task 4's route. `SettlementsRepository.listByBankLineId` is defined in Task 3 and called with that exact name in Tasks 4 and 5.
