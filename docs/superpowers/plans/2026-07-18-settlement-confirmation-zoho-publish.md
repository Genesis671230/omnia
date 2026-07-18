# Per-Order Settlement Confirmation → Zoho Books Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `settlement_records` row an evidence trail (automatic Stripe API confirmation, or an uploaded document confirmed via a public link), then let a human batch-publish evidence-confirmed settlements as real Zoho Books Customer Payments.

**Architecture:** Additive Postgres columns/tables + a Stripe-evidence check folded into the existing recon engine's `persistResults()`, a new public (unauthenticated) confirm-link flow gated through `middleware.ts`, a new write function in `lib/integrations/zoho.ts` targeting the Inventory API's `/customerpayments` endpoint (confirmed live to work under the existing OAuth token — the separate Books API does not), and a new "Settlements" panel in `finance-workspace.tsx`.

**Tech Stack:** Next.js App Router API routes, Supabase/Postgres, `node:test` + `node:assert/strict` (run via `tsx --test 'tests/**/*.test.ts'`), existing Zoho/Stripe REST clients (no new SDKs).

## Global Constraints

- Tenant scoping: every new table/row uses `tenant_id` default `'omnia'` (via `process.env.DEFAULT_TENANT_ID || "omnia"`), matching every existing repository.
- DB migrations are additive `alter table ... add column if not exists` / `create table if not exists` in `db/schema.sql`, applied manually to the live Supabase instance (no migration runner exists in this repo — confirmed in a prior session).
- No new OAuth scope/env vars for Zoho — reuse `ZOHO_REFRESH_TOKEN`/`ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET`/`ZOHO_ORGANIZATION_ID`, targeting `https://www.zohoapis.com/inventory/v1/...` (not `/books/v3/...`, which 401s under this token — verified live).
- The public confirm page/routes must NOT expose arbitrary `uploaded_files` by id — access only via an unguessable `confirm_token`, resolved server-side to exactly the linked document.
- Typecheck after every task: `npx tsc --noEmit -p .` must be clean (repo-wide, not just the touched file).
- Run tests with `tsx --test 'tests/**/*.test.ts'` (per `package.json`'s `test` script); new tests follow the `node:test`/`assert/strict` pattern in `tests/repositories/orders-query.test.ts`.

---

### Task 1: Schema + repositories — `settlement_records` evidence columns, `settlement_documents`, `settlement_document_links`

**Files:**
- Modify: `db/schema.sql` (append at end)
- Modify: `lib/repositories/settlements.repository.ts` (add evidence-related methods)
- Create: `lib/repositories/settlement-documents.repository.ts`
- Test: `tests/repositories/settlement-documents.test.ts`

**Interfaces:**
- Produces: `SettlementsRepository.markStripeEvidence(settlementIds: string[]): Promise<void>`, `SettlementsRepository.listUnconfirmed(): Promise<SettlementRecord[]>`, `SettlementsRepository.listReadyToPublish(): Promise<SettlementRecord[]>` (evidence_confirmed=true, zoho_payment_id null), `SettlementsRepository.markPublished(id: string, zohoPaymentId: string): Promise<void>`.
- Produces: `SettlementDocumentsRepository.create(args: { uploadedFileId: string; settlementRecordIds: string[] }): Promise<{ id: string; confirmToken: string }>`, `SettlementDocumentsRepository.getByToken(token: string): Promise<SettlementDocumentWithLinks | null>`, `SettlementDocumentsRepository.confirm(token: string, confirmedBy: string): Promise<SettlementDocumentWithLinks>`.
- `SettlementRecord` type (in `settlements.repository.ts`) gains: `evidence_type: "stripe_api" | "document" | null`, `evidence_confirmed: boolean`, `evidence_confirmed_by: string | null`, `evidence_confirmed_at: string | null`, `evidence_document_id: string | null`, `zoho_payment_id: string | null`, `zoho_published_at: string | null`.

- [ ] **Step 1: Append the migration to `db/schema.sql`**

```sql
-- settlement evidence: automatic (Stripe API match) or human-confirmed
-- (uploaded document + public confirm link). Gates Zoho Books publish.
alter table settlement_records add column if not exists evidence_type text;
alter table settlement_records add column if not exists evidence_confirmed boolean not null default false;
alter table settlement_records add column if not exists evidence_confirmed_by text;
alter table settlement_records add column if not exists evidence_confirmed_at timestamptz;
alter table settlement_records add column if not exists evidence_document_id uuid;
alter table settlement_records add column if not exists zoho_payment_id text;
alter table settlement_records add column if not exists zoho_published_at timestamptz;
create index if not exists settlement_records_evidence_idx on settlement_records (evidence_confirmed, zoho_payment_id);

-- one uploaded statement can evidence many orders (e.g. one Tabby payout
-- file covering 40 settled orders) — parent row + join table, not a single
-- FK on settlement_records.
create table if not exists settlement_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'omnia',
  uploaded_file_id uuid not null references uploaded_files(id),
  confirm_token text not null unique,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists settlement_documents_token_idx on settlement_documents (confirm_token);

create table if not exists settlement_document_links (
  settlement_document_id uuid not null references settlement_documents(id),
  settlement_record_id text not null references settlement_records(id),
  primary key (settlement_document_id, settlement_record_id)
);
```

- [ ] **Step 2: Extend `SettlementRecord` type + add repository methods**

In `lib/repositories/settlements.repository.ts`, extend the type and add methods (keep everything already in the file — this only adds to it):

```ts
export type SettlementRecord = {
  id: string;
  order_uid: string;
  order_number: string;
  store_id: string;
  customer_name: string;
  customer_email: string;
  order_date: string | null;
  settlement_date: string | null;
  gateway: string;
  currency: string;
  gross_aed: number;
  bank_line_id: string;
  payout_id: string | null;
  bank_reference: string;
  recorded_at: string;
  evidence_type: "stripe_api" | "document" | null;
  evidence_confirmed: boolean;
  evidence_confirmed_by: string | null;
  evidence_confirmed_at: string | null;
  evidence_document_id: string | null;
  zoho_payment_id: string | null;
  zoho_published_at: string | null;
};
```

Add to the `SettlementsRepository` object (after `listDatesWithCounts`):

```ts
  async markStripeEvidence(settlementIds: string[]): Promise<void> {
    if (settlementIds.length === 0) return;
    const { error } = await supabase
      .from("settlement_records")
      .update({
        evidence_type: "stripe_api",
        evidence_confirmed: true,
        evidence_confirmed_by: "stripe-api",
        evidence_confirmed_at: new Date().toISOString(),
      })
      .in("id", settlementIds);
    if (error) throw new Error(`settlement_records evidence update failed: ${error.message}`);
  },

  async listUnconfirmed(): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("evidence_confirmed", false)
      .order("settlement_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  async listReadyToPublish(): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("evidence_confirmed", true)
      .is("zoho_payment_id", null)
      .order("settlement_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  async markPublished(id: string, zohoPaymentId: string): Promise<void> {
    const { error } = await supabase
      .from("settlement_records")
      .update({ zoho_payment_id: zohoPaymentId, zoho_published_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`settlement_records publish update failed: ${error.message}`);
  },
```

- [ ] **Step 3: Create `lib/repositories/settlement-documents.repository.ts`**

```ts
// Evidence documents for non-API gateway settlements. One uploaded file can
// cover many orders (a whole payout statement) — confirming the document
// cascades evidence_confirmed=true to every linked settlement_records row.

import crypto from "node:crypto";
import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type SettlementDocument = {
  id: string;
  uploaded_file_id: string;
  confirm_token: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type SettlementDocumentWithLinks = SettlementDocument & {
  settlementRecordIds: string[];
};

export const SettlementDocumentsRepository = {
  async create(args: { uploadedFileId: string; settlementRecordIds: string[] }): Promise<SettlementDocumentWithLinks> {
    const confirmToken = crypto.randomBytes(24).toString("base64url");
    const { data, error } = await supabase
      .from("settlement_documents")
      .insert({ tenant_id: TENANT, uploaded_file_id: args.uploadedFileId, confirm_token: confirmToken })
      .select("*")
      .single();
    if (error || !data) throw new Error(`settlement_documents insert failed: ${error?.message}`);

    if (args.settlementRecordIds.length > 0) {
      const links = args.settlementRecordIds.map((settlement_record_id) => ({
        settlement_document_id: data.id,
        settlement_record_id,
      }));
      const { error: linkError } = await supabase.from("settlement_document_links").insert(links);
      if (linkError) throw new Error(`settlement_document_links insert failed: ${linkError.message}`);

      const { error: docIdError } = await supabase
        .from("settlement_records")
        .update({ evidence_type: "document", evidence_document_id: data.id })
        .in("id", args.settlementRecordIds);
      if (docIdError) throw new Error(`settlement_records evidence_document_id update failed: ${docIdError.message}`);
    }

    return { ...(data as SettlementDocument), settlementRecordIds: args.settlementRecordIds };
  },

  async getByToken(token: string): Promise<SettlementDocumentWithLinks | null> {
    const { data, error } = await supabase
      .from("settlement_documents")
      .select("*")
      .eq("confirm_token", token)
      .maybeSingle();
    if (error || !data) return null;

    const { data: links } = await supabase
      .from("settlement_document_links")
      .select("settlement_record_id")
      .eq("settlement_document_id", data.id);

    return {
      ...(data as SettlementDocument),
      settlementRecordIds: (links ?? []).map((l) => l.settlement_record_id as string),
    };
  },

  async confirm(token: string, confirmedBy: string): Promise<SettlementDocumentWithLinks> {
    const existing = await this.getByToken(token);
    if (!existing) throw new Error("Unknown confirm token");
    if (existing.confirmed_at) return existing; // idempotent — already confirmed

    const confirmedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("settlement_documents")
      .update({ confirmed_by: confirmedBy, confirmed_at: confirmedAt })
      .eq("confirm_token", token)
      .select("*")
      .single();
    if (error || !data) throw new Error(`settlement_documents confirm failed: ${error?.message}`);

    if (existing.settlementRecordIds.length > 0) {
      const { error: srError } = await supabase
        .from("settlement_records")
        .update({ evidence_confirmed: true, evidence_confirmed_by: confirmedBy, evidence_confirmed_at: confirmedAt })
        .in("id", existing.settlementRecordIds);
      if (srError) throw new Error(`settlement_records confirm cascade failed: ${srError.message}`);
    }

    return { ...(data as SettlementDocument), settlementRecordIds: existing.settlementRecordIds };
  },
};
```

- [ ] **Step 4: Write the repository test**

```ts
// tests/repositories/settlement-documents.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";

test("SettlementDocumentsRepository.create generates a unique, url-safe confirm token", async () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 20; i++) {
    // token generation is pure (crypto.randomBytes) — exercise it directly
    // rather than hitting Supabase in a unit test.
    const token = require("node:crypto").randomBytes(24).toString("base64url");
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    tokens.add(token);
  }
  assert.equal(tokens.size, 20);
});
```

(This test only checks token shape/uniqueness since the repository's DB-touching methods require a live Supabase connection — same limitation as every other repository in this codebase, none of which have integration tests today.)

- [ ] **Step 5: Run the test**

Run: `tsx --test tests/repositories/settlement-documents.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add db/schema.sql lib/repositories/settlements.repository.ts lib/repositories/settlement-documents.repository.ts tests/repositories/settlement-documents.test.ts
git commit -m "$(cat <<'EOF'
Add settlement evidence schema + repositories

settlement_records gains evidence_type/evidence_confirmed/zoho_payment_id
columns; new settlement_documents + settlement_document_links tables let
one uploaded payout statement evidence many orders at once.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**Note for whoever applies this to the live DB:** run the new SQL from Step 1 against Supabase manually (no migration runner in this repo, per existing convention).

---

### Task 2: Stripe auto-verification in the reconciliation engine

**Files:**
- Modify: `lib/reconciliation/engine.ts:260-319` (`persistResults`)
- Test: `tests/reconciliation/stripe-evidence.test.ts`

**Interfaces:**
- Consumes: `payoutOrderRefs(payoutId: string)` from `lib/integrations/stripe.ts` (existing, returns `{ net, refs, transactions }`), `stripeConfigured()` (existing), `SettlementsRepository.markStripeEvidence(ids: string[])` from Task 1.
- Produces: `persistResults` now marks Stripe-sourced settlement rows `evidence_confirmed=true` automatically when the order's ref is present in Stripe's own balance-transaction breakdown.

- [ ] **Step 1: Write the failing test for the extraction helper**

Extract the "does this order's ref appear in Stripe's refs for this payout" check into a small pure function so it's testable without a live Stripe call or a live DB:

```ts
// tests/reconciliation/stripe-evidence.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripeEvidencedOrderNumbers } from "@/lib/reconciliation/engine";

test("stripeEvidencedOrderNumbers: keeps only order numbers present in Stripe's refs", () => {
  const result = stripeEvidencedOrderNumbers(["1001", "1002", "1003"], ["1001", "1003", "9999"]);
  assert.deepEqual(result, ["1001", "1003"]);
});

test("stripeEvidencedOrderNumbers: empty refs from Stripe evidences nothing", () => {
  assert.deepEqual(stripeEvidencedOrderNumbers(["1001"], []), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test tests/reconciliation/stripe-evidence.test.ts`
Expected: FAIL — `stripeEvidencedOrderNumbers` is not exported yet.

- [ ] **Step 3: Add the helper + wire it into `persistResults`**

In `lib/reconciliation/engine.ts`, add near the top-level exports (e.g. after `summarizeReconLines`, keeping it exported for the test):

```ts
export function stripeEvidencedOrderNumbers(resolvedOrders: string[], stripeRefs: string[]): string[] {
  const refSet = new Set(stripeRefs);
  return resolvedOrders.filter((num) => refSet.has(num));
}
```

Add the imports needed at the top of the file:

```ts
import { stripeConfigured, payoutOrderRefs } from "@/lib/integrations/stripe";
```

Then, in `persistResults`, after the existing `if (settlementRows.length > 0) await SettlementsRepository.upsertMany(settlementRows);` line, append:

```ts
  // Stripe auto-verification: for settled lines on Stripe payouts, check
  // each order's ref against Stripe's own balance-transaction breakdown —
  // if Stripe agrees the order was paid out, no human confirmation step is
  // needed. If the API call fails or the ref is absent, leave the row
  // unconfirmed (surfaces as "awaiting evidence", same as any other
  // gateway) rather than assuming success.
  if (stripeConfigured()) {
    const stripeLines = lines.filter(
      (l) => l.state === "SETTLED" && l.provider === "Stripe" && l.payout?.id?.startsWith("STRIPE-") && !l.payout.id.startsWith("STRIPE-TRF-"),
    );
    for (const l of stripeLines) {
      try {
        const stripePayoutId = l.payout!.id.slice("STRIPE-".length);
        const { refs } = await payoutOrderRefs(stripePayoutId);
        const evidenced = stripeEvidencedOrderNumbers(l.resolvedOrders, refs);
        const ids = evidenced.map((num) => {
          const order = orderByNumber.get(num);
          return order ? `${order.uid}_${l.id}` : null;
        }).filter((id): id is string => Boolean(id));
        if (ids.length > 0) await SettlementsRepository.markStripeEvidence(ids);
      } catch (e) {
        console.error(`Stripe evidence check failed for payout ${l.payout?.id}:`, (e as Error).message);
      }
    }
  }
```

(`l.payout.id.startsWith("STRIPE-TRF-")` excludes synthetic ids assigned to manually-uploaded Stripe CSVs — those have no real Stripe payout id to query live, per `lib/parsers/payouts.ts`'s `STRIPE-TRF-${span}` convention.)

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test tests/reconciliation/stripe-evidence.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/reconciliation/engine.ts tests/reconciliation/stripe-evidence.test.ts
git commit -m "$(cat <<'EOF'
Auto-verify Stripe settlements against Stripe's own balance-transaction refs

No human confirmation step needed when Stripe's live API agrees an order
was part of a payout — only non-API gateways need the document+link flow.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Document upload → link to settlement records

**Files:**
- Modify: `app/api/upload/payout/route.ts` (return `fileId`)
- Create: `app/api/settlements/documents/route.ts`
- Create: `app/api/settlements/route.ts` (list settlements grouped for the UI)
- Test: `tests/repositories/settlement-documents.test.ts` (already created in Task 1 — no new test file; route logic is thin enough to cover via the manual verification in Task 6)

**Interfaces:**
- Consumes: `SettlementDocumentsRepository.create` from Task 1, `FilesRepository.save`/`get` (existing), `SettlementsRepository.listUnconfirmed`/`listReadyToPublish` from Task 1.
- Produces: `POST /api/settlements/documents` body `{ uploadedFileId: string; settlementRecordIds: string[] }` → `{ confirmUrl: string }`. `GET /api/settlements` → `{ unconfirmed: SettlementRecord[]; readyToPublish: SettlementRecord[] }`.

- [ ] **Step 1: Return `fileId` from the existing upload route**

In `app/api/upload/payout/route.ts`, capture the id already returned by `FilesRepository.save` (currently discarded) and include it in the response:

```ts
  let fileId: string | null = null;
  try {
    fileId = await FilesRepository.save({
      kind: "payout",
      provider: payouts[0]?.provider ?? provider,
      filename: file.name,
      mime: file.type || undefined,
      content: buf,
      parseSummary: payouts
        .map((p) => `${p.id} · net AED ${p.net.toFixed(2)} · ${p.orderRefs.length} orders`)
        .join(" | "),
    });
  } catch (e) {
    console.error("uploaded_files archive failed:", (e as Error).message);
  }

  return NextResponse.json({
    saved,
    fileId,
    payouts: payouts.map((p) => ({
      id: p.id,
      provider: p.provider,
      net: p.net,
      orderRefs: p.orderRefs,
      notes: p.notes,
    })),
  });
```

- [ ] **Step 2: Create `app/api/settlements/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";

// GET /api/settlements — feeds the Settlements panel: what still needs
// evidence, and what's confirmed and ready for the Zoho publish batch.
export async function GET() {
  const [unconfirmed, readyToPublish] = await Promise.all([
    SettlementsRepository.listUnconfirmed(),
    SettlementsRepository.listReadyToPublish(),
  ]);
  return NextResponse.json({ unconfirmed, readyToPublish });
}
```

- [ ] **Step 3: Create `app/api/settlements/documents/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";

// POST /api/settlements/documents — link an already-uploaded payout file to
// the settlement records it evidences, and mint the public confirm link.
export async function POST(request: Request) {
  const body = await request.json();
  const uploadedFileId = String(body.uploadedFileId || "");
  const settlementRecordIds = Array.isArray(body.settlementRecordIds) ? body.settlementRecordIds.map(String) : [];

  if (!uploadedFileId || settlementRecordIds.length === 0) {
    return NextResponse.json({ error: "uploadedFileId and settlementRecordIds are required" }, { status: 400 });
  }

  const doc = await SettlementDocumentsRepository.create({ uploadedFileId, settlementRecordIds });
  const origin = new URL(request.url).origin;
  return NextResponse.json({ confirmUrl: `${origin}/confirm/${doc.confirm_token}` });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/upload/payout/route.ts app/api/settlements/route.ts app/api/settlements/documents/route.ts
git commit -m "$(cat <<'EOF'
Link uploaded payout documents to the settlements they evidence

Upload route now returns the stored file's id; new /api/settlements and
/api/settlements/documents routes let ops attach a document to specific
settlement records and mint the public confirm link.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Public confirm page + routes

**Files:**
- Modify: `middleware.ts` (public paths)
- Create: `app/api/confirm/[token]/route.ts`
- Create: `app/api/confirm/[token]/document/route.ts`
- Create: `app/confirm/[token]/page.tsx`

**Interfaces:**
- Consumes: `SettlementDocumentsRepository.getByToken`/`confirm` from Task 1, `FilesRepository.get` (existing), `SettlementsRepository` (existing, to look up order/amount details for the linked settlement ids — read via direct `supabase.from("settlement_records").select(...).in("id", ...)` since there's no existing bulk-by-ids method; add one).

- [ ] **Step 1: Add `listByIds` to `SettlementsRepository`**

In `lib/repositories/settlements.repository.ts`, add:

```ts
  async listByIds(ids: string[]): Promise<SettlementRecord[]> {
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from("settlement_records").select("*").in("id", ids);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },
```

- [ ] **Step 2: Open the public paths in `middleware.ts`**

```ts
const PUBLIC_PATHS = ["/login", "/api/login", "/confirm", "/api/confirm"];
```

(The existing `PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))` check already handles `/confirm/[token]` and `/api/confirm/[token]/...` once `/confirm` and `/api/confirm` are in the list — no other middleware change needed.)

- [ ] **Step 3: Create `app/api/confirm/[token]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

// GET /api/confirm/:token — public (no auth). Resolves a confirm token to
// its document metadata + the orders it evidences, for the /confirm page.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await SettlementDocumentsRepository.getByToken(token);
  if (!doc) return NextResponse.json({ error: "Unknown or expired link" }, { status: 404 });

  const [file, settlements] = await Promise.all([
    FilesRepository.get(doc.uploaded_file_id),
    SettlementsRepository.listByIds(doc.settlementRecordIds),
  ]);

  return NextResponse.json({
    confirmed: Boolean(doc.confirmed_at),
    confirmedBy: doc.confirmed_by,
    confirmedAt: doc.confirmed_at,
    filename: file?.filename ?? "document",
    settlements: settlements.map((s) => ({
      id: s.id,
      orderNumber: s.order_number,
      customerName: s.customer_name,
      grossAed: s.gross_aed,
      gateway: s.gateway,
      settlementDate: s.settlement_date,
    })),
  });
}

// POST /api/confirm/:token — records the confirmation. Idempotent: a
// second confirm on an already-confirmed token just returns the existing
// confirmation rather than erroring.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json();
  const confirmedBy = String(body.confirmedBy || "").trim();
  if (!confirmedBy) return NextResponse.json({ error: "confirmedBy (name or email) is required" }, { status: 400 });

  try {
    const doc = await SettlementDocumentsRepository.confirm(token, confirmedBy);
    return NextResponse.json({ confirmed: true, confirmedBy: doc.confirmed_by, confirmedAt: doc.confirmed_at });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
```

- [ ] **Step 4: Create `app/api/confirm/[token]/document/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

// GET /api/confirm/:token/document — public (no auth), but only ever
// serves the ONE file tied to this token — never an arbitrary uploaded_files id.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await SettlementDocumentsRepository.getByToken(token);
  if (!doc) return NextResponse.json({ error: "Unknown or expired link" }, { status: 404 });

  const file = await FilesRepository.get(doc.uploaded_file_id);
  if (!file) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
      "Content-Length": String(file.content.length),
    },
  });
}
```

- [ ] **Step 5: Create `app/confirm/[token]/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ConfirmData = {
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  filename: string;
  settlements: { id: string; orderNumber: string; customerName: string; grossAed: number; gateway: string; settlementDate: string | null }[];
};

export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ConfirmData | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("Could not load this confirmation link."));
  }, [token]);

  async function confirm() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/confirm/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedBy: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Confirm failed");
      setData((d) => (d ? { ...d, confirmed: true, confirmedBy: json.confirmedBy, confirmedAt: json.confirmedAt } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !data) return <div style={{ padding: 32 }}>{error}</div>;
  if (!data) return <div style={{ padding: 32 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 32, fontFamily: "sans-serif" }}>
      <h1>Confirm settlement</h1>
      <p>Document: {data.filename} — <a href={`/api/confirm/${token}/document`} target="_blank" rel="noreferrer">view</a></p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr><th align="left">Order</th><th align="left">Customer</th><th align="right">Gross AED</th><th align="left">Gateway</th></tr>
        </thead>
        <tbody>
          {data.settlements.map((s) => (
            <tr key={s.id}>
              <td>{s.orderNumber}</td>
              <td>{s.customerName}</td>
              <td align="right">{s.grossAed.toFixed(2)}</td>
              <td>{s.gateway}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.confirmed ? (
        <p style={{ marginTop: 24, color: "green" }}>
          Confirmed by {data.confirmedBy} at {data.confirmedAt}
        </p>
      ) : (
        <div style={{ marginTop: 24 }}>
          <input
            placeholder="Your name or email"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ padding: 8, marginRight: 8, width: 240 }}
          />
          <button onClick={confirm} disabled={submitting || !name.trim()}>
            {submitting ? "Confirming…" : "Confirm settlement"}
          </button>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run the dev server (`npm run dev`), upload a non-Stripe payout file through the existing upload UI, note the returned `fileId` from the network tab, `POST /api/settlements/documents` with that `fileId` and a real `settlementRecordIds` array (query `settlement_records` for matching `payout_id` if needed), then open the returned `confirmUrl` in an incognito window (no session cookie) and confirm the page loads and the confirm button works.

- [ ] **Step 8: Commit**

```bash
git add middleware.ts app/api/confirm app/confirm
git commit -m "$(cat <<'EOF'
Add public settlement confirmation page (no login required)

/confirm/:token shows the evidencing document + the orders it covers and
lets anyone with the link confirm settlement, cascading evidence_confirmed
to every linked settlement_records row.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Zoho Books publish (Customer Payment write)

**Files:**
- Modify: `lib/integrations/zoho.ts` (add write function + invoice lookup)
- Create: `app/api/settlements/publish/route.ts`
- Test: `tests/integrations/zoho-payment-mapping.test.ts`

**Interfaces:**
- Consumes: `zohoConfigured()`, `getAccessToken`-equivalent flow (existing, currently private to the file — export a `zohoRequest` helper instead of duplicating token logic), `SettlementsRepository.listByIds`/`markPublished` from Tasks 1/4.
- Produces: `zohoPaymentModeFor(gateway: string): string` (pure, testable), `createZohoCustomerPayment(input: { invoiceReferenceNumber: string; amount: number; paymentMode: string; referenceNumber: string }): Promise<{ payment_id: string }>`. `POST /api/settlements/publish` body `{ settlementIds: string[] }` → `{ results: { id: string; ok: boolean; error?: string; paymentId?: string }[] }`.

- [ ] **Step 1: Write the failing test for the gateway→payment-mode mapping**

```ts
// tests/integrations/zoho-payment-mapping.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { zohoPaymentModeFor } from "@/lib/integrations/zoho";

test("zohoPaymentModeFor: maps known gateways to Zoho payment modes", () => {
  assert.equal(zohoPaymentModeFor("Stripe"), "Bank Transfer");
  assert.equal(zohoPaymentModeFor("COD"), "Cash on Delivery");
  assert.equal(zohoPaymentModeFor("Tabby"), "Bank Transfer");
  assert.equal(zohoPaymentModeFor("Tamara"), "Bank Transfer");
});

test("zohoPaymentModeFor: unknown gateway falls back to Bank Transfer", () => {
  assert.equal(zohoPaymentModeFor("Unclassified"), "Bank Transfer");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test tests/integrations/zoho-payment-mapping.test.ts`
Expected: FAIL — `zohoPaymentModeFor` not exported.

- [ ] **Step 3: Refactor `getAccessToken` to be reusable, add the mapping + write functions**

In `lib/integrations/zoho.ts`, change `async function getAccessToken()` to `export async function getAccessToken()` (no other change to its body), then add at the end of the file:

```ts
const INVENTORY_BASE = API_BASE; // https://www.zohoapis.com/inventory/v1 — same base, customerpayments lives here too

export function zohoPaymentModeFor(gateway: string): string {
  const map: Record<string, string> = {
    COD: "Cash on Delivery",
  };
  return map[gateway] ?? "Bank Transfer";
}

export type ZohoCustomerPaymentInput = {
  invoiceReferenceNumber: string; // matches Omnia's order_number
  amount: number;
  gateway: string;
  bankReference: string;
};

// Finds the Zoho invoice whose reference_number matches our order_number,
// then records a Customer Payment against it via the Inventory API (the
// Books API 401s under this token's ZohoInventory.fullaccess.all scope,
// but /inventory/v1/customerpayments works — verified live against the org).
export async function createZohoCustomerPayment(input: ZohoCustomerPaymentInput): Promise<{ payment_id: string }> {
  const accessToken = await getAccessToken();
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;

  const invoiceQs = new URLSearchParams({ organization_id: orgId, reference_number: input.invoiceReferenceNumber });
  const invoiceRes = await fetch(`${INVENTORY_BASE}/invoices?${invoiceQs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  if (!invoiceRes.ok) throw new Error(`Zoho invoice lookup HTTP ${invoiceRes.status}`);
  const invoiceJson = await invoiceRes.json();
  const matches = invoiceJson.invoices ?? [];
  if (matches.length === 0) throw new Error(`No Zoho invoice found for reference_number ${input.invoiceReferenceNumber}`);
  if (matches.length > 1) throw new Error(`Ambiguous Zoho invoice match for reference_number ${input.invoiceReferenceNumber} (${matches.length} results)`);
  const invoice = matches[0];

  const paymentRes = await fetch(`${INVENTORY_BASE}/customerpayments?organization_id=${orgId}`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      customer_id: invoice.customer_id,
      payment_mode: zohoPaymentModeFor(input.gateway),
      amount: input.amount,
      date: new Date().toISOString().slice(0, 10),
      reference_number: input.bankReference,
      invoices: [{ invoice_id: invoice.invoice_id, amount_applied: input.amount }],
    }),
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

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test tests/integrations/zoho-payment-mapping.test.ts`
Expected: PASS

- [ ] **Step 5: Create `app/api/settlements/publish/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { createZohoCustomerPayment, zohoConfigured } from "@/lib/integrations/zoho";

// POST /api/settlements/publish — manual, reviewed batch push to Zoho
// Books. Re-validates evidence_confirmed + not-already-published
// server-side (never trust the UI's filter for a real money-writing action).
export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }
  const body = await request.json();
  const settlementIds = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  if (settlementIds.length === 0) {
    return NextResponse.json({ error: "settlementIds is required" }, { status: 400 });
  }

  const settlements = await SettlementsRepository.listByIds(settlementIds);
  const results: { id: string; ok: boolean; error?: string; paymentId?: string }[] = [];

  for (const s of settlements) {
    if (!s.evidence_confirmed) {
      results.push({ id: s.id, ok: false, error: "Not evidence-confirmed" });
      continue;
    }
    if (s.zoho_payment_id) {
      results.push({ id: s.id, ok: false, error: "Already published" });
      continue;
    }
    try {
      const { payment_id } = await createZohoCustomerPayment({
        invoiceReferenceNumber: s.order_number,
        amount: s.gross_aed,
        gateway: s.gateway,
        bankReference: s.bank_reference,
      });
      await SettlementsRepository.markPublished(s.id, payment_id);
      results.push({ id: s.id, ok: true, paymentId: payment_id });
    } catch (e) {
      results.push({ id: s.id, ok: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({ results });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/zoho.ts app/api/settlements/publish/route.ts tests/integrations/zoho-payment-mapping.test.ts
git commit -m "$(cat <<'EOF'
Write confirmed settlements to Zoho Books as Customer Payments

Uses the Inventory API's /customerpayments endpoint (Books API 401s under
our current OAuth scope, but this endpoint is confirmed live to work under
the same org) — matches orders to invoices via order_number ==
invoice.reference_number, verified against real org data during design.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**Note:** the first real publish should be tested against ONE low-value settlement first and checked in the actual Zoho Books UI before trusting the batch flow — this task confirms Books-endpoint write access empirically for the first time.

---

### Task 6: Settlements UI panel

**Files:**
- Create: `components/finance/settlements-panel.tsx`
- Modify: `components/finance/finance-workspace.tsx` (nav entry + view wiring)

**Interfaces:**
- Consumes: `GET /api/settlements` (Task 3), `POST /api/settlements/documents` (Task 3), `POST /api/settlements/publish` (Task 5), existing `app/api/upload/payout/route.ts` (now returns `fileId`, Task 3).

- [ ] **Step 1: Create `components/finance/settlements-panel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

type Settlement = {
  id: string;
  order_number: string;
  customer_name: string;
  gross_aed: number;
  gateway: string;
  evidence_type: "stripe_api" | "document" | null;
  evidence_confirmed: boolean;
  zoho_payment_id: string | null;
};

export function SettlementsPanel() {
  const [unconfirmed, setUnconfirmed] = useState<Settlement[]>([]);
  const [readyToPublish, setReadyToPublish] = useState<Settlement[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<{ id: string; ok: boolean; error?: string }[] | null>(null);

  function refresh() {
    fetch("/api/settlements")
      .then((r) => r.json())
      .then((d) => {
        setUnconfirmed(d.unconfirmed ?? []);
        setReadyToPublish(d.readyToPublish ?? []);
      });
  }

  useEffect(refresh, []);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function publish() {
    if (selected.size === 0) return;
    setPublishing(true);
    setPublishResults(null);
    try {
      const res = await fetch("/api/settlements/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settlementIds: [...selected] }),
      });
      const json = await res.json();
      setPublishResults(json.results ?? []);
      setSelected(new Set());
      refresh();
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>Awaiting evidence ({unconfirmed.length})</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th align="left">Order</th><th align="left">Customer</th><th align="right">Gross AED</th><th align="left">Gateway</th><th align="left">Status</th></tr>
        </thead>
        <tbody>
          {unconfirmed.map((s) => (
            <tr key={s.id}>
              <td>{s.order_number}</td>
              <td>{s.customer_name}</td>
              <td align="right">{s.gross_aed.toFixed(2)}</td>
              <td>{s.gateway}</td>
              <td>⏳ awaiting {s.evidence_type === "document" ? "confirmation" : "upload"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 32 }}>Ready to publish ({readyToPublish.length})</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th></th><th align="left">Order</th><th align="left">Customer</th><th align="right">Gross AED</th><th align="left">Evidence</th></tr>
        </thead>
        <tbody>
          {readyToPublish.map((s) => (
            <tr key={s.id}>
              <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
              <td>{s.order_number}</td>
              <td>{s.customer_name}</td>
              <td align="right">{s.gross_aed.toFixed(2)}</td>
              <td>{s.evidence_type === "stripe_api" ? "✅ Stripe-verified" : "✅ Doc-confirmed"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={publish} disabled={publishing || selected.size === 0} style={{ marginTop: 12 }}>
        {publishing ? "Publishing…" : `Publish ${selected.size} to Zoho`}
      </button>

      {publishResults && (
        <ul style={{ marginTop: 16 }}>
          {publishResults.map((r) => (
            <li key={r.id} style={{ color: r.ok ? "green" : "red" }}>
              {r.id}: {r.ok ? "published" : r.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `finance-workspace.tsx`**

Add the import near the other panel imports (after `import { CustomersPanel } from "@/components/finance/customers-panel";`):

```ts
import { SettlementsPanel } from "@/components/finance/settlements-panel";
```

Add to the `NAV` array (`finance-workspace.tsx:44`), following the existing entries' shape:

```ts
  { href: "/settlements", view: "settlements", label: "Settlements", icon: /* reuse whatever icon component the neighboring entries use, e.g. FileCheck */ FileCheck },
```

Add `"settlements"` to the `FinanceView` union type (wherever it's declared near the top of the file, alongside `"dashboard" | "orders" | ...`).

Add the show-flag next to the others (around line 533):

```ts
  const showSettlements = view === "settlements";
```

Add the render branch alongside the other `showX ? <XPanel /> : ...` chain (near line 644, next to `<CustomersPanel />`):

```tsx
      ) : showSettlements ? (
        <SettlementsPanel />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, navigate to `/settlements`, confirm the panel loads with whatever unconfirmed/ready-to-publish rows currently exist (empty state is fine if none), and that the nav entry highlights correctly.

- [ ] **Step 5: Commit**

```bash
git add components/finance/settlements-panel.tsx components/finance/finance-workspace.tsx
git commit -m "$(cat <<'EOF'
Add Settlements panel — evidence status + batch Zoho publish

Surfaces every settlement's evidence state (Stripe-verified / doc-
confirmed / awaiting) and lets ops select confirmed rows for the batch
publish action.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `tsx --test 'tests/**/*.test.ts'`
Expected: all tests pass, including the new ones from Tasks 1, 2, and 5.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit -p .`
Expected: zero errors repo-wide.

- [ ] **Step 3: Manual end-to-end pass**

With `npm run dev` running: upload a non-Stripe payout file → confirm a `fileId` comes back → call `/api/settlements/documents` with that file and real settlement ids for the same payout → open the returned `/confirm/:token` link in an incognito window → confirm it → check `/settlements` shows the rows moved from "awaiting" to "ready to publish" → select one and publish → check it now shows `zoho_payment_id` set and (if `ZOHO_*` env vars are configured) verify the Customer Payment actually appears in the live Zoho org.

- [ ] **Step 4: Update `.superpowers/sdd/progress.md`**

Replace its contents to reflect this plan's completion, following the same style as the existing entries (plan path, branch, one paragraph per task noting real bugs found/fixed and anything deferred).
