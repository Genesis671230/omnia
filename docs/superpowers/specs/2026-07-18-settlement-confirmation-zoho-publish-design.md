# Per-Order Settlement Confirmation → Zoho Books Publish — Design

## Problem

`settlement_records` (written by `lib/reconciliation/engine.ts` whenever a
recon line reaches `SETTLED`) currently has no evidence trail. A founder or
accountant has no reliable, linkable way to confirm "this order's money
really landed" before treating it as real revenue in Zoho Books. Stripe
already exposes an authoritative per-order breakdown via
`payoutOrderRefs()` (used today only as an ephemeral UI panel — see
`app/api/payouts/[id]/stripe-proof/route.ts`), but for every other gateway
(Tabby, Tamara, Checkout.com, COD, Shopify Payments) there is no API at
all — the only evidence is a manually uploaded statement file, and today
there's no way to point anyone at that file's specific proof or to confirm
it.

Separately, there is currently zero path from Omnia's settlement data into
Zoho Books — `lib/integrations/zoho.ts` is explicitly read-only (Inventory
API, used only for the inventory three-way-compare).

## Goal

1. Every `settlement_records` row ends up with an `evidence_type` — either
   automatically Stripe-verified, or backed by an uploaded document that a
   human has explicitly confirmed via a shareable link.
2. Only evidence-confirmed settlements are eligible for a manual, reviewed,
   batch "publish to Zoho Books" action that writes a real Customer Payment
   against the order's existing Zoho invoice.

## Live findings that shape this design

Verified via a read-only probe against the real Zoho org (org id in
`ZOHO_ORGANIZATION_ID`), not assumed:

- The existing OAuth token's scope is `ZohoInventory.fullaccess.all`. Direct
  calls to the separate Books API (`zohoapis.com/books/v3/...`) return
  `401 code 57 "not authorized"` under this token — **no Books-scoped
  access exists today.**
- The Inventory API's `/inventory/v1/customerpayments` endpoint **does**
  work under the current token (verified via `GET`, returned real payment
  records with `payment_mode`, `account_name`, `applied_invoices`). Since
  Inventory and Books share one org ledger, this is the write path we use —
  no new OAuth app/scope needed. (A live `POST` was not attempted during
  design, since that would create a real payment; write access is strongly
  implied by the `fullaccess` scope name but confirmed empirically only in
  Task 4 below, behind a manual review gate.)
- Order-to-Zoho matching key confirmed by direct comparison: Omnia's
  `order_number` (Shopify: `raw.name` minus `#`, e.g. `"728899"`; Woo:
  `raw.number`, e.g. `"WA55228"`) matches verbatim against Zoho
  `salesorder_number` / invoice `reference_number` values pulled live from
  the same org.

## Data model changes

### `settlement_records` — new columns

```sql
alter table settlement_records
  add column if not exists evidence_type text,        -- 'stripe_api' | 'document' | null
  add column if not exists evidence_confirmed boolean not null default false,
  add column if not exists evidence_confirmed_by text,
  add column if not exists evidence_confirmed_at timestamptz,
  add column if not exists evidence_document_id uuid,
  add column if not exists zoho_payment_id text,
  add column if not exists zoho_published_at timestamptz;
```

`evidence_type='stripe_api'` rows get `evidence_confirmed` set true
automatically at write time (no human step — see Stripe flow below).
`evidence_type='document'` rows start `evidence_confirmed=false` until the
linked document is confirmed via its public link.

### New `settlement_documents` table

One row per uploaded evidence file. A single uploaded payout statement can
evidence many orders (e.g. one Tabby settlement file covering 40 orders),
so this is a one-to-many parent, not folded into `settlement_records`
directly.

```sql
create table settlement_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'omnia',
  uploaded_file_id uuid not null references uploaded_files(id),
  confirm_token text not null unique,       -- random, unguessable; public URL key
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index settlement_documents_token_idx on settlement_documents(confirm_token);
```

### New `settlement_document_links` join table

```sql
create table settlement_document_links (
  settlement_document_id uuid not null references settlement_documents(id),
  settlement_record_id text not null references settlement_records(id),
  primary key (settlement_document_id, settlement_record_id)
);
```

Confirming a document (`confirmed_by`/`confirmed_at` set) cascades:
every `settlement_records` row joined through
`settlement_document_links` gets `evidence_confirmed=true`,
`evidence_confirmed_by`, `evidence_confirmed_at` set to match.

## Flow 1 — Stripe auto-verification

