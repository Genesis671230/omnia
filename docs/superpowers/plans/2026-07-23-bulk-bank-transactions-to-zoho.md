# Bulk Bank Transactions → Zoho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bookkeeper upload a bank statement (PDF, CSV, XLS, or XLSX), review every parsed line (credit and debit) in a new "Bank Transactions" tab on the reconciliation page, and bulk-post a selection to Zoho Books as real categorized Bank Transactions in one click.

**Architecture:** Reuses the existing `bank_lines` table and `lib/parsers/bank.ts` CSV/PDF parser (adding an XLSX→CSV conversion step, not a new parser). Adds a account-by-kind mapping to the existing `zoho_account_config` settings row, a new posting builder alongside the existing `buildPayoutPostings`, and a new tracking table (`zoho_bank_txn_postings`) kept deliberately separate from the payout flow's `zoho_postings`. The new tab is a peer to the existing reconciliation tabs, fetching its own data independently.

**Tech Stack:** Next.js App Router API routes, Supabase (Postgres), the `xlsx` npm package (already a dependency), `node:test` + `node:assert/strict` for unit tests, React + Tailwind utility classes matching `components/finance/reconciliation/*`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-bulk-bank-transactions-to-zoho-design.md` — every task below implements one of its sections.
- This feature is **independent** of the existing gateway-payout reconciliation flow (`lib/integrations/zoho-banking.ts`'s `buildPayoutPostings`, `zoho_postings` table). Do not add cross-checks between the two; confirmed intentional.
- `lib/parsers/bank.ts` itself is **not modified** — XLSX support is a pre-processing step that converts to CSV text, reusing the existing CSV header-matching path.
- Schema changes go in `db/schema.sql` as `alter table ... add column if not exists` / `create table if not exists` statements (append-only, matching existing style). Editing this file does **not** touch the live database — apply with `node db/apply-schema.mjs` (needs `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in env).
- Money values: always round to 2 decimals with `+n.toFixed(2)` before storing or posting, matching the existing `buildPayoutPostings` convention.
- Test runner: `npm test` runs `tsx --test 'tests/**/*.test.ts'`.
- No comments explaining *what* code does — only *why*, matching the existing codebase's comment style (see any existing file in `lib/integrations/` or `lib/parsers/`).

---

### Task 1: XLSX/XLS → CSV conversion

**Files:**
- Create: `lib/parsers/xlsx-to-csv.ts`
- Test: `tests/parsers/xlsx-to-csv.test.ts`

**Interfaces:**
- Produces: `xlsxToCsvText(buf: Buffer): string` — used by Task 2's upload route.

- [ ] **Step 1: Write the failing test**

```ts
// tests/parsers/xlsx-to-csv.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { xlsxToCsvText } from "@/lib/parsers/xlsx-to-csv";
import { parseBankStatement } from "@/lib/parsers/bank";

function bufferFromRows(rows: (string | number)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("xlsxToCsvText: converts a workbook's first sheet to CSV text", () => {
  const buf = bufferFromRows([
    ["Date", "Description", "Credit", "Debit"],
    ["11/07/2026", "ON TRACK DELIVERY SERVICES", 2462, ""],
  ]);
  const csv = xlsxToCsvText(buf);
  assert.ok(csv.includes("Date,Description,Credit,Debit"));
  assert.ok(csv.includes("ON TRACK DELIVERY SERVICES"));
});

test("xlsxToCsvText: skips a genuinely empty leading sheet and uses the first non-empty one", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Empty");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Date", "Description", "Credit", "Debit"], ["11/07/2026", "SALARY", "", 5000]]),
    "Statement",
  );
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const csv = xlsxToCsvText(buf);
  assert.ok(csv.includes("SALARY"));
});

test("xlsxToCsvText -> parseBankStatement: an XLSX statement parses exactly like its CSV equivalent", () => {
  const buf = bufferFromRows([
    ["Date", "Description", "Credit", "Debit"],
    [
      "11/07/2026",
      "KWD Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES//REF/invoice 16964/FT26192VXFKW FT26192VXFKW",
      2462,
      "",
    ],
  ]);
  const csv = xlsxToCsvText(buf);
  const { credits } = parseBankStatement(csv, "statement.csv");
  assert.equal(credits.length, 1);
  assert.equal(credits[0].amount, 2462);
  assert.equal(credits[0].reference, "FT26192VXFKW");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/parsers/xlsx-to-csv.test.ts`
Expected: FAIL — `Cannot find module '@/lib/parsers/xlsx-to-csv'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/parsers/xlsx-to-csv.ts
//
// Converts the first non-empty sheet of an uploaded XLS/XLSX workbook into
// CSV text, so it runs through the exact same header-synonym CSV parsing
// path (tryParseCsvStatement inside lib/parsers/bank.ts) that already
// handles ENBD/ADCB/Mashreq/generic bank exports — one column-matching
// implementation instead of a second one duplicated for spreadsheets.
import * as XLSX from "xlsx";

export function xlsxToCsvText(buf: Buffer): string {
  const workbook = XLSX.read(buf, { type: "buffer" });
  for (const name of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]).trim();
    if (csv) return csv;
  }
  return "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/parsers/xlsx-to-csv.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/xlsx-to-csv.ts tests/parsers/xlsx-to-csv.test.ts
git commit -m "feat: convert XLSX/XLS bank statements to CSV text for the existing parser"
```

---

### Task 2: Wire XLSX into the upload route

**Files:**
- Modify: `app/api/upload/bank/route.ts`
- Modify: `components/finance/finance-workspace.tsx:269-270` (upload button `accept`)

**Interfaces:**
- Consumes: `xlsxToCsvText(buf: Buffer): string` from Task 1.

- [ ] **Step 1: Modify the upload route**

In `app/api/upload/bank/route.ts`, add the import and a new branch. The current code (lines 1-28) is:

```ts
import { NextResponse } from "next/server";
import { parseBankStatement } from "@/lib/parsers/bank";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

export const maxDuration = 60;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (field name: file)" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let text: string;
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const extracted = await extractText(pdf, { mergePages: true });
    text = extracted.text;
  } else {
    text = buf.toString("utf8");
  }

  const { credits, debits, format } = parseBankStatement(text, file.name);
```

Replace it with:

```ts
import { NextResponse } from "next/server";
import { parseBankStatement } from "@/lib/parsers/bank";
import { xlsxToCsvText } from "@/lib/parsers/xlsx-to-csv";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

export const maxDuration = 60;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (field name: file)" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let text: string;
  let parserFilename = file.name;
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const extracted = await extractText(pdf, { mergePages: true });
    text = extracted.text;
  } else if (/\.xlsx?$/i.test(file.name)) {
    text = xlsxToCsvText(buf);
    parserFilename = "statement.csv"; // force the existing CSV header-matching path
  } else {
    text = buf.toString("utf8");
  }

  const { credits, debits, format } = parseBankStatement(text, parserFilename);
```

Leave the rest of the file (error handling, `BankRepository.insertLines`, `FilesRepository.save`, response body) unchanged.

- [ ] **Step 2: Update the error message to mention XLS/XLSX**

Find this block later in the same file:

```ts
  if (credits.length === 0 && debits.length === 0) {
    return NextResponse.json(
      {
        error:
          "No transactions recognized. Upload a bank statement as PDF, or a CSV export with date, description, and debit/credit (or amount) columns.",
      },
      { status: 422 },
    );
  }
```

Replace the error string with:

```ts
          "No transactions recognized. Upload a bank statement as PDF, XLS/XLSX, or a CSV export with date, description, and debit/credit (or amount) columns.",
```

- [ ] **Step 3: Update the upload button's accepted file types**

In `components/finance/finance-workspace.tsx`, find:

```tsx
                <UploadButton endpoint="/api/upload/bank" accept=".pdf,.csv,.txt"
                  label="Upload bank statement" onDone={refresh} />
```

Change to:

```tsx
                <UploadButton endpoint="/api/upload/bank" accept=".pdf,.csv,.txt,.xls,.xlsx"
                  label="Upload bank statement" onDone={refresh} />
```

- [ ] **Step 4: Manual verification**

Run: `npm run build`
Expected: build succeeds with no type errors in the modified files.

- [ ] **Step 5: Commit**

```bash
git add app/api/upload/bank/route.ts components/finance/finance-workspace.tsx
git commit -m "feat: accept XLS/XLSX bank statement uploads"
```

---

### Task 3: Database schema — new columns and table

**Files:**
- Modify: `db/schema.sql` (append)

