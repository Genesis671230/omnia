# Reconciliation Proof & FX Legibility — Design Spec

Date: 2026-07-23
Status: Approved (office-hours session), ready for implementation planning

## Context

The July 16 hardening pass (`2026-07-16-recon-gateway-hardening-design.md`) made every
gateway's bank credit *matchable* — COD and Checkout got parsers, Tabby/Tamara started
emitting per-order `transactions[]`, and the `AWAITING_PAYOUT` state got real contrast.
That work is shipped and verified in the current code (`computeReconLines`,
`parseCodCsv`/`parseCheckoutCsv`, `shareByRef` in the Tabby/Tamara parsers all confirmed
present).

This spec is the next gap: matching correctly is not the same as being *legible*. The
founder's own framing: reconciliation needs to be "bullet proof" enough that the finance
team stops checking every order by hand, and entries can go to Zoho on trust. Two
screenshots of the current UI showed the actual gap —

1. A **SETTLED Stripe row** renders a live "Stripe proof" table: order / gross / fee / net
   per line item, pulled from Stripe's own API, ending in "Ready for founder confirmation."
2. Every other gateway (Tabby, Tamara, Checkout, COD) has none of that. A SETTLED
   non-Stripe row shows only a flat list of order numbers (`#WA55131, #WA55127, ...`) —
   no breakdown, nothing to independently verify, just "trust it."

The founder named three concrete gaps: (1) no per-order proof/trace for non-Stripe
gateways, (2) the FX rate is shown (`1 SAR = 0.98 AED, bank-quoted`) but never the actual
fee amount a cross-border payout (Tabby KWD; non-UAE Tamara/Tabby) had deducted, (3) the
payout-file upload UX is one click-to-upload button buried inside a single row, not
grouped per gateway for bulk drag-and-drop.

## Scope decision (confirmed with founder)

Of the three, **the proof table ships first** — it's the one gap that answers "how do I
know this number is right" for every non-Stripe gateway at once; the FX fee line and the
upload UX are downstream of it (FX fee literally becomes a row inside this same proof
panel). **Upload UX (grouped drag-and-drop) is out of scope for this spec** — independent
component, no shared blocking dependency, deferred to its own pass.

**Who this is actually for:** the founder is testing the reconciliation page today, but
the real day-to-day user is a bookkeeper — not a technical reader. This is why the design
below leads with a plain-language verdict, not a raw numbers table.

## The FX correctness bug found while tracing this (must be fixed here, not deferred)

Read end-to-end before proposing a UI fix:

- `lib/parsers/payouts.ts`'s Tabby/Tamara/Checkout parsers compute `transactions[]`
  (`PayoutTransactionShare.netShare/grossShare/feeShare`) at **upload time**, converting
  original-currency amounts to AED via `toAed()` (`lib/fx.ts`'s static `FX_TO_AED` table).
- `lib/reconciliation/engine.ts`'s `expectedNetFor()` computes the **authoritative**
  "Payout net" (the number the founder currently sees, and the one `variance`/
  `SETTLED`/`PAYOUT_VARIANCE` are judged against) using the **bank's own quoted wire
  rate** read from the credit's narration (`bankQuotedRate()`, `fxSource: "bank"`) when
  the narration has one — falling back to the same static `FX_TO_AED` estimate only when
  it doesn't.
- These are two different rates computed at two different times. They agree whenever
  `fxSource === "estimate"` (both used the static table), but **diverge whenever
  `fxSource === "bank"`** — which is exactly the cross-border case (Tabby KWD, non-UAE
  Tamara/Tabby) this spec exists to make legible.
- Net effect if left unfixed: render `transactions[]` as-is in a proof table, and the
  per-order rows will not sum to the confirmed "Payout net" header whenever the bank's
  actual rate differs from the static estimate — silently reintroducing the exact
  guesswork this feature is supposed to eliminate, in the one case (cross-border) the
  founder explicitly called out.

**Fix, confirmed with founder:** rescale is computed at the engine layer (not the
frontend), so the corrected numbers are a single source of truth available to any future
consumer, not just this one screen.

## Chosen approach: engine-level rescale + explicit correction/FX-fee line

Two other approaches were considered and rejected:

- *Client-side display rescale only* — fastest to ship, but the correction logic would
  live only in the React component; any other consumer (export, API, a future view)
  wouldn't get corrected numbers without reimplementing the same math. Rejected — doesn't
  match the founder's own "real math, no guesswork, fully tested" constraint from the
  July 16 pass.
- *Engine-level rescale, rendered as a plain table with no explanation* — mathematically
  correct and testable, but a bookkeeper reading a corrected number with no explanation of
  why it changed from what the file said is still not "bullet proof" to a non-technical
  reader. Rejected on the D3 finding (bookkeeper is the real user).

**Chosen:** engine-level rescale (correct numbers, single source of truth, fixture-tested
to the cent like every other parser in this codebase) **plus** an explicit plain-language
line distinguishing two different reasons a number can move:
1. **Rate-drift correction** — our static estimate vs. the bank's actual quoted rate (an
   internal artifact of *our* system, not something the gateway charged).
2. **FX fee** — the gateway's own foreign-exchange deduction on a genuine cross-border
   settlement (present even when our rate estimate was spot-on).