In `lib/reconciliation/engine.ts` `persistResults()`, where
`settlement_records` rows are currently built for `SETTLED` lines
(around L295-318): for lines whose `gateway === "Stripe"` and where
`stripeConfigured()`, call `payoutOrderRefs(payoutId)` (already exists,
`lib/integrations/stripe.ts`) once per payout, and for each resolved order
check whether its ref appears in the returned `refs`. If present, set
`evidence_type='stripe_api', evidence_confirmed=true,
evidence_confirmed_by='stripe-api', evidence_confirmed_at=now()` on that
row. If the Stripe API call fails or the ref is absent, leave the row
unconfirmed (`evidence_type=null`) rather than assuming success — this
surfaces as "awaiting evidence" in the UI like any other gateway, which is
correct: our engine's own match disagreeing with Stripe's ledger is a real
discrepancy to flag, not paper over.

This runs at the same cadence persistResults already runs at (sync
cycles) — no new scheduler.

## Flow 2 — Document upload + public confirm link

1. Upload continues to go through the existing
   `app/api/upload/payout/route.ts` → `FilesRepository.save()` path
   unchanged (produces an `uploaded_files` row).
2. New step after upload: ops selects which `settlement_records` this file
   evidences (UI defaults to "every order in this payout's recon line",
   overridable). This creates one `settlement_documents` row (with a fresh
   random `confirm_token`) and the corresponding
   `settlement_document_links` rows.
3. New public route `GET /confirm/[token]` (page, no auth) — resolves the
   token to its document + linked orders, renders the document (reusing
   the existing file-serving logic from `app/api/files/[id]/route.ts`) and
   an order list with amounts, plus a "Confirm settlement" button gated
   behind typing a name/email.
4. New route `POST /api/confirm/[token]` — validates the token, requires a
   `confirmedBy` string in the body, sets `confirmed_by`/`confirmed_at` on
   `settlement_documents`, and cascades `evidence_confirmed=true` to every
   linked `settlement_records` row. Idempotent — confirming an
   already-confirmed token is a no-op that returns the existing
   confirmation, not an error.

## Flow 3 — Zoho Books publish (manual bulk-approve batch)

New function in `lib/integrations/zoho.ts`:

```ts
export async function createZohoCustomerPayment(input: {
  invoiceReferenceNumber: string; // == order_number
  amount: number;
  paymentMode: string; // mapped from settlement gateway, e.g. "Stripe" -> "Bank Transfer"
  referenceNumber: string; // our bank_reference, for traceability in Zoho
}): Promise<{ payment_id: string }>
```

It looks up the matching invoice via `GET /inventory/v1/invoices` filtered
by `reference_number`, then `POST /inventory/v1/customerpayments` with the
matched `invoice_id`, `customer_id` (read off the matched invoice), and the
input amount/mode/reference. Throws if zero or multiple invoices match —
ambiguous matches are not silently guessed.

New route `POST /api/settlements/publish` accepts an array of
`settlement_records.id`s (must all have `evidence_confirmed=true` and no
existing `zoho_payment_id` — server-side re-check, not just a UI filter).
For each: calls `createZohoCustomerPayment`, and on success stores the
returned `payment_id` into `zoho_payment_id` + `zoho_published_at`. Returns
per-row success/failure (one bad match shouldn't fail the whole batch —
same pattern as the existing per-account Meta ads isolation).

## UI — new "Settlements" panel

Added alongside the existing Recon/Orders/Customers panels in
`finance-workspace.tsx`. Grouped by payout:

- Badge per settlement: `✅ Stripe-verified` / `✅ Doc-confirmed` /
  `⏳ awaiting upload` / `⏳ awaiting confirmation` / `📤 published`.
- Upload action for non-Stripe payouts lacking a document.
- Once a document is uploaded, shows its `/confirm/[token]` link
  (copyable) so ops can send it to whoever needs to confirm.
- "Ready to publish" section lists all `evidence_confirmed && !zoho_payment_id`
  rows with checkboxes; a "Publish selected to Zoho" button calls
  `/api/settlements/publish` and shows per-row pass/fail after.

## Out of scope

- Creating/updating Zoho invoices themselves — we only record payments
  against invoices that already exist in Zoho.
- Any API-based verification for Tabby/Tamara/Checkout.com/Shopify
  Payments/COD — these stay document-only, matching current reality.
- Automatic (non-reviewed) Zoho publishing.
- Retroactive backfill of evidence for settlement_records created before
  this feature — they simply show as "awaiting evidence" like any other
  unconfirmed row; no special migration needed since the schema addition
  defaults `evidence_confirmed=false`.