**Interfaces:**
- Produces: `bank_lines.zoho_description` column; `zoho_bank_txn_postings` table; `zoho_account_config.default_income_account_id` and `.expense_account_by_kind` columns. Consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Append the migration to `db/schema.sql`**

Add this block at the end of the file:

```sql
-- Bulk bank-statement-to-Zoho feature (2026-07-23). Independent of the
-- gateway-payout clearing-account flow above — see
-- docs/superpowers/specs/2026-07-23-bulk-bank-transactions-to-zoho-design.md.

-- Bookkeeper's override description, used only when posting to Zoho. The
-- original parsed narration in `description` is never overwritten — other
-- reconciliation UI and the dedupe/matching logic depend on it unchanged.
alter table bank_lines add column if not exists zoho_description text;

-- What this feature has posted. Deliberately separate from zoho_postings
-- (shaped for payout net/gross/fee triples) — a plain bank transaction is a
-- single amount against a single category account, a different shape.
create table if not exists zoho_bank_txn_postings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'omnia',
  bank_line_id         text not null,
  direction            text not null,
  transaction_type     text not null default '',
  category_account_id  text not null default '',
  reference_number     text not null default '',
  amount               numeric not null default 0,
  zoho_transaction_id  text,
  status               text not null default 'posted',
  error                text not null default '',
  posted_by            text not null default '',
  posted_at            timestamptz not null default now()
);
create unique index if not exists zoho_bank_txn_postings_line_idx on zoho_bank_txn_postings (bank_line_id);

-- Extends the existing single-row account-mapping config with the fields
-- this feature needs: one income account for all credits, one expense
-- account per debit kind (salary/supplier/fee/tax/transfer/other).
alter table zoho_account_config add column if not exists default_income_account_id text not null default '';
alter table zoho_account_config add column if not exists expense_account_by_kind jsonb not null default '{}';
```

- [ ] **Step 2: Apply the migration**

Run: `node db/apply-schema.mjs`
Expected: script reports the new statements applied (requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment — if unavailable in this environment, flag this step to the user to run themselves before Tasks 8-10 are tested live).

- [ ] **Step 3: Commit**

```bash
git add db/schema.sql
git commit -m "feat: add schema for bank-line Zoho description override and posting tracking"
```

---

### Task 4: `buildBankLinePosting` and account-map extensions

**Files:**
- Modify: `lib/integrations/zoho-banking.ts`
- Test: `tests/integrations/zoho-banking.test.ts` (extend)
- Modify: `tests/integrations/zoho-account-map.test.ts` (fix one pre-existing assertion — see Step 5)

**Interfaces:**
- Consumes: nothing new (extends existing `ZohoAccountMap`, `ZohoPosting`, `mergeAccountMaps`, `accountMapFromEnvPartial`).
- Produces:
  - `BANK_LINE_KINDS: readonly ["salary","supplier","fee","tax","transfer","other"]`
  - `type BankLinePostingInput = { bankLineId: string; direction: "credit"|"debit"; amount: number; date: string; kind: string | null; description: string }`
  - `buildBankLinePosting(input: BankLinePostingInput, accounts: ZohoAccountMap): ZohoPosting`
  - `missingIncomeMapping(accounts: ZohoAccountMap): string[]`
  - `missingExpenseMappingFor(kind: string, accounts: ZohoAccountMap): string[]`
  - `BANK_LINE_REFERENCE_PREFIX = "BANKLINE-"`
  - `ZohoAccountMap` gains optional `defaultIncomeAccountId?: string` and `expenseAccountByKind?: Record<string,string>`.
  - `ZohoPosting.transaction_type` widens to `"transfer_fund" | "deposit" | "expense"`.
  - Used by Tasks 8, 9, 10, 11.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integrations/zoho-banking.test.ts`:

```ts
import { buildBankLinePosting, missingIncomeMapping, missingExpenseMappingFor } from "@/lib/integrations/zoho-banking";

const BANK_LINE_ACCOUNTS: ZohoAccountMap = {
  bankAccountId: "BANK1",
  feeAccountId: "FEES1",
  clearingByGateway: {},
  defaultIncomeAccountId: "INCOME1",
  expenseAccountByKind: { salary: "EXP_SALARY", supplier: "EXP_SUPPLIER", fee: "EXP_FEE" },
};

test("buildBankLinePosting: a credit posts as a deposit from the default income account into the bank", () => {
  const posting = buildBankLinePosting(
    { bankLineId: "abc-123", direction: "credit", amount: 2462, date: "2026-07-11", kind: null, description: "ON TRACK DELIVERY" },
    BANK_LINE_ACCOUNTS,
  );
  assert.equal(posting.transaction_type, "deposit");
  assert.equal(posting.from_account_id, "INCOME1");
  assert.equal(posting.to_account_id, "BANK1");
  assert.equal(posting.amount, 2462);
  assert.equal(posting.referenceNumber, "BANKLINE-abc-123");
  assert.equal(posting.description, "ON TRACK DELIVERY");
});

test("buildBankLinePosting: a debit posts as an expense from the bank into its kind's mapped account", () => {
  const posting = buildBankLinePosting(
    { bankLineId: "def-456", direction: "debit", amount: 50, date: "2026-07-19", kind: "fee", description: "Outward SWIFT Charges" },
    BANK_LINE_ACCOUNTS,
  );
  assert.equal(posting.transaction_type, "expense");
  assert.equal(posting.from_account_id, "BANK1");
  assert.equal(posting.to_account_id, "EXP_FEE");
  assert.equal(posting.amount, 50);
  assert.equal(posting.referenceNumber, "BANKLINE-def-456");
});

test("buildBankLinePosting: a debit with no kind falls back to 'other'", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g1", direction: "debit", amount: 10, date: "2026-07-19", kind: null, description: "x" },
      BANK_LINE_ACCOUNTS,
    ),
    /No expense account mapped for kind "other"/,
  );
});

test("buildBankLinePosting: refuses a credit with no default income account mapped", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g2", direction: "credit", amount: 10, date: "2026-07-19", kind: null, description: "x" },
      { ...BANK_LINE_ACCOUNTS, defaultIncomeAccountId: "" },
    ),
    /No default income account mapped/,
  );
});

test("buildBankLinePosting: refuses a debit whose kind has no mapped expense account", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g3", direction: "debit", amount: 10, date: "2026-07-19", kind: "tax", description: "x" },
      BANK_LINE_ACCOUNTS,
    ),
    /No expense account mapped for kind "tax"/,
  );
});

test("buildBankLinePosting: refuses a non-positive amount", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g4", direction: "credit", amount: 0, date: "2026-07-19", kind: null, description: "x" },
      BANK_LINE_ACCOUNTS,
    ),
    /amount must be positive/,
  );
});

