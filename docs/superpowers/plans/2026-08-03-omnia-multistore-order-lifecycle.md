# Omnia Multistore Order Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operate every Omnia store from one tenant-safe portal, with clean orders automatically reaching ready-to-pick and every order, stock, cancellation, refund, exchange, and outward sync mutation idempotent and auditable.

**Architecture:** Preserve existing orders, reconciliation, inventory, invoices, webhooks, Zoho, and courier flows. Add an immutable command/event layer, balanced stock movements, provider attempts, and an outbox beside them, then route existing endpoints through it using tenant/store/action flags. Canonical CRUD commits locally with optimistic concurrency; inventory changes are compensating movements; propagation to Zoho/stores requires a preview and records per-target outcomes.

**Tech Stack:** Next.js 16, TypeScript, React 19, Supabase/Postgres RPCs, Zod, `tsx --test`, existing Shopify/WooCommerce/Zoho/payment/courier integrations.

## Global Constraints

- Additive migrations only: never drop, truncate, replace, or destructively rename existing data.
- Every new business record/query includes `tenant_id`; touched paths remove hard-coded tenant and actor values.
- Existing payout-to-bank reconciliation behavior remains unchanged.
- Command, event, movement, and outbox acceptance is one database transaction.
- External effects are at-least-once with provider reconciliation for uncertain outcomes.
- Inventory is append-only; corrections are balanced compensating movements.
- Automation starts in shadow mode and promotes by tenant, store, and action.
- TDD every task; do not stage unrelated user changes.

---

## Task 1: Entry Gate and Golden Fixtures

