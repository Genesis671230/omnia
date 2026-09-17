# Tabby payout email ingest, gateway entity separation, and the confirm-without-proof fix

**Date:** 2026-09-17
**Status:** approved design, pending implementation plan

## Problem

176 of 238 reconciliation lines sit in `AWAITING_PAYOUT`. The payout reports
that would clear them arrive by email and are downloaded and uploaded by hand,
one file at a time. Three separate defects compound the backlog:

1. **No automatic ingest.** Tabby emails a settlement report as an `.xlsx`
   attachment on every payout. Today someone must notice the mail, download the
   file, and upload it through the UI.
2. **Confirmed rows can strand.** `confirmLine()` writes `confirmed_by` with no
   check that a payout exists, and the UI offers the Confirm button on
   `AWAITING_PAYOUT` rows. Four credits are confirmed with `payout_id: null`.
   Because the upload control is gated on `!confirmedBy`, those rows can never
   receive a file through the UI — they are permanently stuck.
3. **Gateway identity is too coarse.** `classifyBankCredit()` resolves every
   Tabby narration to `Tabby` and every Tamara narration to `Tamara`, losing the
   legal entity and therefore the currency rail. A Tabby SAR payout can match a
   Tabby AED credit whenever the amounts fall inside the 2% window.

A fourth defect surfaced while reading live data and is latent until automation
lands (see *Payout ID collisions*).

## Evidence

Live figures from the production database on 2026-09-17:

- 238 recon lines: 176 `AWAITING_PAYOUT`, 31 `SETTLED`, 29 `PAYOUT_VARIANCE`, 2 `ORDERS_UNRESOLVED`.
- 22 confirmed lines, of which 4 resolve to no payout (`recon_lines.payout_id IS NULL`, `match_status = AWAITING_PAYOUT`).
- 9 Tabby payouts spanning three currency rails: AED, SAR, **KWD**.

Bank narrations carry the entity verbatim:

| Narration fragment | Entity | Currency |
|---|---|---|
| `TABBY LLC`, `TABBY L.L.C` | Tabby LLC | AED |
| `TABI COMPANY FOR FINANCING MUSAHAMA`, `TABBY FINANCING COMPANY JSC` (SA SABB 003-777729-001) | Tabby KSA | SAR |
| `TAMARA FZE` | Tamara FZE | AED |
| `TAMARA FINANCE COMPANY` (SA SABB 011-788320-002) | Tamara Finance | SAR |

A real payout email (forwarded sample, 2026-09-14) establishes the transport:

- Original sender `notifications@tabby.ai`, subject `You're getting a payout from Tabby`.
- Two attachments: `2026-09-14 AED settlement report Omniastores UAE Paylink.xlsx`
  (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) and a
  decoy `blocked.gif` (`image/gif`).
- Body states the store name, payout total, sales, commission and VAT — usable
  as an independent cross-check against the parsed file.
- **The mail reaches the target mailbox forwarded** via `support@omniastores.com`,
  so `From:` is the forwarder, not Tabby.

## Design

### 1. Gateway entity model — `lib/gateways.ts`

```ts
export type PayoutEntity =
  | "TABBY_AE" | "TABBY_SA" | "TABBY_KW"
  | "TAMARA_AE" | "TAMARA_SA";
```

`classifyBankCredit()` gains entity detection returning `{ provider, entity, confidence }`.
Rules are evaluated **most-specific-first**, because the SAR entity names contain
the AED keyword (`TABBY FINANCING COMPANY JSC` contains `TABBY`). Narration is
normalized first — strip `.`, collapse whitespace, uppercase — so `TABBY L.L.C`
and `TABBY LLC` resolve through one rule.

Payout-side entity derives from the **file's own currency**, never the sender:
a Tabby SAR statement is `TABBY_SA` whichever mailbox delivered it. The sender is
a cross-check that logs a warning on disagreement rather than overriding.

### 2. Matching constraint — `lib/reconciliation/engine.ts`