These must stay visibly distinct — conflating them turns a legibility feature into a new
source of confusion for exactly the reader (bookkeeper) it's meant to serve.

### 1. Engine: rescale `transactions[]` to the bank-quoted rate

`lib/reconciliation/engine.ts`:

- `ReconLine` gains `transactions: ReconTransactionShare[]` (currently `ReconLine` exposes
  no per-order breakdown at all — confirmed by reading the type, lines 29-49).
- In `computeReconLines`, wherever `expected = expectedNetFor(payout, credit)` is already
  computed (existing code, unchanged), also compute a scale factor
  `scale = expected.fxSource === "bank" ? expected.net / payout.net_amount : 1` and map
  `payout.transactions` through it: `netShare *= scale`, `grossShare *= scale`,
  `feeShare *= scale` (rounded to the cent per share, with the same "don't silently drop
  a cent" discipline as the rest of this engine — reconcile any rounding remainder onto
  the largest share, not dropped).
- New fixture tests in `tests/reconciliation/engine.test.ts`: a payout with
  `fxSource: "bank"` where the static-estimate-based `transactions[]` sum differs from
  `expected.net` by a known amount — assert the rescaled shares sum **exactly** to
  `expected.net` (`.toFixed(2)`), and assert the `fxSource: "estimate"` case is a no-op
  (scale === 1, shares unchanged) — anti-regression for the common case.

### 2. Engine or API layer: classify the "why it moved" reason per line

Alongside the rescale, compute (once per `ReconLine`, not per order — the two reasons
below are properties of the payout, not of individual orders):

- `rateDriftAed = +(expected.net - payout.net_amount).toFixed(2)` when `fxSource ===
  "bank"`, else `null`. This is the rate-drift-correction amount.
- `fxFeeAed`: the genuine cross-border fee. Needs the gateway's own gross-in-original-
  currency figure (already available — Tabby/Tamara parsers compute `gross`/`fees` per
  payout) converted at the **same bank-quoted rate** used for `net`, so
  `fxFeeAed = (grossOriginal × expected.fxRate) − expected.net` — i.e. computed
  consistently with the corrected net, not the parser's separate estimate-based `fees`
  field (which would reintroduce the same footing bug this spec exists to fix).

### 3. Frontend: generic `GatewayProofTable`, bookkeeper-first framing

`components/finance/finance-workspace.tsx`:

- Extract the existing Stripe-only `stripe-proof` block into a `GatewayProofTable`
  component that accepts `transactions: ReconTransactionShare[]` plus the two reason
  fields above — works for any provider, sourced from the `ReconLine` payload (no live
  fetch needed for non-Stripe; Stripe keeps its existing live-fetch path unchanged since
  that's a different, already-correct data source).
- Leads with a **one-line plain-language verdict**, not the table:
  - Exact match, no FX involved: *"Matches exactly. All N orders accounted for."*
  - Cross-border, rate-drift only: *"Matches — AED {rateDriftAed} adjustment: our estimate
    said {static rate}, the bank actually quoted {bank rate}."*
  - Cross-border, genuine FX fee: *"Matches — {gateway} deducted AED {fxFeeAed} converting
    {currency} to AED at {rate}."*
  - Both present: state both, in that order, as two short sentences — not merged into one
    dense sentence.
- The gross/fee/net **table stays present but becomes expandable/secondary** — the
  bookkeeper's first read is the verdict sentence; the table is there for the founder or
  an auditor who wants the line-by-line proof, same information Stripe already shows,
  just not the headline.
- Telr is explicitly **not** included in this pass — its parser has no `transactions[]`
  today (aggregate-only, confirmed by reading `parseTelrXls`). A Telr row keeps today's
  flat order-number list; giving it the same proof table is a follow-up parser task,
  same shape as the COD/Checkout work from July 16, not part of this spec.

## Out of scope

- Per-gateway grouped drag-and-drop payout upload UX (deferred per founder — separate
  component, no shared dependency with this spec).
- Adding `transactions[]` to the Telr parser (would need its own parser-level task,
  mirroring the July 16 COD/Checkout pattern — not blocking this spec, since Telr rows
  simply don't get the new proof table until that lands).
- Any change to how `expectedNetFor`/`bankQuotedRate` *finds* the bank's rate — that logic
  is unchanged and already correct; this spec only fixes what happens to `transactions[]`
  once that rate is known.

## Testing & verification (same discipline as the July 16 pass — no guesswork, real math)

- `tests/reconciliation/engine.test.ts`: fixture proving rescaled `transactions[]` sum
  exactly to `expected.net` when `fxSource === "bank"` and the static estimate differs
  from the bank rate by a known margin; a no-op fixture for `fxSource === "estimate"`;
  a fixture proving `rateDriftAed` and `fxFeeAed` are computed independently and don't
  double-count the same AED difference.
- Run the full existing suite (`npx tsx --test 'tests/**/*.test.ts'`) after the change —
  this touches `computeReconLines`, the same function the July 16 fixture tests already
  cover; nothing in the existing SETTLED/PAYOUT_VARIANCE/AWAITING_PAYOUT assertions should
  shift.
- No new dependency, no schema change — `transactions` already exists on
  `PayoutWithRefs`/`ParsedPayout`; this only adds a rescale step and two derived numbers.
