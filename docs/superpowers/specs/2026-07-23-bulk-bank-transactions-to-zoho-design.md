# Bulk Bank Transactions → Zoho Books — Design Spec

Date: 2026-07-23
Status: Approved by founder, ready for implementation planning

## Context

The bookkeeper currently enters every bank statement line into Zoho Books by hand —
salary debits, supplier payments, bank fees, tax, and any credit the existing
gateway-reconciliation flow doesn't already explain. The ask: upload the bank
statement (PDF, XLS, or XLSX) once, see every parsed transaction in a review UI, and
push a bulk selection to Zoho's Bank Transactions module in one click. No more manual
entry.

This is **not** an extension of the existing gateway-payout reconciliation flow.
`lib/integrations/zoho-banking.ts` + `POST /api/integrations/zoho/post-payout`
already post *recognized gateway payout credits* to Zoho, as transfers out of a
per-gateway clearing account, once a credit is matched to a payout file and settled
(see `2026-07-16-recon-gateway-hardening-design.md` and
`2026-07-23-recon-search-grouping-insights-design.md`). That flow is unchanged by this
spec. This feature is confirmed to be independent of it — it treats every bank line
uniformly and does not check whether a credit is also a gateway payout. The two
systems can, in principle, both post something related to the same bank line; that's
an accepted tradeoff of keeping them decoupled, not a defect this spec fixes.

Two structural pieces already exist and are reused rather than rebuilt:

- `lib/parsers/bank.ts` + `POST /api/upload/bank` already parse a bank statement
  (CSV text or PDF-extracted text) into `bank_lines` — both credits **and** debits,
  with narration, reference, amount, direction, gateway guess, confidence, and (for
  debits) a `kind` classification (salary/supplier/fee/tax/transfer/other).
- `lib/integrations/zoho-banking.ts` already has generic, tested primitives for
  writing to Zoho's `/banktransactions` endpoint and checking for an existing
  transaction by reference number — today only ever called from the payout flow.

What's missing: XLSX/XLS ingestion, a review/filter UI over *all* bank lines
(not just unexplained credits), an editable description per line, an account-mapping
scheme general enough for arbitrary debits and credits, and a posting path that
writes plain categorized Zoho Bank Transactions instead of clearing-account
transfers.

## Scope

In scope:

1. XLSX/XLS parsing, reusing the existing CSV/PDF parser pipeline.
2. A new "Bank Transactions" tab on the reconciliation page, alongside the existing
   All/Settled/Awaiting/Exceptions/Flagged/Insights tabs.
3. Filtering (direction, date range, Zoho-post status, free-text search) and a
   per-line proof/detail view (date, amount, direction, narration, reference, source
   file).
4. An editable per-line description override, used when posting to Zoho.
5. A one-time Settings addition: default income account (credits) + expense account
   per debit `kind` (salary/supplier/fee/tax/transfer/other) — mirrors the existing
   gateway-clearing mapping panel's UX.
6. Bulk select → preview → post to Zoho as categorized `deposit` (credit) or
   `expense` (debit) Bank Transactions, idempotent by a stable per-line reference.


Out of scope:

- Any change to the existing gateway-payout clearing-account posting flow.
- Cross-checking or deduplicating against `zoho_postings` (the payout flow's
  tracking table) — confirmed as intentionally out of scope; the two flows don't
  know about each other.