`computeReconLines()` adds entity agreement to candidate selection:

```ts
entitiesCompatible(a, b) === (a == null || b == null || a === b)
```

Unknown on either side never blocks a match. This can only tighten matching where
real evidence exists and never loosens or breaks an existing match — important,
since the change affects all 238 lines, not just Tabby.

### 3. Confirm guard and stuck-row repair

- `confirmLine()` reads `recon_lines.payout_id` first and throws when null.
  `persistResults()` refreshes that column on every reconcile, so the guard is a
  single cheap select against authoritative state.
- The API route returns 409 with a plain-language message.
- The Confirm button is hidden on `AWAITING_PAYOUT` rows.
- **The upload slot's gate inverts**: it renders whenever `!line.payout`,
  *regardless of `confirmedBy`*. This is the change that unsticks the 4 rows.
- The 4 existing rows keep `confirmed_by` — the audit record of what a human
  clicked is not erased — and render a `Confirmed · proof missing` badge until a
  file lands, after which they resolve through the normal path.

### 4. Payout ID collisions

Tabby's statement number is date+currency only (`Tabby20260914AED`) and carries no
store token, while Tabby issues **one report per store**. The `payouts.id`
primary key is that statement number, so every same-date same-currency report
overwrites its predecessor.

This is not hypothetical. Scanning the settlement reports in `~/Downloads`
against `parsePayoutFile()` found **13 distinct payouts collapsing onto 5 primary
keys**:

| Statement # | Distinct payouts | Nets |
|---|---|---|
| `Tabby20260706AED` | 3 | 8126.21 / 12199.51 / 57486.65 |
| `Tabby20260907AED` | 2 | 41080.84 / 36243.51 |
| `Tabby20260907SAR` | 2 | 12505.79 / 13836.94 |
| `Tabby20260914AED` | 3 | 34695.28 / 14477.55 / 13589.71 |
| `Tabby20260914SAR` | 3 | 9876.21 / 3190.91 / 55964.48 |

The file the founder was about to upload — `2026-09-14 AED settlement report
Omniastores UAE (1).xlsx`, net **34695.28**, the exact amount of one of the four
stuck credits — parses to `Tabby20260914AED`, the key already held by the
Omniastores UAE Paylink payout of 14477.55. Uploading it today destroys a
correctly matched payout.

**Store name alone is an insufficient discriminator.** Under `Tabby20260914AED`
two files share merchant code `OSUAEPL` with different nets (14477.55 and
13589.71), so identity needs a content component.

Payout identity becomes, in order of increasing specificity:

```
<statement #>[-<merchant code slug>][-<content hash>]
```

- The merchant segment is added only when a different merchant already holds the
  statement number. `Merchant Name` and `Merchant Code` are **columns inside the
  transaction table** (`Omniastores UAE` / `AE`, `Omniastores UAE Paylink` /
  `OSUAEPL`), so they are read from data, never from a filename decorated with
  `(1)` or `36`.
- The content hash — first 6 hex of a SHA-1 over the sorted order-ref list — is
  added only when the statement+merchant pair still collides with a *different*
  set of orders. It is deterministic, so re-ingesting an identical file yields
  the identical ID and upserts harmlessly; idempotency is preserved.
- **Existing payout IDs are never rewritten.** `payouts.id` is referenced by
  `payout_transactions`, `payout_ref_links`, `recon_lines` and settlements; a PK
  migration across live reconciled data is the riskiest available fix. The first
  file to claim a statement number keeps the bare ID.

A one-off reconciliation script reports which historical payouts were lost to
this collision so they can be re-uploaded deliberately; it changes no existing row.

### 5. Gmail ingest subsystem

**`lib/integrations/gmail.ts`** — self-rolled OAuth in the established house style
of `zoho.ts` and `google-sheets.ts`: refresh token → cached access token, no new
npm dependency. Read-only scope (`gmail.readonly`). Exposes `gmailConfigured()`,
`searchMessages()`, `getMessage()`, `getAttachment()`. No-ops until configured.