test("missingIncomeMapping / missingExpenseMappingFor: name what's missing", () => {
  assert.deepEqual(missingIncomeMapping({ bankAccountId: "", feeAccountId: "", clearingByGateway: {} }), [
    "bank account",
    "default income account",
  ]);
  assert.deepEqual(missingExpenseMappingFor("salary", BANK_LINE_ACCOUNTS), []);
  assert.deepEqual(missingExpenseMappingFor("tax", BANK_LINE_ACCOUNTS), ["tax expense account"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/integrations/zoho-banking.test.ts`
Expected: FAIL — `buildBankLinePosting is not a function`

- [ ] **Step 3: Extend `lib/integrations/zoho-banking.ts`**

Change the `ZohoAccountMap` type:

```ts
export type ZohoAccountMap = {
  bankAccountId: string;
  feeAccountId: string;
  clearingByGateway: Record<string, string>;
  defaultIncomeAccountId?: string;
  expenseAccountByKind?: Record<string, string>;
};
```

Widen `ZohoPosting.transaction_type`:

```ts
export type ZohoPosting = {
  referenceNumber: string;
  transaction_type: "transfer_fund" | "deposit" | "expense";
  from_account_id: string;
  to_account_id: string;
  amount: number;
  date: string;
  description: string;
};
```

Extend `mergeAccountMaps`:

```ts
export function mergeAccountMaps(
  env: Partial<ZohoAccountMap> | null,
  db: Partial<ZohoAccountMap> | null,
): ZohoAccountMap {
  return {
    bankAccountId: db?.bankAccountId || env?.bankAccountId || "",
    feeAccountId: db?.feeAccountId || env?.feeAccountId || "",
    clearingByGateway: { ...(env?.clearingByGateway ?? {}), ...(db?.clearingByGateway ?? {}) },
    defaultIncomeAccountId: db?.defaultIncomeAccountId || env?.defaultIncomeAccountId || "",
    expenseAccountByKind: { ...(env?.expenseAccountByKind ?? {}), ...(db?.expenseAccountByKind ?? {}) },
  };
}
```

Extend `accountMapFromEnvPartial`:

```ts
export function accountMapFromEnvPartial(): Partial<ZohoAccountMap> {
  let clearingByGateway: Record<string, string> = {};
  const raw = process.env.ZOHO_CLEARING_ACCOUNTS;
  if (raw) {
    try {
      clearingByGateway = JSON.parse(raw);
    } catch {
      clearingByGateway = {};
    }
  }
  let expenseAccountByKind: Record<string, string> = {};
  const rawExpense = process.env.ZOHO_EXPENSE_ACCOUNTS_BY_KIND;
  if (rawExpense) {
    try {
      expenseAccountByKind = JSON.parse(rawExpense);
    } catch {
      expenseAccountByKind = {};
    }
  }
  return {
    bankAccountId: process.env.ZOHO_BANK_ACCOUNT_ID ?? "",
    feeAccountId: process.env.ZOHO_FEE_ACCOUNT_ID ?? "",
    clearingByGateway,
    defaultIncomeAccountId: process.env.ZOHO_DEFAULT_INCOME_ACCOUNT_ID ?? "",
    expenseAccountByKind,
  };
}
```

Add the new exports at the end of the file, after `postPayoutToZoho`:

```ts
// ── Generic bank-line posting (bulk statement upload feature) ──────────────
//
// Independent of the payout-clearing flow above: every parsed bank_lines row
// (credit or debit) posts as a plain, categorized Zoho Bank Transaction —
// deposit for credits, expense for debits — against accounts mapped once in
// Settings, not a per-gateway clearing account.

export const BANK_LINE_KINDS = ["salary", "supplier", "fee", "tax", "transfer", "other"] as const;
export type BankLineKind = (typeof BANK_LINE_KINDS)[number];

export const BANK_LINE_REFERENCE_PREFIX = "BANKLINE-";

export type BankLinePostingInput = {
  bankLineId: string;
  direction: "credit" | "debit";
  amount: number;
  date: string; // YYYY-MM-DD
  kind: string | null; // debit classification; ignored for credits
  description: string;
};

/**
 * Turns one bank_lines row into the single Zoho posting that records it.
 *
 * Unlike buildPayoutPostings, this never emits a pair — a plain bank line is
 * one amount against one category account, not a net+fee split that must
 * balance together.
 */
export function buildBankLinePosting(
  input: BankLinePostingInput,
  accounts: ZohoAccountMap,
): ZohoPosting {
  if (input.amount <= 0) {
    throw new Error(`Bank line amount must be positive, got ${input.amount}`);
  }
  if (!accounts.bankAccountId) throw new Error("No Zoho bank account configured");

  const amount = +input.amount.toFixed(2);
  const referenceNumber = `${BANK_LINE_REFERENCE_PREFIX}${input.bankLineId}`;

  if (input.direction === "credit") {
    const incomeAccountId = accounts.defaultIncomeAccountId ?? "";
    if (!incomeAccountId) {
      throw new Error("No default income account mapped — map it under Settings → Zoho Books");
    }
    return {
      referenceNumber,
      transaction_type: "deposit",
      from_account_id: incomeAccountId,
      to_account_id: accounts.bankAccountId,
      amount,
      date: input.date,
      description: input.description,
    };
  }

  const kind = input.kind ?? "other";
  const expenseAccountId = (accounts.expenseAccountByKind ?? {})[kind] ?? "";
  if (!expenseAccountId) {
    throw new Error(`No expense account mapped for kind "${kind}" — map it under Settings → Zoho Books`);
  }
  return {
    referenceNumber,
    transaction_type: "expense",
    from_account_id: accounts.bankAccountId,
    to_account_id: expenseAccountId,
    amount,
    date: input.date,
    description: input.description,
  };
}

/** What is still missing before any credit can post as a deposit. */
export function missingIncomeMapping(accounts: ZohoAccountMap): string[] {
  const missing: string[] = [];
  if (!accounts.bankAccountId) missing.push("bank account");
  if (!accounts.defaultIncomeAccountId) missing.push("default income account");
  return missing;
}

/** What is still missing before a debit of this kind can post as an expense. */
export function missingExpenseMappingFor(kind: string, accounts: ZohoAccountMap): string[] {
  const missing: string[] = [];
  if (!accounts.bankAccountId) missing.push("bank account");
  if (!(accounts.expenseAccountByKind ?? {})[kind]) missing.push(`${kind} expense account`);
  return missing;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/integrations/zoho-banking.test.ts`
Expected: PASS (all existing + new tests)

- [ ] **Step 5: Fix the one pre-existing test broken by the wider merge output**

`mergeAccountMaps(null, null)` now returns two extra fields. In `tests/integrations/zoho-account-map.test.ts`, find:

```ts
  test("no env and no db is an empty map, not a throw — the UI reports it", () => {
    const m = mergeAccountMaps(null, null);
    assert.deepEqual(m, { bankAccountId: "", feeAccountId: "", clearingByGateway: {} });
  });
```

Replace with:

```ts
  test("no env and no db is an empty map, not a throw — the UI reports it", () => {
    const m = mergeAccountMaps(null, null);
    assert.deepEqual(m, {
      bankAccountId: "", feeAccountId: "", clearingByGateway: {},
      defaultIncomeAccountId: "", expenseAccountByKind: {},
    });
  });
```

- [ ] **Step 6: Run the full integrations test suite**

Run: `npx tsx --test tests/integrations/*.test.ts`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/zoho-banking.ts tests/integrations/zoho-banking.test.ts tests/integrations/zoho-account-map.test.ts
git commit -m "feat: add buildBankLinePosting for generic bank-line Zoho postings"
```

---

### Task 5: Repository extensions

**Files:**
- Modify: `lib/repositories/zoho-config.repository.ts`
- Modify: `lib/repositories/bank.repository.ts`
- Create: `lib/repositories/zoho-bank-txn.repository.ts`

**Interfaces:**
- Consumes: `ZohoAccountMap` (Task 4).
- Produces:
  - `ZohoConfigRepository.getAccountMap()` / `.saveAccountMap()` now read/write `default_income_account_id`, `expense_account_by_kind`.
  - `BankRepository.listAll(opts?: { from?: string; to?: string }): Promise<BankLineWithZoho[]>`
  - `BankRepository.getByIds(ids: string[]): Promise<BankLineWithZoho[]>`
  - `BankRepository.updateZohoDescription(id: string, zohoDescription: string): Promise<void>`
  - `type BankLineWithZoho = BankLineRow & { zoho_description: string | null }`
  - `ZohoBankTxnRepository` with `getPosting`, `listPostings`, `recordPosting`.
  - Used by Tasks 8, 9, 10.

No new automated tests in this task — this codebase doesn't unit-test Supabase repositories (see `lib/repositories/bank.repository.ts`, which has none); correctness is verified through the API routes in Tasks 8-10 against a live/staging database.

- [ ] **Step 1: Extend `ZohoConfigRepository`**

In `lib/repositories/zoho-config.repository.ts`, replace `getAccountMap` and `saveAccountMap`:

```ts
  async getAccountMap(): Promise<ZohoAccountMap | null> {
    const { data, error } = await supabase
      .from("zoho_account_config")
      .select("bank_account_id, fee_account_id, clearing_by_gateway, default_income_account_id, expense_account_by_kind")
      .eq("id", TENANT)
      .maybeSingle();
    if (error || !data) return null;
    return {
      bankAccountId: data.bank_account_id ?? "",
      feeAccountId: data.fee_account_id ?? "",
      clearingByGateway: (data.clearing_by_gateway ?? {}) as Record<string, string>,
      defaultIncomeAccountId: data.default_income_account_id ?? "",
      expenseAccountByKind: (data.expense_account_by_kind ?? {}) as Record<string, string>,
    };
  },

  async saveAccountMap(map: ZohoAccountMap, updatedBy: string) {
    const { error } = await supabase.from("zoho_account_config").upsert(
      {
        id: TENANT,
        tenant_id: TENANT,
        bank_account_id: map.bankAccountId,
        fee_account_id: map.feeAccountId,
        clearing_by_gateway: map.clearingByGateway,
        default_income_account_id: map.defaultIncomeAccountId ?? "",
        expense_account_by_kind: map.expenseAccountByKind ?? {},
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`zoho_account_config save failed: ${error.message}`);
  },
```

- [ ] **Step 2: Extend `BankRepository`**

In `lib/repositories/bank.repository.ts`, add this type near the top (after the existing `BankLineRow` type):

```ts
export type BankLineWithZoho = BankLineRow & { zoho_description: string | null };
```

Add these three methods inside the `BankRepository` object, after `listDebits`:

```ts
  async listAll(opts: { from?: string; to?: string } = {}): Promise<BankLineWithZoho[]> {
    let q = supabase
      .from("bank_lines")
      .select(
        "id, batch_id, statement_date, description, zoho_description, reference, amount, currency, direction, gateway_guess, confidence, kind, status, dedupe_key",
      )
      .order("statement_date", { ascending: false });
    if (opts.from) q = q.gte("statement_date", opts.from);
    if (opts.to) q = q.lte("statement_date", opts.to);
    const { data, error } = await q;
    if (error) throw new Error(`bank_lines select failed: ${error.message}`);
    return (data ?? []) as BankLineWithZoho[];
  },

  async getByIds(ids: string[]): Promise<BankLineWithZoho[]> {
    if (ids.length === 0) return [];
    const { data, error } = await supabase
      .from("bank_lines")
      .select(
        "id, batch_id, statement_date, description, zoho_description, reference, amount, currency, direction, gateway_guess, confidence, kind, status, dedupe_key",
      )
      .in("id", ids);
    if (error) throw new Error(`bank_lines select failed: ${error.message}`);
    return (data ?? []) as BankLineWithZoho[];
  },

  async updateZohoDescription(id: string, zohoDescription: string): Promise<void> {
    const { error } = await supabase.from("bank_lines").update({ zoho_description: zohoDescription }).eq("id", id);
    if (error) throw new Error(`bank_lines zoho_description update failed: ${error.message}`);
  },
```

- [ ] **Step 3: Create `ZohoBankTxnRepository`**

```ts
// lib/repositories/zoho-bank-txn.repository.ts
import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type ZohoBankTxnPostingRow = {
  bank_line_id: string;
  direction: "credit" | "debit";
  transaction_type: string;
  category_account_id: string;
  reference_number: string;
  amount: number;
  zoho_transaction_id: string | null;
  status: "posted" | "failed";
  error: string;
  posted_by: string;
  posted_at: string;
};

/** Tracks what the bulk bank-transactions feature has posted to Zoho — kept
 *  separate from zoho_postings (the gateway-payout flow's table), which is
 *  shaped for net/gross/fee triples, not a single categorized transaction. */
export const ZohoBankTxnRepository = {
  async getPosting(bankLineId: string): Promise<ZohoBankTxnPostingRow | null> {
    const { data, error } = await supabase
      .from("zoho_bank_txn_postings")
      .select("*")
      .eq("bank_line_id", bankLineId)
      .maybeSingle();
    if (error || !data) return null;
    return data as ZohoBankTxnPostingRow;
  },

  async listPostings(): Promise<ZohoBankTxnPostingRow[]> {
    const { data, error } = await supabase
      .from("zoho_bank_txn_postings")
      .select("*")
      .order("posted_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as ZohoBankTxnPostingRow[];
  },

  async recordPosting(row: Omit<ZohoBankTxnPostingRow, "posted_at">) {
    const { error } = await supabase.from("zoho_bank_txn_postings").upsert(
      { ...row, tenant_id: TENANT, posted_at: new Date().toISOString() },
      { onConflict: "bank_line_id" },
    );
    if (error) throw new Error(`zoho_bank_txn_postings write failed: ${error.message}`);
  },
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new type errors (requires Task 3's schema applied for this to also work at runtime, but type-checking doesn't touch the database).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/zoho-config.repository.ts lib/repositories/bank.repository.ts lib/repositories/zoho-bank-txn.repository.ts
git commit -m "feat: repository support for bank-line descriptions and Zoho posting tracking"
```

---

### Task 6: Pure filter helpers for the new tab

**Files:**
- Create: `lib/reconciliation/bank-line-filters.ts`
- Test: `tests/reconciliation/bank-line-filters.test.ts`

**Interfaces:**
- Produces:
  - `type BankTxnFilterLine = { id: string; description: string; reference: string; amount: number; gatewayGuess: string | null; kind: string | null }`
  - `matchesBankTxnQuery(l: BankTxnFilterLine, query: string): boolean`
  - `type PostStatusFilter = "all" | "posted" | "not_posted" | "failed"`
  - `matchesPostStatus(id: string, postings: Record<string, { status: string } | undefined>, filter: PostStatusFilter): boolean`
  - Used by Task 11's `BankTransactionsTab`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reconciliation/bank-line-filters.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesBankTxnQuery, matchesPostStatus } from "@/lib/reconciliation/bank-line-filters";

test("matchesBankTxnQuery: AND across tokens over description, reference, amount, gateway, kind", () => {
  const line = { id: "1", description: "Outward SWIFT Charges", reference: "DSZ26201CGC0JHK0", amount: 50, gatewayGuess: null, kind: "fee" };
  assert.equal(matchesBankTxnQuery(line, "swift fee"), true);
  assert.equal(matchesBankTxnQuery(line, "swift salary"), false);
  assert.equal(matchesBankTxnQuery(line, "50"), true);
  assert.equal(matchesBankTxnQuery(line, ""), true);
});

test("matchesPostStatus: not_posted means no posting record at all", () => {
  const postings = { "1": { status: "posted" } };
  assert.equal(matchesPostStatus("1", postings, "posted"), true);
  assert.equal(matchesPostStatus("2", postings, "not_posted"), true);
  assert.equal(matchesPostStatus("1", postings, "not_posted"), false);
  assert.equal(matchesPostStatus("1", postings, "failed"), false);
});

test("matchesPostStatus: 'all' always matches, even with no postings loaded", () => {
  assert.equal(matchesPostStatus("anything", {}, "all"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/reconciliation/bank-line-filters.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// lib/reconciliation/bank-line-filters.ts
//
// Search and status filtering for the Bank Transactions tab — pure,
// client-side, over whatever page of lines /api/reconcile/bank-lines
// already returned. Mirrors lib/reconciliation/filters.ts's matchesQuery
// (AND across tokens: typing more always narrows).

export type BankTxnFilterLine = {
  id: string;
  description: string;
  reference: string;
  amount: number;
  gatewayGuess: string | null;
  kind: string | null;
};

export function matchesBankTxnQuery(l: BankTxnFilterLine, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const target = [l.description, l.reference, String(l.amount), l.gatewayGuess ?? "", l.kind ?? ""]
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => target.includes(t));
}

export type PostStatusFilter = "all" | "posted" | "not_posted" | "failed";

export function matchesPostStatus(
  id: string,
  postings: Record<string, { status: string } | undefined>,
  filter: PostStatusFilter,
): boolean {
  if (filter === "all") return true;
  const status = postings[id]?.status;
  if (filter === "not_posted") return !status;
  return status === filter;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/reconciliation/bank-line-filters.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/reconciliation/bank-line-filters.ts tests/reconciliation/bank-line-filters.test.ts
git commit -m "feat: add search and post-status filters for the Bank Transactions tab"
```

---

### Task 7: Settings API — account-config route extension

**Files:**
- Modify: `app/api/integrations/zoho/account-config/route.ts`

**Interfaces:**
- Consumes: `BANK_LINE_KINDS`, `missingIncomeMapping`, `missingExpenseMappingFor` (Task 4); extended `ZohoConfigRepository` (Task 5).
- Produces: `GET` response gains `bankLineKinds`, `incomeReadiness`, `kindReadiness`; `effective`/`saved` gain `defaultIncomeAccountId`/`expenseAccountByKind`. `POST` accepts and saves the same two fields. Used by Task 8 (Settings UI).

- [ ] **Step 1: Replace the file's contents**

```ts
import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  accountMapFromEnvPartial,
  BANK_LINE_KINDS,
  fetchZohoBankAccounts,
  fetchZohoChartOfAccounts,
  mergeAccountMaps,
  missingExpenseMappingFor,
  missingIncomeMapping,
  missingMappingFor,
} from "@/lib/integrations/zoho-banking";
import { ZohoConfigRepository } from "@/lib/repositories/zoho-config.repository";

export const maxDuration = 60;

const GATEWAYS = ["Stripe", "Tabby", "Tamara", "Checkout", "COD", "Telr"];

// GET /api/integrations/zoho/account-config
export async function GET() {
  if (!zohoConfigured()) {
    return NextResponse.json(
      { error: "Zoho is not configured — set ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ORGANIZATION_ID" },
      { status: 503 },
    );
  }

  const saved = await ZohoConfigRepository.getAccountMap();
  const effective = mergeAccountMaps(accountMapFromEnvPartial(), saved);

  let bankAccounts: Awaited<ReturnType<typeof fetchZohoBankAccounts>> = [];
  let allAccounts: Awaited<ReturnType<typeof fetchZohoChartOfAccounts>> = [];
  let fetchError: string | null = null;
  try {
    const token = await getAccessToken();
    [bankAccounts, allAccounts] = await Promise.all([
      fetchZohoBankAccounts(token),
      fetchZohoChartOfAccounts(token),
    ]);
  } catch (e) {
    fetchError = (e as Error).message;
  }

  return NextResponse.json({
    gateways: GATEWAYS,
    bankLineKinds: BANK_LINE_KINDS,
    bankAccounts,
    allAccounts,
    saved,
    effective,
    readiness: GATEWAYS.map((g) => ({ gateway: g, missing: missingMappingFor(g, effective) })),
    incomeReadiness: missingIncomeMapping(effective),
    kindReadiness: BANK_LINE_KINDS.map((k) => ({ kind: k, missing: missingExpenseMappingFor(k, effective) })),
    fetchError,
  });
}

// POST — body: { bankAccountId, feeAccountId, clearingByGateway, defaultIncomeAccountId, expenseAccountByKind, actor? }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const bankAccountId = String(body.bankAccountId ?? "");
  const feeAccountId = String(body.feeAccountId ?? "");
  const clearingByGateway = (body.clearingByGateway ?? {}) as Record<string, string>;
  const defaultIncomeAccountId = String(body.defaultIncomeAccountId ?? "");
  const expenseAccountByKind = (body.expenseAccountByKind ?? {}) as Record<string, string>;

  if (typeof clearingByGateway !== "object" || Array.isArray(clearingByGateway)) {
    return NextResponse.json({ error: "clearingByGateway must be an object of gateway → account id" }, { status: 400 });
  }
  if (typeof expenseAccountByKind !== "object" || Array.isArray(expenseAccountByKind)) {
    return NextResponse.json({ error: "expenseAccountByKind must be an object of kind → account id" }, { status: 400 });
  }

  const cleanObject = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  const cleanedClearing = cleanObject(clearingByGateway);
  const cleanedExpense = cleanObject(expenseAccountByKind);

  try {
    await ZohoConfigRepository.saveAccountMap(
      {
        bankAccountId,
        feeAccountId,
        clearingByGateway: cleanedClearing,
        defaultIncomeAccountId,
        expenseAccountByKind: cleanedExpense,
      },
      String(body.actor ?? "founder"),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const effective = mergeAccountMaps(accountMapFromEnvPartial(), {
    bankAccountId, feeAccountId, clearingByGateway: cleanedClearing,
    defaultIncomeAccountId, expenseAccountByKind: cleanedExpense,
  });
  return NextResponse.json({
    ok: true,
    effective,
    readiness: GATEWAYS.map((g) => ({ gateway: g, missing: missingMappingFor(g, effective) })),
    incomeReadiness: missingIncomeMapping(effective),
    kindReadiness: BANK_LINE_KINDS.map((k) => ({ kind: k, missing: missingExpenseMappingFor(k, effective) })),
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 3: Commit**

```bash
git add app/api/integrations/zoho/account-config/route.ts
git commit -m "feat: extend Zoho account-config API with income/expense account mapping"
```

---

### Task 8: List and description-edit API routes

**Files:**
- Create: `app/api/reconcile/bank-lines/route.ts`
- Create: `app/api/reconcile/bank-line/[id]/route.ts`

**Interfaces:**
- Consumes: `BankRepository.listAll`, `BankRepository.updateZohoDescription` (Task 5); `ZohoBankTxnRepository.listPostings` (Task 5).
- Produces:
  - `GET /api/reconcile/bank-lines?from=&to=` → `{ lines: BankLineListRow[], postings: Record<string, PostingSummary> }`
  - `PATCH /api/reconcile/bank-line/:id` body `{ zohoDescription: string }` → `{ ok: true }`
  - Used by Task 11's `BankTransactionsTab`.

- [ ] **Step 1: Create the list route**

```ts
// app/api/reconcile/bank-lines/route.ts
import { NextResponse } from "next/server";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

export const maxDuration = 60;

// GET /api/reconcile/bank-lines?from=&to=
//
// Every parsed bank line (credit and debit), independent of gateway-payout
// reconciliation state — the data source for the Bank Transactions tab.
// Search/direction/post-status filtering happens client-side (see
// lib/reconciliation/bank-line-filters.ts); only the date range is
// server-side, matching the existing /api/reconcile convention.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  try {
    const [lines, postings] = await Promise.all([
      BankRepository.listAll({ from, to }),
      ZohoBankTxnRepository.listPostings(),
    ]);

    const postingsByLine: Record<string, { status: string; zohoTransactionId: string | null; error: string; postedAt: string }> = {};
    for (const p of postings) {
      postingsByLine[p.bank_line_id] = {
        status: p.status,
        zohoTransactionId: p.zoho_transaction_id,
        error: p.error,
        postedAt: p.posted_at,
      };
    }

    return NextResponse.json({
      lines: lines.map((l) => ({
        id: l.id,
        date: l.statement_date,
        description: l.description,
        zohoDescription: l.zoho_description,
        reference: l.reference,
        amount: l.amount,
        direction: l.direction,
        gatewayGuess: l.gateway_guess,
        confidence: l.confidence,
        kind: l.kind,
        batchId: l.batch_id,
      })),
      postings: postingsByLine,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the description-edit route**

```ts
// app/api/reconcile/bank-line/[id]/route.ts
import { NextResponse } from "next/server";
import { BankRepository } from "@/lib/repositories/bank.repository";

// PATCH /api/reconcile/bank-line/:id — body: { zohoDescription: string }
//
// The only per-line override this feature allows: what description reaches
// Zoho, without touching the original parsed bank narration (`description`),
// which other reconciliation UI and dedupe/matching logic depend on.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const zohoDescription = String(body.zohoDescription ?? "");

  try {
    await BankRepository.updateZohoDescription(id, zohoDescription);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 4: Commit**

```bash
git add app/api/reconcile/bank-lines/route.ts "app/api/reconcile/bank-line/[id]/route.ts"
git commit -m "feat: add bank-lines list and description-edit API routes"
```

---

### Task 9: Bulk posting API route

**Files:**
- Create: `app/api/integrations/zoho/post-bank-lines/route.ts`

**Interfaces:**
- Consumes: `buildBankLinePosting`, `BANK_LINE_REFERENCE_PREFIX`, `mergeAccountMaps`, `accountMapFromEnvPartial`, `findBankTransactionByReference`, `createBankTransaction` (Task 4, plus pre-existing); `BankRepository.getByIds` (Task 5); `ZohoBankTxnRepository.recordPosting` (Task 5).
- Produces: `POST /api/integrations/zoho/post-bank-lines` body `{ bankLineIds: string[], dryRun?: boolean, actor?: string }` → `{ dryRun: boolean, results: { bankLineId: string; status: "posted"|"failed"; error?: string; zohoTransactionId?: string; posting?: ZohoPosting }[] }`. Used by Task 11's `BankTxnPostDialog`.

- [ ] **Step 1: Create the route**

```ts
// app/api/integrations/zoho/post-bank-lines/route.ts
import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  accountMapFromEnvPartial,
  buildBankLinePosting,
  createBankTransaction,
  findBankTransactionByReference,
  mergeAccountMaps,
  type ZohoPosting,
} from "@/lib/integrations/zoho-banking";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { ZohoConfigRepository } from "@/lib/repositories/zoho-config.repository";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

export const maxDuration = 120;

type LineResult = {
  bankLineId: string;
  status: "posted" | "failed";
  error?: string;
  zohoTransactionId?: string;
  posting?: ZohoPosting;
};

// POST /api/integrations/zoho/post-bank-lines
//   body: { bankLineIds: string[], dryRun?: boolean, actor?: string }
//
// Posts each selected bank_lines row as its own categorized Zoho Bank
// Transaction (deposit for a credit, expense for a debit) — independent of
// the gateway-payout clearing-account flow. Each line is posted and recorded
// on its own: unlike a payout's net+fee pair, these are unrelated ledger
// lines, so one line's failure never blocks the rest of the batch.
export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const bankLineIds = Array.isArray(body.bankLineIds) ? body.bankLineIds.map(String) : [];
  const dryRun = Boolean(body.dryRun);
  const actor = String(body.actor ?? "founder");
  if (bankLineIds.length === 0) {
    return NextResponse.json({ error: "bankLineIds required" }, { status: 400 });
  }

  const lines = await BankRepository.getByIds(bankLineIds);
  const accounts = mergeAccountMaps(accountMapFromEnvPartial(), await ZohoConfigRepository.getAccountMap());
  const accessToken = dryRun ? "" : await getAccessToken();

  const results: LineResult[] = [];

  for (const line of lines) {
    try {
      // Local record first: cheaper than a Zoho round trip, and it lets a
      // re-click after a partial batch failure skip everything that already
      // succeeded instead of re-checking each one against Zoho. Mirrors the
      // fast-path check in /api/integrations/zoho/post-payout.
      if (!dryRun) {
        const existingPosting = await ZohoBankTxnRepository.getPosting(line.id);
        if (existingPosting && existingPosting.status === "posted") {
          results.push({
            bankLineId: line.id,
            status: "posted",
            zohoTransactionId: existingPosting.zoho_transaction_id ?? undefined,
          });
          continue;
        }
      }

      const posting = buildBankLinePosting(
        {
          bankLineId: line.id,
          direction: line.direction,
          amount: line.amount,
          date: (line.statement_date ?? new Date().toISOString()).slice(0, 10),
          kind: line.kind,
          description: line.zoho_description || line.description,
        },
        accounts,
      );

      if (dryRun) {
        results.push({ bankLineId: line.id, status: "posted", posting });
        continue;
      }

      const existing = await findBankTransactionByReference(posting.referenceNumber, accessToken);
      const zohoTransactionId = existing
        ? existing.transaction_id
        : (await createBankTransaction(posting, accessToken)).transaction_id;

      await ZohoBankTxnRepository.recordPosting({
        bank_line_id: line.id,
        direction: line.direction,
        transaction_type: posting.transaction_type,
        category_account_id: line.direction === "credit" ? posting.from_account_id : posting.to_account_id,
        reference_number: posting.referenceNumber,
        amount: posting.amount,
        zoho_transaction_id: zohoTransactionId,
        status: "posted",
        error: "",
        posted_by: actor,
      });

      results.push({ bankLineId: line.id, status: "posted", zohoTransactionId, posting });
    } catch (e) {
      const message = (e as Error).message;
      if (!dryRun) {
        await ZohoBankTxnRepository.recordPosting({
          bank_line_id: line.id,
          direction: line.direction,
          transaction_type: "",
          category_account_id: "",
          reference_number: "",
          amount: line.amount,
          zoho_transaction_id: null,
          status: "failed",
          error: message,
          posted_by: actor,
        }).catch(() => {});
      }
      results.push({ bankLineId: line.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({ dryRun, results });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 3: Commit**

```bash
git add app/api/integrations/zoho/post-bank-lines/route.ts
git commit -m "feat: add bulk bank-line-to-Zoho posting API route"
```

---

### Task 10: Settings UI — account mapping panel extension

**Files:**
- Modify: `components/finance/reconciliation/zoho-settings-panel.tsx`

**Interfaces:**
- Consumes: extended `GET`/`POST /api/integrations/zoho/account-config` response (Task 7).

- [ ] **Step 1: Extend the `Config` type**

Find:

```ts
type Config = {
  gateways: string[];
  bankAccounts: Account[];
  allAccounts: Account[];
  effective: { bankAccountId: string; feeAccountId: string; clearingByGateway: Record<string, string> };
  readiness: { gateway: string; missing: string[] }[];
  fetchError: string | null;
  error?: string;
};
```

Replace with:

```ts
type Config = {
  gateways: string[];
  bankLineKinds: string[];
  bankAccounts: Account[];
  allAccounts: Account[];
  effective: {
    bankAccountId: string; feeAccountId: string; clearingByGateway: Record<string, string>;
    defaultIncomeAccountId: string; expenseAccountByKind: Record<string, string>;
  };
  readiness: { gateway: string; missing: string[] }[];
  incomeReadiness: string[];
  kindReadiness: { kind: string; missing: string[] }[];
  fetchError: string | null;
  error?: string;
};
```

- [ ] **Step 2: Add state and wire it through `load`/`save`**

Find:

```ts
  const [bankAccountId, setBankAccountId] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");
  const [clearing, setClearing] = useState<Record<string, string>>({});
```

Replace with:

```ts
  const [bankAccountId, setBankAccountId] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");
  const [clearing, setClearing] = useState<Record<string, string>>({});
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [expenseByKind, setExpenseByKind] = useState<Record<string, string>>({});
```

Find, inside `load`:

```ts
      if (r.effective) {
        setBankAccountId(r.effective.bankAccountId || "");
        setFeeAccountId(r.effective.feeAccountId || "");
        setClearing(r.effective.clearingByGateway || {});
      }
```

Replace with:

```ts
      if (r.effective) {
        setBankAccountId(r.effective.bankAccountId || "");
        setFeeAccountId(r.effective.feeAccountId || "");
        setClearing(r.effective.clearingByGateway || {});
        setIncomeAccountId(r.effective.defaultIncomeAccountId || "");
        setExpenseByKind(r.effective.expenseAccountByKind || {});
      }
```

Find, inside `save`:

```ts
        body: JSON.stringify({ bankAccountId, feeAccountId, clearingByGateway: clearing, actor: "founder" }),
```

Replace with:

```ts
        body: JSON.stringify({
          bankAccountId, feeAccountId, clearingByGateway: clearing,
          defaultIncomeAccountId: incomeAccountId, expenseAccountByKind: expenseByKind,
          actor: "founder",
        }),
```

- [ ] **Step 3: Add the new settings card**

Find the closing of the existing "Clearing account per gateway" card — the `</div>` right before the final `</div>` that closes the component's outer `<div className="space-y-4">`. The file currently ends:

```tsx
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#B08343] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#9a723a] disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save mapping
          </button>
          <span className="text-[12px] text-[#8A8175]">
            Saved values take precedence over the ZOHO_* environment variables; a field left blank falls back to env
            rather than unmapping it.
          </span>
        </div>
      </div>
    </div>
  );
}
```

Insert a new card between the existing gateway-clearing card's closing `</div>` (the one right before the final `</div></div>);` block) and that final closing, moving the "Save mapping" button/footer to be shared by both cards — i.e. replace that whole trailing block with:

```tsx
      </div>

      <div className="rounded-2xl border border-[#EAE3D6] bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-[15px] font-semibold text-[#1F1B16]">Bank transaction categories</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-[#8A8175]">
          Used by the Bank Transactions tab — one income account for every credit with no gateway match, and one
          expense account per debit kind. Map these once and every future statement upload posts with zero manual
          entry.
        </p>

        <div className="mb-4">
          <label className="mb-1.5 block text-[12px] font-medium text-[#1F1B16]">
            Default income account
            <span className="ml-1.5 font-normal text-[#8A8175]">where every credit posts from</span>
          </label>
          <AccountSelect value={incomeAccountId} onChange={setIncomeAccountId} accounts={all} placeholder="Select an income account…" />
          {cfg?.incomeReadiness && cfg.incomeReadiness.length > 0 && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#FBF2E6] px-2.5 py-1 text-[11.5px] font-medium text-[#B0742E]">
              <AlertTriangle size={12} /> {cfg.incomeReadiness.join(", ")}
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          {(cfg?.bankLineKinds ?? []).map((k) => {
            const missing = cfg?.kindReadiness.find((r) => r.kind === k)?.missing ?? [];
            const ok = missing.length === 0;
            return (
              <div key={k} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3">
                <span className="inline-flex min-w-[110px] items-center text-[13px] font-medium capitalize text-[#1F1B16]">
                  {k}
                </span>
                <div className="min-w-[240px] flex-1">
                  <AccountSelect
                    value={expenseByKind[k] ?? ""}
                    onChange={(v) => setExpenseByKind({ ...expenseByKind, [k]: v })}
                    accounts={all}
                    placeholder={`Select ${k} expense account…`}
                  />
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                    ok ? "bg-[#F0F5EF] text-[#4B7A54]" : "bg-[#FBF2E6] text-[#B0742E]"
                  }`}
                >
                  {ok ? <><Check size={12} /> Ready</> : <><AlertTriangle size={12} /> {missing.join(", ")}</>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[#EAE3D6] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#B08343] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#9a723a] disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save mapping
          </button>
          <span className="text-[12px] text-[#8A8175]">
            Saved values take precedence over the ZOHO_* environment variables; a field left blank falls back to env
            rather than unmapping it.
          </span>
        </div>
      </div>
    </div>
  );
}
```

This moves the single "Save mapping" button to its own trailing card so it saves all three cards (bank/fee accounts, gateway clearing, and the new bank-transaction categories) together — there is one settings row in the database, one save action.

- [ ] **Step 4: Manual verification**

Run: `npm run build`
Expected: build succeeds. Then visit `/settings` in a running dev server and confirm the new "Bank transaction categories" card renders with the income account selector and six kind selectors (salary, supplier, fee, tax, transfer, other).

- [ ] **Step 5: Commit**

```bash
git add components/finance/reconciliation/zoho-settings-panel.tsx
git commit -m "feat: add bank transaction category mapping to Zoho settings panel"
```

---

### Task 11: Bank Transactions tab UI

**Files:**
- Create: `components/finance/reconciliation/bank-txn-filters.tsx`
- Create: `components/finance/reconciliation/bank-txn-row.tsx`
- Create: `components/finance/reconciliation/bank-txn-post-dialog.tsx`
- Create: `components/finance/reconciliation/bank-transactions-tab.tsx`
- Modify: `components/finance/reconciliation/recon-view.tsx`

**Interfaces:**
- Consumes: `matchesBankTxnQuery`, `matchesPostStatus`, `PostStatusFilter` (Task 6); `GET /api/reconcile/bank-lines`, `PATCH /api/reconcile/bank-line/:id`, `POST /api/integrations/zoho/post-bank-lines` (Tasks 8, 9); `aed2` from `./types` (pre-existing); `gatewayColor` from `./colors` (pre-existing).
- Produces: `<BankTransactionsTab fromDate to Date onRange />` rendered by `recon-view.tsx` under a new `"transactions"` tab.

- [ ] **Step 1: Create `bank-txn-filters.tsx`**

```tsx
"use client";

import { Search } from "lucide-react";

export type Direction = "all" | "credit" | "debit";
export type PostStatusFilterValue = "all" | "posted" | "not_posted" | "failed";

export function BankTxnFilters({
  query, onQuery, direction, onDirection, postStatus, onPostStatus,
  fromDate, toDate, onRange, resultCount, totalCount,
}: {
  query: string; onQuery: (v: string) => void;
  direction: Direction; onDirection: (v: Direction) => void;
  postStatus: PostStatusFilterValue; onPostStatus: (v: PostStatusFilterValue) => void;
  fromDate: string; toDate: string; onRange: (from: string, to: string) => void;
  resultCount: number; totalCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8175]" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search narration, reference, amount…"
          className="w-full rounded-lg border border-[#EAE3D6] bg-white py-2 pl-8 pr-3 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343]"
        />
      </div>
      <select
        value={direction}
        onChange={(e) => onDirection(e.target.value as Direction)}
        className="rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[13px] text-[#1F1B16]"
      >
        <option value="all">Credits + debits</option>
        <option value="credit">Credits only</option>
        <option value="debit">Debits only</option>
      </select>
      <select
        value={postStatus}
        onChange={(e) => onPostStatus(e.target.value as PostStatusFilterValue)}
        className="rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[13px] text-[#1F1B16]"
      >
        <option value="all">Any Zoho status</option>
        <option value="not_posted">Not posted</option>
        <option value="posted">Posted</option>
        <option value="failed">Failed</option>
      </select>
      <label className="inline-flex items-center gap-1.5 text-[12px] text-[#8A8175]">
        From
        <input
          type="date" value={fromDate} max={toDate || undefined}
          onChange={(e) => onRange(e.target.value, toDate)}
          className="rounded-lg border border-[#D6CCBA] bg-white px-2 py-1.5 text-[12.5px] text-[#1F1B16]"
        />
      </label>
      <label className="inline-flex items-center gap-1.5 text-[12px] text-[#8A8175]">
        To
        <input
          type="date" value={toDate} min={fromDate || undefined}
          onChange={(e) => onRange(fromDate, e.target.value)}
          className="rounded-lg border border-[#D6CCBA] bg-white px-2 py-1.5 text-[12.5px] text-[#1F1B16]"
        />
      </label>
      <span className="text-[12px] text-[#8A8175]">{resultCount} of {totalCount}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create `bank-txn-row.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { gatewayColor } from "./colors";
import { aed2 } from "./types";

export type BankTxnLine = {
  id: string;
  date: string | null;
  description: string;
  zohoDescription: string | null;
  reference: string;
  amount: number;
  direction: "credit" | "debit";
  gatewayGuess: string | null;
  confidence: string | null;
  kind: string | null;
  batchId: string | null;
};

export type BankTxnPostingState = { status: string; zohoTransactionId: string | null; error: string; postedAt: string } | undefined;

export function BankTxnRow({
  line, posting, selected, onToggleSelect, onDescriptionSaved,
}: {
  line: BankTxnLine;
  posting: BankTxnPostingState;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDescriptionSaved: (id: string, zohoDescription: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(line.zohoDescription ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/reconcile/bank-line/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zohoDescription: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onDescriptionSaved(line.id, draft);
      toast.success("Description saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const statusTone =
    posting?.status === "posted" ? "bg-[#F0F5EF] text-[#4B7A54]" :
    posting?.status === "failed" ? "bg-[#F9ECE7] text-[#A6472F]" :
    "bg-[#F3EFE7] text-[#8A8175]";
  const statusLabel = posting?.status === "posted" ? "Posted ✓" : posting?.status === "failed" ? "Failed" : "Not posted";

  return (
    <div className="rounded-xl border border-[#EAE3D6] bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(line.id)} className="h-4 w-4" />
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-3 text-left">
          <span className="w-24 flex-shrink-0 text-[12.5px] text-[#8A8175]">{line.date ?? "—"}</span>
          <span className="flex-1 truncate text-[13px] text-[#1F1B16]">{line.description}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              line.direction === "credit" ? "bg-[#FBF3E6] text-[#6F5325]" : "bg-[#F3EFE7] text-[#8A8175]"
            }`}
          >
            {line.direction}
          </span>
          {line.gatewayGuess && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: gatewayColor(line.gatewayGuess) }}>
              <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(line.gatewayGuess) }} />
              {line.gatewayGuess}
            </span>
          )}
          {line.kind && <span className="text-[11px] capitalize text-[#8A8175]">{line.kind}</span>}
          <span className="w-28 flex-shrink-0 text-right text-[13px] font-medium text-[#1F1B16]">{aed2(line.amount)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone}`}>{statusLabel}</span>
          <ChevronDown size={14} className={`text-[#8A8175] transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="border-t border-[#EAE3D6] px-4 py-3 text-[12.5px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-[#8A8175]">Reference</span>
              <div className="font-mono text-[#1F1B16]">{line.reference || "—"}</div>
            </div>
            <div>
              <span className="text-[#8A8175]">Batch</span>
              <div className="text-[#1F1B16]">{line.batchId || "—"}</div>
            </div>
          </div>
          {posting?.status === "failed" && (
            <div className="mt-2 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[#A6472F]">{posting.error}</div>
          )}
          <label className="mt-3 block text-[12px] font-medium text-[#1F1B16]">
            Description sent to Zoho
            <div className="mt-1 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 rounded-lg border border-[#D6CCBA] bg-white px-3 py-1.5 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343]"
              />
              <button
                onClick={save}
                disabled={saving || draft === (line.zohoDescription ?? "")}
                className="rounded-lg bg-[#B08343] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : "Save"}
              </button>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `bank-txn-post-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { aed2 } from "./types";

export type PostPreviewLine = {
  bankLineId: string;
  status: "posted" | "failed";
  error?: string;
  posting?: { transaction_type: string; amount: number; description: string; date: string };
};

export function BankTxnPostDialog({
  bankLineIds, onClose, onPosted,
}: {
  bankLineIds: string[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const [preview, setPreview] = useState<PostPreviewLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/integrations/zoho/post-bank-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bankLineIds, dryRun: true }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setPreview(json.results);
      } catch (e) {
        toast.error((e as Error).message);
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // bankLineIds is a fixed snapshot for the lifetime of this dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setPosting(true);
    try {
      const res = await fetch("/api/integrations/zoho/post-bank-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineIds, actor: "founder" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const results = json.results as PostPreviewLine[];
      const failed = results.filter((r) => r.status === "failed").length;
      const ok = results.length - failed;
      toast.success(`${ok} posted to Zoho${failed ? `, ${failed} failed` : ""}`);
      onPosted();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#1F1B16]">Post {bankLineIds.length} to Zoho</h3>
          <button onClick={onClose}><X size={16} className="text-[#8A8175]" /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-[#8A8175]">
            <Loader2 size={16} className="animate-spin" /> Building preview…
          </div>
        ) : (
          <div className="space-y-2">
            {(preview ?? []).map((r) => (
              <div
                key={r.bankLineId}
                className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                  r.status === "failed" ? "border-[#A6472F]/30 bg-[#F9ECE7]" : "border-[#EAE3D6] bg-[#FBF8F1]"
                }`}
              >
                {r.status === "failed" ? (
                  <span className="inline-flex items-center gap-1.5 text-[#A6472F]"><AlertTriangle size={13} /> {r.error}</span>
                ) : (
                  <span className="text-[#1F1B16]">
                    {r.posting?.transaction_type} · {aed2(r.posting?.amount ?? 0)} · {r.posting?.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[#D6CCBA] bg-white px-4 py-2 text-[13px] text-[#1F1B16]">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={posting || loading || !preview?.some((r) => r.status === "posted")}
            className="inline-flex items-center gap-2 rounded-lg bg-[#B08343] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {posting ? <Loader2 size={15} className="animate-spin" /> : null} Confirm & post
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `bank-transactions-tab.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { matchesBankTxnQuery, matchesPostStatus, type PostStatusFilter } from "@/lib/reconciliation/bank-line-filters";
import { BankTxnFilters, type Direction, type PostStatusFilterValue } from "./bank-txn-filters";
import { BankTxnRow, type BankTxnLine, type BankTxnPostingState } from "./bank-txn-row";
import { BankTxnPostDialog } from "./bank-txn-post-dialog";

export function BankTransactionsTab({
  fromDate, toDate, onRange,
}: {
  fromDate: string; toDate: string; onRange: (from: string, to: string) => void;
}) {
  const [lines, setLines] = useState<BankTxnLine[]>([]);
  const [postings, setPostings] = useState<Record<string, BankTxnPostingState>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [postStatus, setPostStatus] = useState<PostStatusFilterValue>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const r = await fetch(`/api/reconcile/bank-lines?${params}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setLines(r.lines);
      setPostings(r.postings);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () =>
      lines
        .filter((l) => direction === "all" || l.direction === direction)
        .filter((l) => matchesBankTxnQuery(l, query))
        .filter((l) => matchesPostStatus(l.id, postings, postStatus as PostStatusFilter)),
    [lines, direction, query, postings, postStatus],
  );

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const onDescriptionSaved = (id: string, zohoDescription: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, zohoDescription } : l)));
  };

  return (
    <>
      <BankTxnFilters
        query={query} onQuery={setQuery}
        direction={direction} onDirection={setDirection}
        postStatus={postStatus} onPostStatus={setPostStatus}
        fromDate={fromDate} toDate={toDate} onRange={onRange}
        resultCount={visible.length} totalCount={lines.length}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-[14px] text-[#8A8175]">
          <Loader2 size={18} className="animate-spin" /> Loading bank transactions…
        </div>
      ) : lines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#8A8175]">
          No bank lines imported yet. Upload a statement (PDF, CSV, or XLS/XLSX) above.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#8A8175]">
          No lines match the current filters. {lines.length} line{lines.length === 1 ? " is" : "s are"} loaded.
        </div>
      ) : (
        <div className="space-y-2 pb-16">
          {visible.map((l) => (
            <BankTxnRow
              key={l.id}
              line={l}
              posting={postings[l.id]}
              selected={selected.has(l.id)}
              onToggleSelect={toggleSelect}
              onDescriptionSaved={onDescriptionSaved}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#D6CCBA] bg-white px-5 py-3 shadow-lg">
          <span className="text-[13px] text-[#1F1B16]">{selected.size} selected</span>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded-full bg-[#B08343] px-4 py-1.5 text-[13px] font-medium text-white"
          >
            Post to Zoho
          </button>
        </div>
      )}

      {dialogOpen && (
        <BankTxnPostDialog
          bankLineIds={[...selected]}
          onClose={() => setDialogOpen(false)}
          onPosted={() => { setSelected(new Set()); load(); }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Wire the new tab into `recon-view.tsx`**

Find the imports at the top and add:

```ts
import { BankTransactionsTab } from "./bank-transactions-tab";
```

Find:

```ts
type Tab = "all" | "settled" | "awaiting" | "exceptions" | "flagged" | "insights";
```

Replace with:

```ts
type Tab = "all" | "settled" | "awaiting" | "exceptions" | "flagged" | "transactions" | "insights";
```

Find:

```ts
  const TABS: [Tab, string, number][] = [
    ["all", "All credits", buckets.all.length],
    ["settled", "Settled", buckets.settled.length],
    ["awaiting", "Awaiting", buckets.awaiting.length],
    ["exceptions", "Exceptions", buckets.exceptions.length],
    ["flagged", "Flagged", buckets.flagged.length],
    ["insights", "Insights", -1],
  ];
```

Replace with:

```ts
  const TABS: [Tab, string, number][] = [
    ["all", "All credits", buckets.all.length],
    ["settled", "Settled", buckets.settled.length],
    ["awaiting", "Awaiting", buckets.awaiting.length],
    ["exceptions", "Exceptions", buckets.exceptions.length],
    ["flagged", "Flagged", buckets.flagged.length],
    ["transactions", "Bank Transactions", -1],
    ["insights", "Insights", -1],
  ];
```

Find, in the tab-button rendering:

```tsx
            {k === "insights" && <BarChart3 size={13} />}
            {k === "flagged" && <Flag size={13} />}
```

Replace with:

```tsx
            {k === "insights" && <BarChart3 size={13} />}
            {k === "flagged" && <Flag size={13} />}
            {k === "transactions" && <Landmark size={13} />}
```

Find:

```tsx
      ) : tab === "insights" ? (
        <InsightsTab lines={visible} />
      ) : lines.length === 0 ? (
```

Replace with:

```tsx
      ) : tab === "insights" ? (
        <InsightsTab lines={visible} />
      ) : tab === "transactions" ? (
        <BankTransactionsTab fromDate={fromDate} toDate={toDate} onRange={onRange} />
      ) : lines.length === 0 ? (
```

- [ ] **Step 6: Manual verification**

Run: `npm run build`
Expected: build succeeds. Then run `npm run dev`, open `/reconciliation`, click the new "Bank Transactions" tab, and confirm:
- The tab renders the empty state if no bank lines exist, or the filtered list if they do.
- Selecting rows shows the "N selected · Post to Zoho" bar.
- Clicking "Post to Zoho" opens the preview dialog (with Zoho configured and Settings mapped) or surfaces a clear per-line error otherwise.

- [ ] **Step 7: Commit**

```bash
git add components/finance/reconciliation/bank-txn-filters.tsx \
        components/finance/reconciliation/bank-txn-row.tsx \
        components/finance/reconciliation/bank-txn-post-dialog.tsx \
        components/finance/reconciliation/bank-transactions-tab.tsx \
        components/finance/reconciliation/recon-view.tsx
git commit -m "feat: add Bank Transactions tab with bulk Zoho posting"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1, 4, and 6, with no regressions in existing suites (`tests/parsers/bank.test.ts`, `tests/integrations/*.test.ts`, `tests/reconciliation/*.test.ts`).

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds, no new warnings from the modified/created files.

- [ ] **Step 4: Confirm the schema migration was applied**

Run: `node db/apply-schema.mjs`
Expected: reports the Task 3 statements already applied (idempotent — safe to re-run) or applies them now if Task 3 was committed but not yet run against the live database.

- [ ] **Step 5: End-to-end manual check** (requires Zoho configured + a real or test bank statement file)

1. Upload an `.xlsx` bank statement via the "Upload bank statement" button on `/reconciliation`.
2. Open the "Bank Transactions" tab — confirm both credit and debit lines appear.
3. Edit the description on one unfamiliar credit line and save it.
4. In Settings → Zoho Books, map a default income account and all six expense-by-kind accounts.
5. Back on the Bank Transactions tab, select a few lines and click "Post to Zoho" — confirm the preview shows the right account/amount/description per line, then confirm and verify the rows flip to "Posted ✓".
6. Re-select the same posted lines and attempt to post again — confirm no duplicate transactions are created in Zoho (idempotency via `BANKLINE-<id>` reference).

- [ ] **Step 6: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "chore: fix issues found during full verification pass"
```

(Skip this step if no fixes were needed.)