- Per-line, ad-hoc account picking in the UI (e.g. "choose an account for this one
  transaction"). Categorization is entirely by the Settings-configured mapping;
  the only per-line override is the description text.
- Multi-currency / non-AED statements (the existing parser and `bank_lines` schema
  are AED-only today; unchanged here).

## Architecture

### 1. XLSX/XLS ingestion

`xlsx` (v0.18.5) is already a dependency, unused by the bank-statement path today.
`app/api/upload/bank/route.ts` currently branches only on `.pdf` vs. everything-else
(`buf.toString("utf8")`, which is correct for CSV/TXT but produces garbage for a
binary `.xlsx`/`.xls` file). Add a third branch:

```
if (file.name matches /\.xlsx?$/i) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];   // first non-empty sheet
  text = XLSX.utils.sheet_to_csv(sheet);
  // hand off under a synthetic .csv name so parseBankStatement's existing
  // header-synonym CSV path runs unchanged
  filenameForParser = "statement.csv";
}
```

No changes to `lib/parsers/bank.ts` itself — the CSV column-matching logic
(`matchHeader`, `tryParseCsvStatement`) already handles ENBD/ADCB/Mashreq/generic
header synonyms, and reusing it means one parser to maintain, not two. If the first
sheet parses to zero transactions, this spec does not attempt other sheets — that's a
follow-up if it turns out real statements are multi-sheet.

The existing "Upload bank statement" button's `accept` attribute
(`finance-workspace.tsx`) extends from `.pdf,.csv,.txt` to
`.pdf,.csv,.txt,.xls,.xlsx`.

### 2. Data model additions

```sql
-- Bookkeeper's override description, used only for the Zoho posting. The
-- original parsed narration in `description` is never overwritten — other
-- reconciliation UI and the dedupe/matching logic depend on it unchanged.
alter table bank_lines add column if not exists zoho_description text;

-- What THIS feature has posted. Deliberately separate from zoho_postings
-- (shaped for payout net/gross/fee triples) — a plain bank transaction is a
-- single amount against a single category account, a different shape.
create table if not exists zoho_bank_txn_postings (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null default 'omnia',
  bank_line_id       text not null,
  direction          text not null,           -- 'credit' | 'debit'
  transaction_type   text not null,           -- 'deposit' | 'expense'
  category_account_id text not null,          -- income or expense account used
  reference_number   text not null,           -- 'BANKLINE-<bank_line_id>'
  amount             numeric not null,
  zoho_transaction_id text,
  status             text not null default 'posted',  -- 'posted' | 'failed'
  error              text not null default '',
  posted_by          text not null default '',
  posted_at          timestamptz not null default now()
);
create unique index if not exists zoho_bank_txn_postings_line_idx
  on zoho_bank_txn_postings (bank_line_id);

-- Extends the existing single-row account-mapping config.
alter table zoho_account_config add column if not exists default_income_account_id text not null default '';
alter table zoho_account_config add column if not exists expense_account_by_kind jsonb not null default '{}';
```

Per the project's schema workflow, these are `alter table` statements appended to
`db/schema.sql`, applied live via `node db/apply-schema.mjs` — editing the file alone
does not touch the database.

### 3. Settings — new panel section

Extends `ZohoSettingsPanel` (not a new page) with a third card, visually consistent
with the existing "Clearing account per gateway" card:

- One `AccountSelect` for the default income account (applies to every credit line
  posted through this feature).
- Six `AccountSelect`s, one per debit `kind` (salary, supplier, fee, tax, transfer,
  other) — reusing the existing `kind` classification `lib/parsers/bank.ts` already
  produces for every debit.
- Same readiness pattern as the gateway table: a kind with no mapped account shows
  "not ready" and is excluded from bulk-postable rows until mapped, rather than
  guessed.

`ZohoConfigRepository.getAccountMap`/`saveAccountMap` extend to read/write these two
new fields on the same `zoho_account_config` row; `GET /api/integrations/zoho/account-config`
returns them alongside the existing gateway mapping so one settings load covers both
features.

### 4. New "Bank Transactions" tab

Added to the `Tab` union and `TABS` array in `recon-view.tsx`, alongside
`all | settled | awaiting | exceptions | flagged | insights`. New tab renders a new
component, `bank-transactions-tab.tsx`, in `components/finance/reconciliation/`,
following the same file-per-concern pattern as the rest of that directory:

| File | Responsibility |
|---|---|
| `bank-transactions-tab.tsx` | Orchestrator: fetch, filter state, selection state |
| `bank-txn-filters.tsx` | Direction toggle, date range, Zoho-status filter, search |
| `bank-txn-row.tsx` | One line: summary row + expandable proof detail + description edit |
| `bank-txn-post-dialog.tsx` | Preview (account + amount per selected line) → confirm → post |

Reuses `lib/reconciliation/filters.ts`'s `matchesQuery` pattern (extended for
narration/reference/amount on a bank line rather than a recon line) rather than
introducing a second search implementation.

**Table columns**: date, narration (truncated, full text in proof), reference,
amount, direction badge (credit=gold, debit=muted per existing `colors.ts` palette),
kind/gateway chip, Zoho status (Not posted / Posted ✓ / Failed, with the failure
reason on hover).

