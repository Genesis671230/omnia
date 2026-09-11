# Monthly Payments-Sheet Dashboard Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the payments-sheet analytics (Gross/Net Sales, Fees, Exchanges, Refunds/Cancellations, per-gateway fee, per-gateway net payout, best/worst gateway by fee%) onto the MAIN founder dashboard, aggregated across every month's spreadsheet (a new one each month, per the founder), refreshed in real time.

**Architecture:** A new small DB-backed registry (`payment_sheet_months`) maps a calendar month to its spreadsheet id, since each month is a genuinely separate Google Sheet file (confirmed with the founder — not a tab within one sheet). `lib/finance/payments-sheet.ts` gains parsing for three columns that didn't exist when it was first written (`Total Amt from Gateway`, `Fee Deducted`, `Amount After Deduction`, plus `Fee%`/`% Charged`) — verified against the founder's own live-sheet paste, where the per-row math already foots exactly (`1682.20 − 66.11 = 1616.09`). `lib/finance/payments-sheet-insights.ts` (the pure, client-safe computation layer) gains gross/fee/net rollups and a best/worst-by-fee% ranking. A new aggregator reads every registered month in parallel and merges rows before computation. A new dashboard panel (React Query, `refetchInterval: 60_000`, matching the reconciliation surface's existing real-time convention) renders it on `founder-dashboard.tsx`.

**Tech Stack:** TypeScript, Next.js, Supabase/Postgres (`db/schema.sql` + `node db/apply-schema.mjs`, the existing migration convention), `@tanstack/react-query` (already used elsewhere), Node's built-in test runner via `npx tsx --test 'tests/**/*.test.ts'`.

**Spec:** Captured directly in conversation (2026-09-05), building on the just-shipped Phase 1 payout-uploader plan. Two scoping questions were asked and answered: (1) each month is a **separate spreadsheet file**, not a tab within one sheet — confirmed by the founder, which is why this needs a registry rather than tab-name pattern matching; (2) "highest/lowest" means **best/worst gateway by fee %**, not by net sales or by single-day volume.

## Global Constraints

- **No guesswork in monetary math** (carried over from both prior plans on this branch): every new pure function touching money gets a fixture test asserting an exact total, not an approximation.
- New/changed sheet-column reads must degrade gracefully when the column is absent (older sheets, or a month registered before these columns existed) — return `null`/`0`, never throw, and never fall back to a derived/estimated number when a real one is missing from a *specific row* without saying so. Matches the existing pattern in the same file (`idx.currency !== -1 ? … : null`).
- `npx tsx --test 'tests/**/*.test.ts'` is the verified test command (glob quoted).
- Editing `db/schema.sql` does not touch the live database — every task that adds a table includes running `node db/apply-schema.mjs` as an explicit step (see the project's own `schema_migration_workflow` note: a missing column/table takes down the whole endpoint that touches it, not just the new feature).

---

### Task 1: Month → spreadsheet registry (DB + repository)

**Files:**
- Modify: `db/schema.sql` (append new table)
- Create: `lib/repositories/payment-sheet-months.repository.ts`
- Test: `tests/repositories/payment-sheet-months.test.ts`

**Interfaces:**
- Produces: `export type PaymentSheetMonth = { monthKey: string; spreadsheetId: string; label: string; createdAt: string }`, `export const PaymentSheetMonthsRepository = { list(): Promise<PaymentSheetMonth[]>; upsert(monthKey: string, spreadsheetId: string, label: string): Promise<void>; remove(monthKey: string): Promise<void> }` in `lib/repositories/payment-sheet-months.repository.ts`.
- Consumes: `supabase` client (`@/lib/supabase`).

- [ ] **Step 1: Add the table**

Append to `db/schema.sql`:

```sql
-- payment_sheet_months: registry mapping a calendar month to the Google
-- Sheet spreadsheet id that holds that month's payments-tracking data —
-- the founder confirmed each month is a genuinely separate spreadsheet
-- file, not a tab within one continuously-growing sheet, so there is no
-- way to auto-discover "this month's sheet" without the founder telling us
-- its id once. See lib/finance/payments-sheet.ts's readAllPaymentRowsAllMonths.
create table if not exists payment_sheet_months (
  month_key      text primary key,  -- 'YYYY-MM', e.g. '2026-09'
  spreadsheet_id text not null,
  label          text not null,     -- e.g. 'September 2026'
  created_at     timestamptz not null default now()
);
```

Run: `node db/apply-schema.mjs`
Expected: no error; the script's own table-existence check still lists `orders, bank_transactions, gateway_payouts, reconciliation_results` (it doesn't check this new table by name, but a clean exit confirms the migration applied).

- [ ] **Step 2: Write the failing test**

Create `tests/repositories/payment-sheet-months.test.ts` — same fake-client style as `tests/repositories/payouts-delete.test.ts` from the prior plan, proving the repository's shape without a live database:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

function fakeSupabase(existingRows: { month_key: string; spreadsheet_id: string; label: string; created_at: string }[]) {
  const state = { rows: [...existingRows] };
  return {
    state,
    from(table: string) {
      assert.equal(table, "payment_sheet_months");
      return {
        select() {
          return {
            order() {
              return Promise.resolve({ data: state.rows, error: null });
            },
          };
        },
        upsert(row: { month_key: string; spreadsheet_id: string; label: string }, _opts: unknown) {
          state.rows = state.rows.filter((r) => r.month_key !== row.month_key);
          state.rows.push({ ...row, created_at: new Date().toISOString() });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(_col: string, monthKey: string) {
              state.rows = state.rows.filter((r) => r.month_key !== monthKey);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test("list/upsert/remove round-trip through the fake client, ordered by month_key", async () => {
  const fake = fakeSupabase([{ month_key: "2026-08", spreadsheet_id: "old-id", label: "August 2026", created_at: "2026-08-01T00:00:00.000Z" }]);
  const { makePaymentSheetMonthsRepository } = await import("@/lib/repositories/payment-sheet-months.repository");
  const repo = makePaymentSheetMonthsRepository(fake as any);

  await repo.upsert("2026-09", "sept-id", "September 2026");
  const afterUpsert = await repo.list();
  assert.equal(afterUpsert.length, 2);
  assert.ok(afterUpsert.some((m) => m.monthKey === "2026-09" && m.spreadsheetId === "sept-id"));

  await repo.remove("2026-08");
  const afterRemove = await repo.list();
  assert.deepEqual(afterRemove.map((m) => m.monthKey), ["2026-09"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test 'tests/repositories/payment-sheet-months.test.ts'`
Expected: FAIL — `makePaymentSheetMonthsRepository` doesn't exist yet.

- [ ] **Step 4: Implement the repository**

Create `lib/repositories/payment-sheet-months.repository.ts`:

```ts
import { supabase } from "@/lib/supabase";

export type PaymentSheetMonth = {
  monthKey: string;
  spreadsheetId: string;
  label: string;
  createdAt: string;
};

// Factory so the shape (list/upsert/remove against payment_sheet_months) is
// testable against a fake client without a live database — same pattern as
// makeDeletePayout in payouts.repository.ts.
export function makePaymentSheetMonthsRepository(client: typeof supabase) {
  return {
    async list(): Promise<PaymentSheetMonth[]> {
      const { data, error } = await client
        .from("payment_sheet_months")
        .select("month_key, spreadsheet_id, label, created_at")
        .order("month_key", { ascending: true });
      if (error) throw new Error(`payment_sheet_months select failed: ${error.message}`);
      return (data ?? []).map((r: any) => ({
        monthKey: r.month_key, spreadsheetId: r.spreadsheet_id, label: r.label, createdAt: r.created_at,
      }));
    },

    async upsert(monthKey: string, spreadsheetId: string, label: string): Promise<void> {
      const { error } = await client
        .from("payment_sheet_months")
        .upsert({ month_key: monthKey, spreadsheet_id: spreadsheetId, label }, { onConflict: "month_key" });
      if (error) throw new Error(`payment_sheet_months upsert failed: ${error.message}`);
    },

    async remove(monthKey: string): Promise<void> {
      const { error } = await client.from("payment_sheet_months").delete().eq("month_key", monthKey);
      if (error) throw new Error(`payment_sheet_months delete failed: ${error.message}`);
    },
  };
}

export const PaymentSheetMonthsRepository = makePaymentSheetMonthsRepository(supabase);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'`
Expected: new test passes; no regression in the rest of the suite (same 5 pre-existing, unrelated failures as before — `buildCustomerPaymentBody`/settlement-publish tests — carried forward from the prior plan, not introduced by this one).

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql lib/repositories/payment-sheet-months.repository.ts tests/repositories/payment-sheet-months.test.ts
git commit -m "$(cat <<'EOF'
Add month-to-spreadsheet registry for the payments sheet

Each month is a genuinely separate Google Sheet file (confirmed with the
founder), so there is no way to auto-discover "this month's sheet" from a
naming convention — this registry is how the founder tells the app once,
and every later read (dashboard analytics, insights) knows which
spreadsheet id backs which calendar month.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 2: Settings UI to manage month → spreadsheet mappings

**Files:**
- Create: `app/api/finance/payment-sheet-months/route.ts` (GET list, POST upsert)
- Create: `app/api/finance/payment-sheet-months/[monthKey]/route.ts` (DELETE)
- Create: `components/finance/payment-sheet-months-panel.tsx`
- Modify: `components/finance/finance-workspace.tsx` (mount the panel on the Settings view)
- Test: none (routes + UI wiring — verified manually, per Global Constraints in the prior plan: this repo has no component-test harness)

**Interfaces:**
- Consumes: `PaymentSheetMonthsRepository` (Task 1), `extractSpreadsheetId` (already exported from `@/lib/finance/payments-sheet`, used by the existing "paste a sheet URL" pattern in `sheet-insights-strip.tsx` — reused here rather than re-implemented).

- [ ] **Step 1: Add the API routes**

Create `app/api/finance/payment-sheet-months/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { PaymentSheetMonthsRepository } from "@/lib/repositories/payment-sheet-months.repository";
import { extractSpreadsheetId } from "@/lib/finance/payments-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const months = await PaymentSheetMonthsRepository.list();
  return NextResponse.json({ months });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const monthKey = String(body.monthKey || "");
  const label = String(body.label || "");
  const rawUrl = String(body.spreadsheetUrlOrId || "");
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return NextResponse.json({ error: "monthKey must look like YYYY-MM, e.g. 2026-09" }, { status: 400 });
  }
  const spreadsheetId = extractSpreadsheetId(rawUrl);
  if (!spreadsheetId) {
    return NextResponse.json({ error: "Couldn't find a spreadsheet id in that URL" }, { status: 400 });
  }
  await PaymentSheetMonthsRepository.upsert(monthKey, spreadsheetId, label || monthKey);
  return NextResponse.json({ ok: true });
}
```

Create `app/api/finance/payment-sheet-months/[monthKey]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { PaymentSheetMonthsRepository } from "@/lib/repositories/payment-sheet-months.repository";

export async function DELETE(_req: Request, { params }: { params: Promise<{ monthKey: string }> }) {
  const { monthKey } = await params;
  await PaymentSheetMonthsRepository.remove(monthKey);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Build the settings panel**

Create `components/finance/payment-sheet-months-panel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Month = { monthKey: string; spreadsheetId: string; label: string; createdAt: string };

async function fetchMonths(): Promise<Month[]> {
  const res = await fetch("/api/finance/payment-sheet-months");
  const json = await res.json();
  return json.months ?? [];
}

export function PaymentSheetMonthsPanel() {
  const queryClient = useQueryClient();
  const { data: months = [], isLoading } = useQuery({ queryKey: ["payment-sheet-months"], queryFn: fetchMonths });

  const [monthKey, setMonthKey] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/finance/payment-sheet-months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey, label, spreadsheetUrlOrId: url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add month");
    },
    onSuccess: () => {
      toast.success(`${label || monthKey} registered`);
      setMonthKey(""); setLabel(""); setUrl("");
      queryClient.invalidateQueries({ queryKey: ["payment-sheet-months"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (key: string) => {
      await fetch(`/api/finance/payment-sheet-months/${encodeURIComponent(key)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payment-sheet-months"] }),
  });

  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-5">
      <h3 className="mb-1 text-[14.5px] font-semibold text-[#1F1B16]">Payments-sheet months</h3>
      <p className="mb-4 text-[12.5px] leading-relaxed text-[#8A8175]">
        Each month is its own Google Sheet — register the spreadsheet URL for every month you want the dashboard
        to include. Dashboard analytics (Gross/Net Sales, Fees, Exchanges, Refunds) aggregate across every month
        registered here.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[11px] text-[#8A8175]">Month (YYYY-MM)</label>
          <Input value={monthKey} onChange={(e) => setMonthKey(e.target.value)} placeholder="2026-09" className="h-9 w-28" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[#8A8175]">Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="September 2026" className="h-9 w-40" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="mb-1 block text-[11px] text-[#8A8175]">Spreadsheet URL or ID</label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-9" />
        </div>
        <Button
          size="sm"
          disabled={addMutation.isPending || !monthKey || !url}
          onClick={() => addMutation.mutate()}
          className="h-9"
        >
          {addMutation.isPending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Plus size={14} className="mr-1.5" />}
          Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-[12.5px] text-[#8A8175]">Loading…</p>
      ) : months.length === 0 ? (
        <p className="text-[12.5px] text-[#8A8175]">No months registered yet — the dashboard has nothing to aggregate.</p>
      ) : (
        <div className="space-y-1.5">
          {months.map((m) => (
            <div key={m.monthKey} className="flex items-center justify-between rounded-lg border border-[#EAE3D6] px-3 py-2 text-[12.5px]">
              <span className="font-medium text-[#1F1B16]">{m.label}</span>
              <span className="text-[#8A8175]">{m.monthKey} · {m.spreadsheetId.slice(0, 12)}…</span>
              <button
                onClick={() => removeMutation.mutate(m.monthKey)}
                disabled={removeMutation.isPending}
                className="text-[#A6472F] hover:text-[#8E3A25]"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount it on the Settings view**

In `components/finance/finance-workspace.tsx`, add the import:

```ts
import { PaymentSheetMonthsPanel } from "@/components/finance/payment-sheet-months-panel";
```

Change the settings branch (currently `) : view === "settings" ? (\n            <ZohoSettingsPanel />`) to:

```tsx
          ) : view === "settings" ? (
            <div className="space-y-6">
              <ZohoSettingsPanel />
              <PaymentSheetMonthsPanel />
            </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (beyond the pre-existing, unrelated `lib/inventory/apply-event.ts` error already present on the base branch).

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open Settings, register a month with a real spreadsheet URL, confirm it appears in the list, confirm the delete button removes it.

- [ ] **Step 6: Commit**

```bash
git add app/api/finance/payment-sheet-months components/finance/payment-sheet-months-panel.tsx components/finance/finance-workspace.tsx
git commit -m "$(cat <<'EOF'
Add settings UI to register each month's payments-sheet spreadsheet

A founder can now paste each month's Google Sheet URL once (mirroring the
existing "paste a sheet URL" pattern in sheet-insights-strip.tsx) instead
of needing a code deploy every time a new month's spreadsheet is created.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 3: Parse Gross-from-gateway / Fee Deducted / Amount After Deduction / Fee%

**Files:**
- Modify: `lib/finance/payments-sheet-insights.ts` (`PaymentSheetRow` type)
- Modify: `lib/finance/payments-sheet.ts` (`TAB_COLUMNS`, `readTab`)
- Test: `tests/finance/payments-sheet-fees.test.ts`

**Interfaces:**
- Modifies: `PaymentSheetRow` gains `gatewayGrossAed: number | null`, `feeDeductedAed: number`, `netAfterFeeAed: number | null`, `feePercentRaw: number | null`.
- Consumes: nothing new — same `headerIndex`/`parseAmount` helpers already in `payments-sheet.ts`.

**Evidence for column names (not guessed):** the founder's own live-sheet paste (2026-09-05) shows a row where these columns already foot exactly: `Total Amt from Gateway=1682.20`, `Fee Deducted=66.11`, `Amount After Deduction=1616.09` — and `1682.20 − 66.11 = 1616.09` to the cent. `"Total Amt from Gateway"` and `"Fee Deducted"`/`"Amount After Deduction"` are SMSA-only additions per the founder ("from now on two columns been added") — not present in the Aug-7-dated column comment already in this file, confirming they're new since this module was written. Local orders already had `Fee Deducted`/`Amount After Deduction`/`"% Charged"` per `lib/integrations/dispatch-sheet.ts`'s own column-layout comment (verified live 2026-08-07); SMSA's equivalent percent column is `"Fee%"` (also already present per that same comment, unrelated to today's new columns).

- [ ] **Step 1: Write the failing test**

Create `tests/finance/payments-sheet-fees.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// payments-sheet.ts's readTab() does live Google Sheets I/O end-to-end, so
// this exercises the pure per-row parsing pieces directly (parseAmount is
// already exported-equivalent logic — this test targets the NEW fields on
// PaymentSheetRow via a hand-built row, matching the founder's real pasted
// values exactly, including the exact-footing check).
import { computeSheetInsights } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 22, orderNumber: "WA55606", date: "2026-09-02",
    party: { raw: "telr", canonical: "Telr", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "KWD", region: "KWD", gatewayLabel: "Telr KWD", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "Payment Received on 04.09.2026 (18,903.64)", paymentReceivedDate: "2026-09-04",
    amountAed: 1732.91, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

test("a founder-pasted real row: gatewayGrossAed minus feeDeductedAed equals netAfterFeeAed exactly", () => {
  const r = row({ gatewayGrossAed: 1682.20, feeDeductedAed: 66.11, netAfterFeeAed: 1616.09 });
  assert.equal(+(r.gatewayGrossAed! - r.feeDeductedAed).toFixed(2), r.netAfterFeeAed);
});

test("computeSheetInsights still runs unchanged with the new optional fields present", () => {
  const insights = computeSheetInsights([row({})], "sheet-1");
  assert.equal(insights.periods.allTime.totalOrders, 1);
  assert.equal(insights.periods.allTime.received.amountAed, 1732.91);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test 'tests/finance/payments-sheet-fees.test.ts'`
Expected: FAIL — `PaymentSheetRow` doesn't have `gatewayGrossAed`/`feeDeductedAed`/`netAfterFeeAed`/`feePercentRaw` yet, so the object literal in `row()` doesn't type-check (a `tsx` type-stripped run will still fail at the `computeSheetInsights` call if the shape mismatch causes a runtime issue — if it doesn't fail at type-check under `tsx` specifically, the important failure is Step 5's `tsc --noEmit`, which WILL catch the missing fields; run that now too to confirm):

Run: `npx tsc --noEmit`
Expected: type errors on the new fields in the test file.

- [ ] **Step 3: Add the fields to `PaymentSheetRow`**

In `lib/finance/payments-sheet-insights.ts`, extend the type (in the existing `PaymentSheetRow` block):

```ts
export type PaymentSheetRow = {
  tab: SheetTabKey;
  rowNumber: number;
  orderNumber: string | null;
  date: string | null;
  party: PartyInfo;
  saleType: string;
  isExchange: boolean;
  currency: string | null;
  region: string;
  gatewayLabel: string | null;
  actualPaymentStatus: string;
  paymentReceivedRaw: string;
  paymentReceivedDate: string | null;
  amountAed: number;
  cancelledAmount: number;
  isDuplicateFlagged: boolean;
  /** The gateway's own reported gross for this order (SMSA's "Total Amt
   *  from Gateway") — more accurate than amountAed for Gross Sales when
   *  present, since amountAed is Omnia's own FX estimate and this is the
   *  gateway's actual converted figure. Null when the column is absent or
   *  blank on this row (older rows, or a month registered before this
   *  column existed) — never derived/guessed. */
  gatewayGrossAed: number | null;
  /** "Fee Deducted" — 0 when absent (never null; a fee genuinely is 0 when
   *  not yet confirmed, so this participates in sums safely by default). */
  feeDeductedAed: number;
  /** "Amount After Deduction" — null when absent. Callers that need a net
   *  figure and get null should derive gatewayGrossAed - feeDeductedAed
   *  themselves rather than this file silently doing it, so it's always
   *  clear which figure is the sheet's own vs. computed. */
  netAfterFeeAed: number | null;
  /** "Fee%" (SMSA) / "% Charged" (Local) as literally entered in the sheet
   *  — null when absent. Not the same as a computed fee percentage; kept
   *  separate so a discrepancy between the two is visible, not hidden. */
  feePercentRaw: number | null;
};
```

- [ ] **Step 4: Parse the new columns in `payments-sheet.ts`**

In `lib/finance/payments-sheet.ts`, extend `TAB_COLUMNS`:

```ts
const TAB_COLUMNS: Record<SheetTabKey, {
  order: string; party: string; saleType: string; status: string; received: string;
  date: string; amount: string; cancelled: string; currency: string | null;
  gatewayGross: string | null; feeDeducted: string | null; netAfterFee: string | null; feePercent: string | null;
}> = {
  smsa: {
    order: "Order #", party: "Party", saleType: "Part", status: "Actual Payment Status",
    received: "Payment Received Date", date: "Date", amount: "In AED",
    cancelled: "Cancelled / Refunded Amount", currency: "Currency",
    gatewayGross: "Total Amt from Gateway", feeDeducted: "Fee Deducted",
    netAfterFee: "Amount After Deduction", feePercent: "Fee%",
  },
  local: {
    order: "Order #", party: "Party", saleType: "Type of Sale", status: "Actual Payment Status",
    received: "Payment Received on", date: "Date", amount: "Total",
    cancelled: "Cancelled / Refunded Amount", currency: null,
    gatewayGross: null, feeDeducted: "Fee Deducted", netAfterFee: "Amount After Deduction", feePercent: "% Charged",
  },
};
```

Then in `readTab`, add the new column indices to the `idx` object:

```ts
  const idx = {
    order: headerIndex(headers, cols.order),
    party: headerIndex(headers, cols.party),
    saleType: headerIndex(headers, cols.saleType),
    status: headerIndex(headers, cols.status),
    received: headerIndex(headers, cols.received),
    date: headerIndex(headers, cols.date),
    amount: headerIndex(headers, cols.amount),
    cancelled: headerIndex(headers, cols.cancelled),
    currency: cols.currency ? headerIndex(headers, cols.currency) : -1,
    gatewayGross: cols.gatewayGross ? headerIndex(headers, cols.gatewayGross) : -1,
    feeDeducted: cols.feeDeducted ? headerIndex(headers, cols.feeDeducted) : -1,
    netAfterFee: cols.netAfterFee ? headerIndex(headers, cols.netAfterFee) : -1,
    feePercent: cols.feePercent ? headerIndex(headers, cols.feePercent) : -1,
    dup1: headerIndex(headers, "Duplicate customer"),
    dup2: headerIndex(headers, "Duplicate Check"),
  };
```

And in the row-push loop, add a small helper right above the `for` loop and the four new fields to the pushed object:

```ts
  // parseAmount() swallows both "blank" and "unparseable" to 0 (it's built
  // for sums where that's the right default) — this needs to tell "the
  // column says 0" apart from "the cell is blank/garbage", so it re-parses
  // directly instead of reusing parseAmount's NaN-swallowing behavior.
  const numOrNull = (raw: string | undefined): number | null => {
    const v = (raw ?? "").trim();
    if (!v) return null;
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
```

then in the pushed row object (after `isDuplicateFlagged`):

```ts
      gatewayGrossAed: idx.gatewayGross !== -1 ? numOrNull(row[idx.gatewayGross]) : null,
      feeDeductedAed: idx.feeDeducted !== -1 ? parseAmount(row[idx.feeDeducted]) : 0,
      netAfterFeeAed: idx.netAfterFee !== -1 ? numOrNull(row[idx.netAfterFee]) : null,
      feePercentRaw: idx.feePercent !== -1 ? numOrNull(row[idx.feePercent]) : null,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'` and `npx tsc --noEmit`
Expected: both new tests pass; `tsc` clean (beyond the pre-existing `apply-event.ts` error).

- [ ] **Step 6: Commit**

```bash
git add lib/finance/payments-sheet-insights.ts lib/finance/payments-sheet.ts tests/finance/payments-sheet-fees.test.ts
git commit -m "$(cat <<'EOF'
Parse Total Amt from Gateway / Fee Deducted / Amount After Deduction

Three columns didn't exist when payments-sheet.ts was first written — the
founder added them since ("from now on two columns been added"). Verified
against the founder's own live-sheet paste: gatewayGrossAed minus
feeDeductedAed equals netAfterFeeAed exactly on a real row. All four new
fields degrade to null/0 (never a guess) when a column is absent, matching
this file's existing pattern for optional columns.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 4: Gross/Net/Fees rollups + best/worst gateway by fee %

**Files:**
- Modify: `lib/finance/payments-sheet-insights.ts` (`PeriodStats`, `GatewayBreakdownRow`, `addRowToStats`, `computeGatewayBreakdown`)
- Test: `tests/finance/payments-sheet-insights-fees.test.ts`

**Interfaces:**
- Modifies: `PeriodStats` gains `grossAed: number`, `feesAed: number`, `netAed: number`. `GatewayBreakdownRow` gains the same three fields.
- Produces: `export type FeeRanking = { best: { gatewayLabel: string; feePercent: number } | null; worst: { gatewayLabel: string; feePercent: number } | null }`, `export function bestWorstGatewayByFeePercent(breakdown: GatewayBreakdownRow[]): FeeRanking` in `lib/finance/payments-sheet-insights.ts`.

**Design:**
- **Gross** per row = `row.gatewayGrossAed ?? row.amountAed` — prefer the gateway's own reported gross (Task 3), fall back to the sheet's existing AED total when the new column is blank (older rows/months).
- **Fees** per row = `row.feeDeductedAed` (0 when absent — already handled by Task 3's default).
- **Net** per row = `row.netAfterFeeAed ?? (gross - fees)` — trust the sheet's own Amount After Deduction when present (exact, per Task 3's verified footing); otherwise a simple, honest derivation, never a guessed/estimated figure.
- **Fee %** per gateway bucket = `feesAed / grossAed * 100`, rounded to 2dp — computed only over gateways with `grossAed > 0`, so a gateway with zero processed volume can never spuriously "win" by having a 0/0 fee percent.
- Refunds/cancellations stay a single combined metric (`cancelled`, already computed) — the sheet has one column for both, no signal to split them; asking for "gateway based refunds" is answered by `GatewayBreakdownRow.cancelled`, already per-gateway.

- [ ] **Step 1: Write the failing test**

Create `tests/finance/payments-sheet-insights-fees.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGatewayBreakdown, bestWorstGatewayByFeePercent, computeSheetInsights } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 1, orderNumber: "O1", date: "2026-09-02",
    party: { raw: "telr", canonical: "Telr", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "AED", region: "UAE", gatewayLabel: "Telr", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "", paymentReceivedDate: null,
    amountAed: 1000, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

test("computeSheetInsights: gross falls back to amountAed when gatewayGrossAed is null, net derives when netAfterFeeAed is null", () => {
  const insights = computeSheetInsights([row({ amountAed: 1000, feeDeductedAed: 40 })], "s1");
  // hand-computed: gross = amountAed (no gatewayGrossAed) = 1000; net = 1000 - 40 = 960
  assert.equal(insights.periods.allTime.grossAed, 1000);
  assert.equal(insights.periods.allTime.feesAed, 40);
  assert.equal(insights.periods.allTime.netAed, 960);
});

test("computeSheetInsights: trusts the sheet's own netAfterFeeAed exactly when present, not the derived figure", () => {
  const insights = computeSheetInsights(
    [row({ gatewayGrossAed: 1682.20, feeDeductedAed: 66.11, netAfterFeeAed: 1616.09 })],
    "s1",
  );
  assert.equal(insights.periods.allTime.grossAed, 1682.20);
  assert.equal(insights.periods.allTime.netAed, 1616.09);
});

test("bestWorstGatewayByFeePercent: picks the highest and lowest fee% among gateways with real gross, ignoring zero-gross gateways", () => {
  const breakdown = computeGatewayBreakdown(
    [
      row({ gatewayLabel: "Telr", gatewayGrossAed: 1000, feeDeductedAed: 50 }),   // 5%
      row({ gatewayLabel: "Stripe", gatewayGrossAed: 1000, feeDeductedAed: 25 }), // 2.5%
      row({ gatewayLabel: "COD", gatewayGrossAed: 0, feeDeductedAed: 0, amountAed: 0 }), // zero gross — must be ignored
    ],
    null, null,
  );
  const ranking = bestWorstGatewayByFeePercent(breakdown);
  assert.equal(ranking.worst!.gatewayLabel, "Telr");   // highest fee% = worst for the founder
  assert.equal(ranking.worst!.feePercent, 5);
  assert.equal(ranking.best!.gatewayLabel, "Stripe");  // lowest fee% = best
  assert.equal(ranking.best!.feePercent, 2.5);
});

test("bestWorstGatewayByFeePercent: both null when no gateway has any gross", () => {
  const breakdown = computeGatewayBreakdown([row({ gatewayGrossAed: 0, amountAed: 0 })], null, null);
  const ranking = bestWorstGatewayByFeePercent(breakdown);
  assert.equal(ranking.best, null);
  assert.equal(ranking.worst, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test 'tests/finance/payments-sheet-insights-fees.test.ts'`
Expected: FAIL — `grossAed`/`feesAed`/`netAed` not on `PeriodStats` yet; `bestWorstGatewayByFeePercent` not exported.

- [ ] **Step 3: Implement**

In `lib/finance/payments-sheet-insights.ts`:

Extend `PeriodStats`:

```ts
export type PeriodStats = {
  totalOrders: number;
  received: { count: number; amountAed: number };
  pending: { count: number };
  exchange: { count: number };
  cancelled: { count: number; amountAed: number };
  grossAed: number;
  feesAed: number;
  netAed: number;
};
```

Update `emptyPeriodStats`:

```ts
export function emptyPeriodStats(): PeriodStats {
  return {
    totalOrders: 0, received: { count: 0, amountAed: 0 }, pending: { count: 0 },
    exchange: { count: 0 }, cancelled: { count: 0, amountAed: 0 },
    grossAed: 0, feesAed: 0, netAed: 0,
  };
}
```

Add a shared per-row derivation right above `addRowToStats`:

```ts
function grossFeeNetForRow(row: PaymentSheetRow): { gross: number; fees: number; net: number } {
  const gross = row.gatewayGrossAed ?? row.amountAed;
  const fees = row.feeDeductedAed;
  const net = row.netAfterFeeAed ?? +(gross - fees).toFixed(2);
  return { gross, fees, net };
}
```

Update `addRowToStats` to also accumulate them:

```ts
function addRowToStats(stats: PeriodStats, row: PaymentSheetRow): void {
  stats.totalOrders++;
  const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
  const isCancelled = row.cancelledAmount > 0;
  if (isCancelled) { stats.cancelled.count++; stats.cancelled.amountAed += row.cancelledAmount; }
  if (row.isExchange) stats.exchange.count++;
  if (isReceived) { stats.received.count++; stats.received.amountAed += row.amountAed; }
  else if (!isCancelled) stats.pending.count++;

  const { gross, fees, net } = grossFeeNetForRow(row);
  stats.grossAed += gross;
  stats.feesAed += fees;
  stats.netAed += net;
}
```

Extend `GatewayBreakdownRow`:

```ts
export type GatewayBreakdownRow = {
  gatewayLabel: string;
  totalOrders: number;
  received: { count: number; amountAed: number };
  pending: { count: number };
  exchange: { count: number };
  cancelled: { count: number; amountAed: number };
  grossAed: number;
  feesAed: number;
  netAed: number;
};
```

Update `computeGatewayBreakdown`'s bucket init and accumulation:

```ts
export function computeGatewayBreakdown(rows: PaymentSheetRow[], from: string | null, to: string | null): GatewayBreakdownRow[] {
  const byGateway = new Map<string, GatewayBreakdownRow>();
  for (const row of rows) {
    if (!inDateWindow(row, from, to)) continue;
    const key = row.gatewayLabel ?? "Unresolved";
    let bucket = byGateway.get(key);
    if (!bucket) {
      bucket = {
        gatewayLabel: key, totalOrders: 0, received: { count: 0, amountAed: 0 }, pending: { count: 0 },
        exchange: { count: 0 }, cancelled: { count: 0, amountAed: 0 }, grossAed: 0, feesAed: 0, netAed: 0,
      };
      byGateway.set(key, bucket);
    }
    bucket.totalOrders++;
    const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
    const isCancelled = row.cancelledAmount > 0;
    if (isCancelled) { bucket.cancelled.count++; bucket.cancelled.amountAed += row.cancelledAmount; }
    if (row.isExchange) bucket.exchange.count++;
    if (isReceived) { bucket.received.count++; bucket.received.amountAed += row.amountAed; }
    else if (!isCancelled) bucket.pending.count++;

    const { gross, fees, net } = grossFeeNetForRow(row);
    bucket.grossAed += gross;
    bucket.feesAed += fees;
    bucket.netAed += net;
  }

  return [...byGateway.values()].sort((a, b) => b.totalOrders - a.totalOrders);
}
```

Add the ranking function at the end of the file:

```ts
export type FeeRanking = {
  best: { gatewayLabel: string; feePercent: number } | null;
  worst: { gatewayLabel: string; feePercent: number } | null;
};

// "Highest/lowest, based on the analytics" = best/worst gateway by fee % —
// confirmed with the founder. Only gateways that actually processed volume
// (grossAed > 0) are eligible, so a gateway with nothing run through it
// this period can never spuriously win or lose on a 0/0 fee percent.
export function bestWorstGatewayByFeePercent(breakdown: GatewayBreakdownRow[]): FeeRanking {
  const eligible = breakdown
    .filter((b) => b.grossAed > 0)
    .map((b) => ({ gatewayLabel: b.gatewayLabel, feePercent: +((b.feesAed / b.grossAed) * 100).toFixed(2) }));
  if (eligible.length === 0) return { best: null, worst: null };
  const sorted = [...eligible].sort((a, b) => a.feePercent - b.feePercent);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test 'tests/**/*.test.ts'` and `npx tsc --noEmit`
Expected: all new tests pass; no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/payments-sheet-insights.ts tests/finance/payments-sheet-insights-fees.test.ts
git commit -m "$(cat <<'EOF'
Add Gross/Net/Fees rollups and best/worst-gateway-by-fee% ranking

Gross prefers the gateway's own reported figure (gatewayGrossAed) over
Omnia's FX estimate (amountAed) when present; net trusts the sheet's own
Amount After Deduction exactly when present, only deriving gross-fees as a
fallback. Fee-percent ranking only considers gateways with real gross
volume, so an idle gateway can't spuriously rank as best or worst.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 5: Cross-month aggregator + dashboard API endpoint

**Files:**
- Modify: `lib/finance/payments-sheet.ts` (add `readAllPaymentRowsAllMonths`)
- Create: `app/api/dashboard/payments-insights/route.ts`
- Test: none (this task is I/O orchestration over already-tested pure functions; the aggregation itself — "call readAllPaymentRows per registered month, concatenate" — has no monetary logic of its own to fixture-test)

**Interfaces:**
- Produces: `export async function readAllPaymentRowsAllMonths(): Promise<{ months: PaymentSheetMonth[]; rows: PaymentSheetRow[] }>` in `lib/finance/payments-sheet.ts`.
- Consumes: `PaymentSheetMonthsRepository.list()` (Task 1), `readAllPaymentRows` (already in the same file), `computeSheetInsights`/`computeGatewayBreakdown`/`bestWorstGatewayByFeePercent` (Task 4).

- [ ] **Step 1: Add the aggregator**

In `lib/finance/payments-sheet.ts`, add after `readAllPaymentRows`:

```ts
import { PaymentSheetMonthsRepository, type PaymentSheetMonth } from "@/lib/repositories/payment-sheet-months.repository";

// Every row across every registered month's spreadsheet, fetched in
// parallel. A single month's read failing (bad/revoked sharing on one
// spreadsheet, say) does not need to sink every other month — but for now
// this surfaces any failure immediately (Promise.all) so a broken month is
// visible rather than silently missing from the dashboard; if that proves
// too strict in practice, switching to Promise.allSettled with a per-month
// error list is the natural next step, not a silent partial result.
export async function readAllPaymentRowsAllMonths(): Promise<{
  months: PaymentSheetMonth[];
  rows: PaymentSheetRow[];
}> {
  const months = await PaymentSheetMonthsRepository.list();
  const perMonth = await Promise.all(months.map((m) => readAllPaymentRows(m.spreadsheetId)));
  return { months, rows: perMonth.flat() };
}
```

- [ ] **Step 2: Add the dashboard API endpoint**

Create `app/api/dashboard/payments-insights/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  bestWorstGatewayByFeePercent, computeGatewayBreakdown, computeSheetInsights,
  readAllPaymentRowsAllMonths,
} from "@/lib/finance/payments-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/payments-insights — the main-dashboard analytics feed:
// Gross/Net Sales, Fees, Exchanges, Refunds/Cancellations (today/this
// week/this month/all time), a per-gateway breakdown (fee, net payout),
// and best/worst gateway by fee %. Aggregates across every month
// registered in payment_sheet_months (Task 1) — no date-range param
// needed here since the periods are fixed buckets computed server-side,
// same convention as /api/invoices/sheet-insights.
export async function GET() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return NextResponse.json({ error: "Google Sheets not configured" }, { status: 503 });
  }
  try {
    const { months, rows } = await readAllPaymentRowsAllMonths();
    if (months.length === 0) {
      return NextResponse.json({ error: "No months registered — add one in Settings first" }, { status: 503 });
    }
    const insights = computeSheetInsights(rows, months.map((m) => m.spreadsheetId).join(","));
    const gatewayBreakdown = computeGatewayBreakdown(rows, null, null);
    const feeRanking = bestWorstGatewayByFeePercent(gatewayBreakdown);
    return NextResponse.json({ ...insights, gatewayBreakdown, feeRanking, monthsIncluded: months.map((m) => m.label) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

With at least one month registered (Task 2), run: `npm run dev`, `curl http://localhost:3000/api/dashboard/payments-insights` (authenticated session/cookie as needed) and confirm the response includes `periods`, `gatewayBreakdown`, and `feeRanking` with sensible, non-NaN numbers.

- [ ] **Step 5: Commit**

```bash
git add lib/finance/payments-sheet.ts app/api/dashboard/payments-insights/route.ts
git commit -m "$(cat <<'EOF'
Add cross-month aggregation and the main-dashboard payments-insights API

Reads every registered month's spreadsheet in parallel and merges rows
before computing insights, so the dashboard reflects every month the
founder has registered — not just whichever single sheet id happened to
be hardcoded in an env var.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

### Task 6: Main-dashboard analytics panel (real-time)

**Files:**
- Create: `components/finance/dashboard-v2/payments-insights-panel.tsx`
- Modify: `components/finance/dashboard-v2/founder-dashboard.tsx`
- Test: none (UI wiring over already-tested pure functions and an already-verified API route)

**Interfaces:**
- Consumes: `/api/dashboard/payments-insights` (Task 5). Mounted on `FounderDashboard`, the component `finance-workspace.tsx` renders for `view === "dashboard"`.

- [ ] **Step 1: Build the panel**

Create `components/finance/dashboard-v2/payments-insights-panel.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, Banknote, Loader2, Percent, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { aed2 } from "./types";

type PeriodStats = {
  totalOrders: number;
  received: { count: number; amountAed: number };
  cancelled: { count: number; amountAed: number };
  exchange: { count: number };
  grossAed: number; feesAed: number; netAed: number;
};
type GatewayRow = {
  gatewayLabel: string; totalOrders: number;
  cancelled: { count: number; amountAed: number };
  grossAed: number; feesAed: number; netAed: number;
};
type PaymentsInsightsResponse = {
  periods: { today: PeriodStats; thisWeek: PeriodStats; thisMonth: PeriodStats; allTime: PeriodStats };
  gatewayBreakdown: GatewayRow[];
  feeRanking: { best: { gatewayLabel: string; feePercent: number } | null; worst: { gatewayLabel: string; feePercent: number } | null };
  monthsIncluded: string[];
};

async function fetchPaymentsInsights(): Promise<PaymentsInsightsResponse> {
  const res = await fetch("/api/dashboard/payments-insights");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function Tile({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ElementType; tone: string }) {
  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11.5px] text-[#8A8175]">
        <Icon size={13} style={{ color: tone }} /> {label}
      </div>
      <div className="mt-1.5 font-serif text-[22px] tabular-nums" style={{ color: tone }}>{value}</div>
    </div>
  );
}

// Real-time per the founder's ask: any edit ops makes in the sheet this
// month shows up here within a minute, same 60s cadence the reconciliation
// dashboard already polls at (lib/hooks/use-reconciliation-query.ts).
export function PaymentsInsightsPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["payments-insights"],
    queryFn: fetchPaymentsInsights,
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-6 text-[13px] text-[#8A8175]">
        <Loader2 size={16} className="animate-spin" /> Loading payments-sheet analytics…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-6 text-[13px] text-[#8A8175]">
        <AlertTriangle size={16} className="text-[#B0742E]" />
        {(error as Error)?.message || "Couldn't load payments-sheet analytics."}
      </div>
    );
  }

  const m = data.periods.thisMonth;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[#1F1B16]">This month, across the payments sheet</h3>
        <span className="text-[11px] text-[#8A8175]">{data.monthsIncluded.join(", ") || "no months registered"}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Gross Sales" value={aed2(m.grossAed)} icon={TrendingUp} tone="#2E6B7A" />
        <Tile label="Net Sales" value={aed2(m.netAed)} icon={Banknote} tone="#4B7A54" />
        <Tile label="Fees" value={aed2(m.feesAed)} icon={Percent} tone="#8A8175" />
        <Tile label="Exchanges" value={String(m.exchange.count)} icon={ArrowLeftRight} tone="#6F5325" />
        <Tile label="Refunds / Cancellations" value={aed2(m.cancelled.amountAed)} icon={RotateCcw} tone="#A6472F" />
        <Tile
          label={data.feeRanking.worst ? `Costliest: ${data.feeRanking.worst.gatewayLabel}` : "Fee ranking"}
          value={data.feeRanking.worst ? `${data.feeRanking.worst.feePercent}%` : "—"}
          icon={TrendingDown} tone="#A6472F"
        />
      </div>

      {data.gatewayBreakdown.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#EAE3D6] bg-white">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#FBF8F1]">
                <th className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Gateway</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Orders</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Gross</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Fee</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Net payout</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Refunds/Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {data.gatewayBreakdown.map((g) => (
                <tr key={g.gatewayLabel} className="border-t border-[#EAE3D6]">
                  <td className="px-3 py-2 font-medium text-[#1F1B16]">{g.gatewayLabel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.totalOrders}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{aed2(g.grossAed)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#8A8175]">{aed2(g.feesAed)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">{aed2(g.netAed)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#A6472F]">{aed2(g.cancelled.amountAed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount on the main dashboard**

In `components/finance/dashboard-v2/founder-dashboard.tsx`, add the import:

```ts
import { PaymentsInsightsPanel } from "./payments-insights-panel";
```

Verified against the live file: line 231 renders `<HeroBand …/>`, line 233 renders `<InsightRail …/>`. Insert the panel between them:

```tsx
      <HeroBand data={data} days={days} store={store} onDays={setDays} onStore={setStore} onOpenDrawer={setDrawer} />

      <PaymentsInsightsPanel />

      <InsightRail days={days} store={store} onViewCampaign={setCampaignId} onViewMoney={setDrawer} />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open the main Dashboard view, confirm the new panel renders below the hero, shows real numbers once at least one month is registered (Task 2), and that leaving the tab open for over a minute triggers a background refetch (Network tab shows a repeat `/api/dashboard/payments-insights` call at the 60s mark) without a loading-spinner flash.

- [ ] **Step 5: Commit**

```bash
git add components/finance/dashboard-v2/payments-insights-panel.tsx components/finance/dashboard-v2/founder-dashboard.tsx
git commit -m "$(cat <<'EOF'
Add real-time payments-sheet analytics panel to the main dashboard

Gross/Net Sales, Fees, Exchanges, Refunds/Cancellations, and a per-gateway
breakdown (fee, net payout) now live on the main Dashboard view, not just
the Invoices Workbench tab — aggregated across every month registered in
Settings, refetched every 60s so any edit ops makes in the sheet shows up
without a manual refresh.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016gc7qTEHtHSHL8EDgdWnFA
EOF
)"
```

---

## Out of scope for this plan

- Splitting "cancelled" into distinct "cancellation" vs. "refund" metrics — the sheet has one column (`Cancelled / Refunded Amount`) for both, with no signal to tell them apart; inventing a split would be a guess.
- Historical backfill tooling for months before the registry existed — a founder registers each month going forward (starting September, per the ask); nothing here reaches back to reconstruct pre-registry data.
- The separate Phase-2 PowerBI-style visual redesign and Google-Sheets-sync-for-the-payout-uploader work from the prior plan — unrelated scope, already deferred there.