**`app/api/integrations/gmail/connect` + `/callback`** — one-time consent that
mints the refresh token and displays it for `.env.local`.

**`lib/finance/payout-email-ingest.ts`** — the orchestrator:

1. Search each configured mailbox for candidate messages.
2. Select attachments by MIME type / extension (`.xlsx`, `.csv`), discarding
   images and inline decoys such as `blocked.gif`.
3. Feed bytes to the existing `parsePayoutFile()` — unchanged.
4. Upsert via `PayoutsRepository.upsertPayouts()`, **unpinned**, so the existing
   auto-matcher claims them exactly as if uploaded by hand.
5. Archive the raw file via `FilesRepository.save()`.
6. Record the attempt in `payout_email_ingests`.

Message matching keys on **subject plus a parseable settlement attachment**, with
sender as one signal among several — never on sender alone, because forwarding
rewrites `From:`. Sender registry entries (`notifications@tabby.ai`,
`notifications@tabby.sa`) act as confidence boosters and currency hints.

**`payout_email_ingests`** table, keyed on Gmail `message_id` (UNIQUE) for
idempotency: re-polling the same email is a no-op, and every attempt including
failures is auditable.

```sql
create table if not exists payout_email_ingests (
  id uuid primary key,
  tenant_id text not null,
  message_id text not null unique,
  mailbox text not null,
  sender text,
  subject text,
  received_at timestamptz,
  provider text,
  entity text,
  attachment_name text,
  payout_id text,
  status text not null,          -- ingested | skipped | failed
  error text,
  created_at timestamptz default now()
);
```

**`lib/scheduler/payout-email-scheduler.ts`**, wired into `instrumentation.ts`
alongside the existing seven schedulers, plus a manual "Check Gmail now" trigger
at `app/api/integrations/gmail/ingest`.

Configuration is mailbox-list driven so a second account is an env change, not a
code change:

```
GMAIL_USER=marketingomniastore@gmail.com   # comma-separated list supported
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
GMAIL_REDIRECT_URI
GMAIL_INGEST_INTERVAL_MINUTES              # optional
```

### 6. Per-row drag-and-drop

Drop handlers on the table row in `recon-table.tsx` and on the detail dialog,
POSTing to the existing `/api/upload/payout` with `provider` and `bankLineId`,
reusing the pin-to-credit path already present at `upload/payout/route.ts:44`.
The row highlights on drag-over and rejects non-spreadsheet MIME types.

## Schema changes

- `payouts.entity` (text, nullable)
- `payouts.store` (text, nullable) — merchant name
- `payouts.merchant_code` (text, nullable) — `AE`, `OSUAEPL`, `ORPL`, `SA`, `ksa`
- `payouts.statement_no` (text, nullable) — the raw statement number before disambiguation
- `bank_lines.entity` (text, nullable)
- `payout_email_ingests` (new table)

`db/schema.sql` is not the live database. **`node db/apply-schema.mjs` must run**
after editing it, or every API touching a new column returns 500 with "column
does not exist" and takes down the whole reconcile response.

## Testing

Pure functions, unit tested under `tests/` with the existing `tsx --test` runner:

- entity classification, including the `TABBY LLC` / `TABBY L.L.C` normalization
  and the SAR-before-AED ordering trap
- `entitiesCompatible()`, especially that unknown never blocks
- the store-slug derivation and collision-suffix rule
- attachment selection, asserting `blocked.gif` is discarded and the `.xlsx` chosen
- subject-based message matching against a forwarded message whose `From:` is
  not Tabby

Transport tests stub `fetch`. The confirm guard gets a test asserting a
payout-less line refuses confirmation.

## Out of scope

- Tamara email ingest — the sender registry is built generically, so wiring
  Tamara is a configuration addition in a following pass.
- Any change to `parsePayoutFile()` or the per-order proof/FX math.
- Rewriting existing payout primary keys.