**Proof/detail** (expand row): full narration, reference, source filename +
uploaded-at (via `FilesRepository`, same as the existing "Bank actuals" documents
panel), original description vs. the editable override.

**Description edit**: a text input in the expanded row, saved via
`PATCH /api/reconcile/bank-line/[id]` (`{ zohoDescription: string }`) — a small,
single-purpose endpoint alongside the existing `/api/reconcile/[action]` and
`/api/reconcile/line/[id]/orders` routes.

**Bulk post**: checkbox per row (disabled + tooltipped when the line's `kind`/credit
has no mapped account in Settings), a sticky "Post N to Zoho" bar appears once
anything is selected, opens `bank-txn-post-dialog.tsx` showing exactly what will be
created (account name, direction, amount, description) before the write — same
dry-run-before-write pattern as the existing payout posting dialog.

### 5. Posting mechanics

New pure builder in `lib/integrations/zoho-banking.ts`, alongside the existing
`buildPayoutPostings`:

```ts
export function buildBankLinePosting(
  line: { id: string; direction: "credit" | "debit"; amount: number; date: string;
          kind: string | null; description: string },
  accounts: { bankAccountId: string; defaultIncomeAccountId: string;
              expenseAccountByKind: Record<string, string> },
): ZohoPosting // { transaction_type, from_account_id, to_account_id, amount, date, description, referenceNumber }
```

- Credit → `transaction_type: "deposit"`, `to_account_id = bankAccountId`,
  `from_account_id = defaultIncomeAccountId`.
- Debit → `transaction_type: "expense"`, `from_account_id = bankAccountId`,
  `to_account_id = expenseAccountByKind[line.kind ?? "other"]`.
- `referenceNumber: "BANKLINE-" + line.id` — stable and always present, unlike the
  parsed bank `reference` field (often blank for non-wire debits), so
  `findBankTransactionByReference` (already exists, already tested) gives real
  idempotency: re-clicking "post" after a partial failure never double-creates.
- Throws (same style as `buildPayoutPostings`) when the required account isn't
  mapped, naming which one — the caller uses this to pre-filter which rows are
  bulk-postable before the dry-run preview even opens.

New route `POST /api/integrations/zoho/post-bank-lines` (`{ bankLineIds: string[],
actor: string }`):

1. Load the `zoho_account_config` mapping (DB, falling back to env — same
   `mergeAccountMaps` pattern extended with the two new fields).
2. Load each bank line, build its posting, call `createBankTransaction` with an
   idempotency check via `findBankTransactionByReference` first (mirrors
   `postPayoutToZoho`'s existing per-posting check-then-create).
3. **Each line is independent** — unlike a payout's net+fee pair (which must both
   land or the clearing account is left stranded), a bulk batch of unrelated ledger
   lines has no such coupling. One line's failure doesn't block the rest; the
   response reports per-line `{ bankLineId, status: "posted" | "failed", error? }`.
4. Record every attempt (success or failure) to `zoho_bank_txn_postings`, so the tab
   can show "Posted ✓" / "Failed — <reason>" on reload without a Zoho round trip per
   row, matching the existing `listPostings()` pattern.

## Testing

- `tests/parsers/bank-xlsx.test.ts` — a small workbook (openpyxl-style fixture, or a
  hand-built `xlsx.utils.aoa_to_sheet`) with ENBD-style headers produces the same
  `ParsedBankLine[]` shape as the equivalent CSV fixture already in
  `tests/parsers/bank.test.ts`.
- `tests/integrations/zoho-banking.test.ts` (extended) — `buildBankLinePosting`:
  correct account ids for credit vs. debit, correct `kind` fallback to "other" when
  unmapped, stable `BANKLINE-<id>` reference, throws naming the missing account when
  unmapped.
- `tests/integrations/zoho-account-map.test.ts` (extended) — the two new
  `zoho_account_config` fields merge DB-over-env like the existing ones.

## Open items carried into implementation planning

- Exact API shape for the filter/list endpoint backing the new tab (likely a new
  `GET /api/reconcile/bank-lines` with query params for direction/date/status/search,
  server-side paginated the same way `bank_lines` is queried elsewhere) — left to the
  implementation plan rather than fixed here.
- Whether "first non-empty sheet" is sufficient for real-world multi-sheet exports —
  flagged in §1, deferred until a real multi-sheet statement surfaces.