**Files:**
- Create: `tests/fixtures/orders/lifecycle-cases.ts`
- Create: `tests/orders/entry-gate.test.ts`
- Create: `scripts/lifecycle-entry-gate.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `LIFECYCLE_CASES: LifecycleFixture[]` with 11 sanitized cases.
- Produces read-only `npm run lifecycle:entry-gate`.

- [ ] Write a failing test requiring exactly these cases: clean Shopify UAE/KSA/WA, clean Woo, COD, shortage, cancellation before/after dispatch, partial/full refund, exchange.
- [ ] Run `npx tsx --test tests/orders/entry-gate.test.ts`; expect missing fixture failure.
- [ ] Implement fixtures with no customer PII and a script returning `{ checks, blockers, recommendedWedgeDays }` for env presence, schema/RPC presence, provider samples, couriers, flags, and fixtures.
- [ ] Add `"lifecycle:entry-gate": "tsx scripts/lifecycle-entry-gate.ts"`; run the test and command.
- [ ] Commit: `test: add OMS lifecycle entry gate`.

## Task 2: Additive Tenant-Safe Schema

**Files:**
- Create: `db/migrations/20260803_order_lifecycle_foundation.sql`
- Create: `tests/database/lifecycle-schema.test.ts`
- Modify: `db/apply-schema.mjs`

**Interfaces:**
- Tables: `lifecycle_commands`, `order_lifecycle_events`, `inventory_movements`, `provider_attempts`, `notification_outbox`, `after_sale_cases`, `after_sale_lines`, `automation_decisions`.
- RPCs: `accept_lifecycle_command`, `post_inventory_movement_group`, `rebuild_order_lifecycle_projection`.

- [ ] Write a failing SQL contract test rejecting `DROP TABLE`, `TRUNCATE`, and column drops and requiring tenant composite keys, RLS, immutable event/movement protection, and uniqueness for idempotency/source/dedup identities.
- [ ] Run `npx tsx --test tests/database/lifecycle-schema.test.ts`; expect missing migration failure.
- [ ] Implement UUID keys, `tenant_id text not null`, typed state checks, `jsonb` payload/result, `timestamptz`, `ON DELETE RESTRICT`, tenant/order/time indexes, and RLS.
- [ ] Make command acceptance lock the order stream, replay identical key/hash, reject mismatched payload, and commit command/event/outbox atomically.
- [ ] Dry-run schema parsing, rerun test, commit: `feat: add lifecycle foundation schema`.

## Task 3: Pure Lifecycle State Machine

**Files:**
- Create: `lib/orders/lifecycle-types.ts`
- Create: `lib/orders/lifecycle-machine.ts`
- Create: `tests/orders/lifecycle-machine.test.ts`

**Interfaces:**
- `evaluateCommand(snapshot, command): TransitionDecision`
- `headlineState(snapshot): string`

- [ ] Write table-driven failing tests for payment recovery, reserve, partial fulfillment, dispatch, pre/post-dispatch cancellation, RTO, partial/full refund, return inspection, rejected case, and exchange.
- [ ] Define `TransitionDecision = { ok: true; events; movements; effects } | { ok: false; code; message }`.
- [ ] Implement exhaustive discriminated unions and explicit guards; never use ordinal stage comparisons.
- [ ] Run focused test then `npm test`; commit: `feat: define canonical order lifecycle`.

## Task 4: Idempotent Command Service and Durable Audit

**Files:**
- Create: `lib/orders/idempotency.ts`
- Create: `lib/orders/lifecycle-service.ts`
- Create: `lib/repositories/lifecycle.repository.ts`
- Create: `app/api/orders/[uid]/commands/route.ts`
- Create: `tests/orders/lifecycle-service.test.ts`
- Create: `tests/api/order-commands.test.ts`
- Modify: `lib/repositories/order-events.repository.ts`
- Modify: `lib/orders/audit-wrapper.ts`

**Interfaces:**
- `submitLifecycleCommand(input): Promise<LifecycleCommandResult>`
- POST requires `Idempotency-Key`; returns 202 accepted, 200 replay, 409 conflict/rejection, 422 invalid.

- [ ] Test identical replay, payload mismatch, concurrent conflict serialization, tenant isolation, and atomic audit/outbox acceptance.
- [ ] Implement recursively canonical JSON hashing with SHA-256.
- [ ] Resolve tenant/actor from server session, never the request body.
- [ ] Preserve event-history reads but remove best-effort critical logging.
- [ ] Run focused/full tests; commit: `feat: add idempotent lifecycle commands`.

## Task 5: Balanced Inventory and Reservation Compatibility

**Files:**
- Create: `lib/repositories/inventory-movements.repository.ts`
- Create: `tests/inventory/movements.test.ts`
- Modify: `lib/repositories/inventory-reservations.repository.ts`
- Modify: `lib/stock-events.ts`
- Modify: `app/api/orders/[uid]/reserve/route.ts`

**Interfaces:**
- `postMovementGroup(input): Promise<MovementGroupResult>`
- Buckets: `available | reserved | committed | quarantine | damaged | external`.

- [ ] Test conservation for reserve/dispatch/release/receive/inspect, insufficient stock, replay, concurrent reserve, and cross-tenant denial.
- [ ] Post movement groups via one RPC while locking tenant/SKU/warehouse balances in stable SKU order.
- [ ] Keep historical `stock_events`; route new business mutations through durable movements.
- [ ] Make reserve/release accept lifecycle command IDs and never update stage independently.
- [ ] Run tests; commit: `feat: make order stock movements transactional`.

## Task 6: Order-Details CRUD

**Files:**
- Create: `lib/orders/order-edit-schema.ts`
- Create: `components/finance/order-details-editor.tsx`
- Create: `tests/orders/order-edit-schema.test.ts`
- Create: `tests/api/order-details-crud.test.ts`
- Modify: `app/api/orders/[uid]/route.ts`
- Modify: `lib/repositories/orders.repository.ts`
- Modify: `components/finance/orders-ledger.tsx`
- Modify: `lib/invoice-fields.ts`

**Interfaces:**
- PATCH body: `{ expectedVersion, patch: OrderEditablePatch, reason }`.
- `OrdersRepository.updateEditableFields({ tenantId, uid, expectedVersion, patch, actor, reason })`.

- [ ] Test allowlisted customer/contact/address/internal-note/fulfillment-preference edits.
- [ ] Test rejection of tenant, UID, provider IDs, totals, payout/reconciliation, lifecycle, AWB, and unknown keys.
- [ ] Implement tenant-scoped conditional update, version increment, 409 stale-version response, and redacted before/after event.
- [ ] Add editor with reason, diff, conflict reload, and local-only/propagatable field labeling.
- [ ] Verify invoice prefills use canonical edited fields; run tests; commit: `feat: add audited order editing`.

## Task 7: SKU CRUD, Inventory Adjustment, and Outward Propagation

**Files:**
- Create: `lib/orders/sku-edit-schema.ts`
- Create: `lib/integrations/inventory-propagation.ts`
- Create: `app/api/skus/[sku]/route.ts`
- Create: `app/api/skus/[sku]/inventory-adjustments/route.ts`
- Create: `app/api/skus/[sku]/propagation-preview/route.ts`
- Create: `app/api/skus/[sku]/propagate/route.ts`
- Create: `components/inventory/sku-editor.tsx`
- Create: `tests/inventory/sku-crud.test.ts`
- Create: `tests/inventory/propagation.test.ts`
- Modify: `components/finance/inventory-panel.tsx`

**Interfaces:**
- SKU PATCH: `{ expectedVersion, patch: { title?, gtin?, category?, expectedChannels? }, reason }`.
- Adjustment: `{ warehouseId, delta, disposition, reason, expectedBalanceVersion }`.
- Preview: `{ previewHash, targets: { target, current, proposed, supported, warning }[] }`.
- Propagate requires preview hash, selected targets, reason, and idempotency key.

- [ ] Test metadata allowlist, stale versions, forbidden direct quantity overwrite, movement-based adjustment, stale preview rejection, selected target fan-out, and partial provider failure.
- [ ] Implement conditional canonical SKU edits and movement-based adjustments only.
- [ ] Preview Zoho and Shopify UAE/KSA/WA/Woo targets using tenant configuration and SKU channel presence.
- [ ] Execute one parent command plus independent provider attempts; preserve successful targets when another fails.
- [ ] Build editor with diff, watermark, warnings, per-target selection/status, uncertain outcome, and audit link.
- [ ] Run tests; commit: `feat: add audited SKU propagation CRUD`.

## Task 8: Payment Evidence and All-Store Shadow Mode

**Files:**
- Create: `lib/integrations/order-payment-evidence.ts`
- Create: `lib/repositories/automation-decisions.repository.ts`
- Create: `tests/orders/payment-evidence.test.ts`
- Modify: Shopify webhook routes found with `rg -l 'verifyShopify' app/api/webhooks`
- Modify: `app/api/webhooks/woo/[topics]/route.ts`
- Modify: `app/api/orders/[uid]/check-stripe/route.ts`
- Modify: `app/api/orders/[uid]/mark-paid/route.ts`

**Interfaces:**
- `getPaymentEvidence(order): Promise<{ state: "verified"|"pending"|"mismatch"|"unsupported"|"unavailable"; evidence }>`.

- [ ] Test amount/currency/merchant/order-reference agreement, COD, partial capture, refunds, unavailable providers, and duplicate delivery IDs.
- [ ] Implement concrete provider adapters using existing integrations; return unsupported when real evidence is missing.
- [ ] Preserve webhook signature/dedup and record normalized source identities.
- [ ] Store proposed automation versus observed human action with agreement category.
- [ ] Run tests; commit: `feat: add multistore payment shadowing`.

## Task 9: Clean-Path Orchestration and Compatibility Routes

**Files:**
- Create: `tests/orders/clean-path-orchestration.test.ts`
- Modify: `lib/orders/lifecycle-service.ts`
- Modify: existing confirm/reserve/invoice/ship/status order routes
- Modify: `components/finance/invoice-modal.tsx`
- Modify: `lib/invoice.ts`
- Modify: `lib/invoice-intl.ts`

**Interfaces:**
- Clean path: confirm payment → allocate warehouse → reserve → invoice → ready-to-pick.
- Existing routes retain response fields and add `commandId` and `state`.

- [ ] Test one clean fixture per store plus COD, shortage, duplicate request, invoice retry, provider failure, and stale inventory authority.
- [ ] Chain commands through durable outbox effects, not one long HTTP request.
- [ ] Convert existing routes to compatibility shims and remove hard-coded actor/debug logic.
- [ ] Keep invoice PDF layout unchanged; replay returns the original attachment.
- [ ] Run focused invoice/full tests; commit: `feat: orchestrate all-store clean orders`.

## Task 10: Provider/Notification Outbox

**Files:**
- Create: `lib/repositories/provider-attempts.repository.ts`
- Create: `lib/repositories/notification-outbox.repository.ts`
- Create: `lib/workers/lifecycle-outbox.ts`
- Create: `tests/orders/lifecycle-outbox.test.ts`
- Modify: `lib/integrations/telegram.ts`
- Modify: `lib/integrations/email.ts`
- Modify: `app/api/orders/[uid]/ship/route.ts`

**Interfaces:**
- `processLifecycleOutbox({ limit, now }): Promise<OutboxRunResult>`.
- Outcomes: succeeded, retryable, uncertain external, dead letter.

- [ ] Test lease claiming, exponential retry, notification dedup, lost-response reconciliation, kill switches, digest/immediate policy, and dead-letter handling.
- [ ] Implement claim with `FOR UPDATE SKIP LOCKED` RPC and expiring leases.
- [ ] Never retry uncertain external effects before provider reference reconciliation.
- [ ] Replace fire-and-forget shipment notifications with durable intents.
- [ ] Run tests; commit: `feat: add lifecycle provider outbox`.

## Task 11: Cancellation, Refund, Return, and Exchange

**Files:**
- Create: `lib/repositories/after-sales.repository.ts`
- Create: `app/api/orders/[uid]/after-sales/route.ts`
- Create: `tests/orders/after-sales.test.ts`
- Modify: `lib/orders/lifecycle-machine.ts`
- Modify: `lib/orders/lifecycle-service.ts`
- Modify: `lib/hooks/use-order-actions.ts`
- Modify: store order-update webhook routes
- Modify: reconciliation consumers only to read canonical refund facts

**Interfaces:**
- Commands: create/approve case, refund, receive return, inspect return, complete exchange.

- [ ] Test pre/post-reservation cancellation, post-dispatch intercept, full/partial refund, lost refund response, quarantine, inspection pass/fail, replacement reservation, and price difference.
- [ ] Implement item/quantity-scoped cases and financial/stock legs.
- [ ] Never restock from a remote cancelled/refunded status alone; require release or physical receipt/inspection.
- [ ] Replace the hook’s nonexistent ambiguous refund endpoint with typed commands.
- [ ] Run after-sales and reconciliation tests; commit: `feat: add order after-sales lifecycle`.

## Task 12: Consolidated Operator UI

**Files:**
- Create: `tests/components/fulfillment-model.test.ts`
- Modify: `components/finance/fulfillment-spine.tsx`
- Modify: `components/orders/FulfillPanel.tsx`
- Modify: `components/finance/orders-ledger.tsx`
- Modify: `lib/hooks/use-order-actions.ts`
- Modify: `lib/types/orders.ts`

**Interfaces:**
- One view model for allowed commands, events, exceptions, CRUD, and after-sales.
- `FulfillPanel` becomes a thin wrapper or is removed after all callers migrate.

- [ ] Test loading, empty, stale authority, partial provider failure, permission denial, long command, compensation preview, version conflict, and headline precedence.
- [ ] Make `FulfillmentSpine` the single lifecycle UI; remove direct stage jumping.
- [ ] Show command status, consequences, approvals, history, CRUD editor, and retry/reconcile actions.
- [ ] Remove duplicate flow constants/mutations from `FulfillPanel`.
- [ ] Run tests, `npm run build`; commit: `feat: consolidate OMS operator UI`.

## Task 13: Daily Insights and Reconciliation Context

**Files:**
- Create: `lib/operations/insights.ts`
- Create: `app/api/operations/insights/route.ts`
- Create: `components/finance/operations-insights.tsx`
- Create: `tests/operations/insights.test.ts`
- Modify: `components/finance/orders-ledger.tsx`
- Modify: `app/api/reconcile/line/[id]/orders/route.ts`

**Interfaces:**
- `buildOperationsInsights(window, tenantId)` returns clean/eligible rates, classified exceptions, movements, cutoff risk, after-sales exposure, and operator touches.

- [ ] Test clean versus eligible denominators, controllable versus business exceptions, movement totals, automatic/manual touches, resolution time, cutoff readiness, and refund exposure.
- [ ] Implement tenant-scoped database aggregates or explicit paging past 1000 rows with watermarks.
- [ ] Add daily dashboard and after-sales context to order detail without changing reconciliation match inputs/totals.
- [ ] Run insights/reconciliation/full tests; commit: `feat: add OMS operating insights`.

## Task 14: Backfill, Verification, and Promotion Runbook

**Files:**
- Create: `scripts/backfill-order-lifecycle.ts`
- Create: `scripts/verify-order-lifecycle.ts`
- Create: `tests/orders/lifecycle-backfill.test.ts`
- Create: `tests/e2e/oms-clean-path.test.ts`
- Create: `tests/e2e/oms-after-sales.test.ts`
- Create: `docs/runbooks/omnia-oms-rollout.md`
- Create: `docs/runbooks/omnia-oms-daily-report.md`
- Modify: `package.json`

**Interfaces:**
- Dry-run default backfill with explicit `--apply`, tenant/window arguments, and checkpoints.
- Verification exits nonzero on invariant failure.

- [ ] Test resumability, idempotent rerun, processed+skipped counts, protected reconciliation checksum, tenant isolation, event versioning, projection rebuild equality, and zero unexplained stock delta.
- [ ] Implement dry-run/checkpointed backfill and read-only verification commands.
- [ ] Replay all 11 fixtures plus duplicate/concurrent/stale/partial-failure/lost-response cases.
- [ ] Document shadow → supervised → automatic flags, kill switches, dead-letter replay, uncertain outcomes, old-path fallback, and exact promotion gates.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, and lifecycle verification against staging.
- [ ] Commit: `test: define OMS rollout and promotion gates`.

---

## Promotion Gates

1. **Entry:** provider/schema evidence collected and estimates reissued.
2. **Foundation:** idempotency, atomic audit, and balanced movements pass concurrency/replay tests.
3. **CRUD:** order/SKU edits are versioned; propagation always uses a fresh preview.
4. **Clean path:** all stores observed; ≥95% of clean orders automatic; every eligible order reaches target or classified exception.
5. **Dispatch:** 50 supervised shipments, zero duplicate AWBs, cutoff readiness proven.
6. **Refund/cancellation:** 20 representative cases, zero duplicate refunds, provider/ledger/stock reconciled.
7. **Return/exchange:** 10 cases, every unit traceable through quarantine/disposition.
8. **Workforce:** 20 production business days with zero unexplained stock variance and one-operator exception capacity measured.

## Self-Review

- Coverage includes non-destructive schema, multi-tenancy, lifecycle, order/SKU CRUD, inventory propagation, all stores, fulfillment, after-sales, notifications, insights, backfill, and rollout.
- No direct quantity overwrite exists; adjustments are movements.
- No implementation step contains an unspecified placeholder.
- Marketing, creative, merchandising automation, and WhatsApp AI support remain outside this OMS plan.

