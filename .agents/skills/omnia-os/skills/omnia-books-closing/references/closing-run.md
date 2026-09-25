# Closing run: commands and file flow

Work in a scratch folder (`$W`). Copy each template into the repo as `scripts/_x.ts`
before running; delete the copies after. `.env.local` holds Supabase, Zoho, Stripe,
Google service account.

## 0. Budget

```ts
import { zohoQuotaStatus } from "@/lib/integrations/zoho-throttle"; // { used, budget }
```
Full-month plan ≈ 1,000 Zoho calls, live post ≈ 6 per order + 4 per refund, read-back
≈ 4 per order. Stop and tell the founder if it won't fit today.

## 1. Open invoices on received money (read only)

```
npx tsx --env-file=.env.local scripts/_open-invoices-report.ts $W/report.json
```
Writes matched lines (payout with resolved orders), settlement records, every open Zoho
invoice (unpaid, partially_paid, overdue, draft, sent) and orders. Match invoices by the
first token of `customer_name` = order number, retry without the store prefix
(`WA|UAE|KSA|WOO|SA|OS`). An order on two credits is usually a split payment (small
Stripe top-up + Tabby) or an exchange top-up; group those, don't double count.

## 2. Engine dry run (read only)

```
FROM=2026-09-01 npx tsx --env-file=.env.local scripts/_plan-closings.ts $W/plan.json
```
- Recomputes lines with `computeReconLines` (not `runReconciliation`, which persists).
- Uses real settlement records plus in-memory stand-ins for resolved orders of
  unconfirmed credits (id `DRY:…`), never persisted.
- Also dry runs `publishRefunds` per credit, and pulls credit notes since FROM.
- `results[].steps.payment`: `would_post` = invoice still open; `already_done` =
  booked earlier (most of a month is this). Only `would_post` rows are "open invoices".

Classify into the groups in SKILL.md. Regex on `message` for review reasons:
`doesn't match the gateway's order amount`, `has \d Zoho invoices`, `same AED`,
`No Zoho invoice`, `no per-order fee`, `paid against it outside`, `nothing received`.

## 3. Plan workbook for approval

Sheets: Summary, 1 Close now (payment, deposit account, fee, VAT, fee ex-VAT, net,
difference, check column = 0), 2 Close + FX, 3 Split payments, 4 Needs review. Ask
numbered questions; one answer per group.

## 4. Post (only after explicit approval)

```
FROM=2026-09-01 EXCLUDE_A=WA55658 npx tsx --env-file=.env.local scripts/_post-approved.ts $W/dry.json $W/ready-refunds.json      # dry
FROM=2026-09-01 EXCLUDE_A=WA55658 npx tsx --env-file=.env.local scripts/_post-approved.ts $W/live.json $W/ready-refunds.json --live
```
Per confirmed credit it: `confirmEvidenceForBankLine` (as the route does), dry runs all
records, then posts S1 (`would_post`), Group A (force allocation of the single open
invoice whose balance equals the engine's figure; only when gap ≤ 3.5% and gross ≈ fee +
net), Group G (`bookFeesOnExternallyPaid: true`), then the approved refunds. Records a
`zoho_publish_runs` row. Edit the script's sets if the founder approved differently
(e.g. drop G entirely).

Stuck `PENDING:` payment marker on an already-booked order: run that single record
through `publishSettlements` (dry, then live). Expected steps
`payment: found_existing, fee: already_done, difference: already_done`.

## 5. Read back and snapshot

```
FROM=2026-09-01 npx tsx --env-file=.env.local scripts/_readback.ts $W/live.json $W/readback.json
node .claude/skills/omnia-books-closing/scripts/build-ledger-snapshot.cjs $W ~/Downloads/Booking_Report_and_Ledger_<date>.xlsx
```
See `ledger-snapshot.md` for sheet layout and the checks that must hold.
