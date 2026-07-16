# Reconciliation Gateway Hardening — Design Spec

Date: 2026-07-16
Status: Approved, ready for implementation planning

## Context

`RECONCILIATION_MODULE_SPEC.md` establishes the canonical model: bank credit is the only
source of truth, a payout file is the bridge that derives AED, orders are attributed only
after a bank-confirmed match. That model is implemented and working for Stripe and (as of
the prior session) Tabby/Tamara SAR & KWD cross-currency matching. This spec covers three
concrete gaps found by reading the actual code against a real bank statement line the
founder flagged as "not recognized":

```
KWD Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES/AL MARARR 2- 102 PLOT NO 198-0
OFFI/CE 102-448 Dubai UAE//REF/invoice 16964/FT26192VXFKW FT26192VXFKW
Date 2026-07-11 · Bank credit AED 2,462.00
```

Investigation (not guesswork — read the code):

1. `lib/gateways.ts` already classifies this narration correctly as `COD` via the
   `"ON TRACK DELIVERY"` keyword rule (`confidence: "keyword"`). The classifier is not the
   bug.
2. `lib/parsers/payouts.ts` has dedicated parsers for Telr, Tamara, Tabby, and Stripe, but
   **none for COD** — so no uploaded file can ever satisfy `payouts.find(p => p.gateway ===
   "COD" ...)` in `lib/reconciliation/engine.ts`, and the credit is structurally stuck in
   `AWAITING_PAYOUT` forever, regardless of what's uploaded.
3. Checkout.com's actual settlement export (Interchange++ breakdown: `Payment ID`,
   `Breakdown Type`, `Processing Currency Amount`, `Holding Currency Amount`, etc. — sample
   provided by founder) also has no dedicated parser and would fall through to
   `parseGenericPayoutCsv`, which sums every row (fees, taxes, network-token-update
   charges) as if it were an order amount — wrong net, by construction.
4. `parseTabbyXlsx` / `parseTamaraXlsx` compute per-order net/fee/refund while looping rows
   but only ever emit the aggregate total — the per-order breakdown is discarded before
   reaching `ParsedPayout.transactions`. `lib/repositories/payouts.repository.ts` and
   `lib/reconciliation/engine.ts` already fully support `transactions[]` (that's how Stripe
   gets per-order refund badges and quality flags today) — Tabby/Tamara just never feed it.
5. UI: `AWAITING_PAYOUT` — the state nearly every COD credit lands in — renders with
   `tone: "muted"`, the flattest, least distinct color in the palette
   (`components/finance/finance-workspace.tsx` `STATE_META` + `CSS` block), while `ok` /
   `warn` / `bad` all get real color. The explanatory copy is generic regardless of what the
   system actually knows about the credit.

## Scope decisions (confirmed with founder)

- **All four gaps in this pass**, not split into separate specs — they're independent
  files/functions, low coupling, and the founder wants the reconciliation module usable now.
- **Checkout.com grouping key:** the sample export has `Payout ID` blank on every row
  (`Payment ID` is the only populated per-charge id). Per founder: group by
  `(Currency Account ID, Processed On date)` instead of waiting for a real file with
  `Payout ID` populated. If a future upload does have `Payout ID` populated, prefer it —
  the grouping falls back to date+account only when `Payout ID` is empty for that row.
- **COD source file:** founder confirmed On Track Delivery does send a periodic
  invoice/statement (the bank narration's "invoice 16964" refers to it) — so this gets a
  real per-provider parser like Telr/Tamara/Tabby, not a narration-only guess. No sample
  file exists in the repo yet, so column detection must be generous (see below) and is
  expected to need one iteration against the first real upload.
- **Non-negotiable constraint (founder, verbatim): "fully tested to the fill calculation
  is done no guesswork, real math."** Every parser in this batch gets fixture-based tests
  that assert exact totals to the cent — not "close enough," not snapshot tests of whatever
  the code currently produces. See Testing section.

## 1. COD / On Track Delivery parser

New `parseCodStatement` (CSV and XLSX) in `lib/parsers/payouts.ts`, same return shape as
the existing parsers (`ParsedPayout`). Provider tag: `"COD"`.

**Invoice/batch id** (becomes the payout id, e.g. `COD-16964`): checked in order —
1. A column named `invoice`, `invoice no`, `invoice number`, or `invoice #`.
2. A banner cell anywhere in the first 40 rows matching `/INVOICE\s*#?\s*(\d{3,})/i`
   (mirrors `PAYOUT_ID_RE` in `parseTelrXls`).
3. The filename, via `/(\d{3,})/`.
4. Else `"UNKNOWN"` (never throw on a real file — an unresolvable id still lets amount
   matching find the credit; it just can't be named nicely).

**Order ref column** (first match wins): `order`, `order no`, `order number`, `order id`,
`awb`, `awb no`, `tracking`, `tracking no`, `reference`.

**Amount column** (first match wins): `cod amount`, `amount collected`, `collection
amount`, `net amount`, `net`, `amount`.

Reject the file (throw, with the columns it saw) if no amount column is found — same
contract as `parseGenericPayoutCsv`. Do not guess an amount column.

**Bank-side companion change** — `lib/parsers/bank.ts`: `REF_RE` only recognizes
`FT/DSZ/INSTQ` wire codes. Add a fallback: when `REF_RE` doesn't match, try
`/\bINVOICE\s*#?\s*(\d{3,})\b/i` and store as `INV16964` (prefixed, so it's visually
distinct from a wire code and matches the `COD-16964` payout id pattern by number). This is
what makes the row header show `Bank · INV16964` instead of a raw `FT...` code — directly
answers "recognize the sender," since the founder can now see at a glance this credit
already carries a legible reference.

**Detection wiring** in `parsePayoutFile`: sniff for `ON TRACK DELIVERY` in file content, or
`hint === "COD"`, before falling through to the generic CSV parser. Generic CSV stays as
the final fallback for a COD file shape this parser's heuristics don't recognize — never a
silent failure, always a specific "no amount column found in [...]" error.

## 2. Checkout.com settlement parser

New `parseCheckoutCsv` in `lib/parsers/payouts.ts`. Provider tag: `"Checkout"`.

**Detection:** header row contains `Client Entity Name`, `Holding Currency Amount`, and
`Breakdown Type` (sniffed the same way Tamara/Tabby are — first 40 rows, uppercased).

**Grouping into one payout batch:**
```
key = row["Payout ID"] || `${row["Currency Account ID"]}_${row["Processed On"].slice(0,10)}`
```
One `ParsedPayout` per distinct key. `id = "CKO-" + key`.

**Net (per group):** `sum(row["Holding Currency Amount"])` across every row in the group —
fee/tax rows already carry a negative `Holding Currency Amount`, so the raw sum already
nets fees out. This matches the founder's confirmation that Checkout remits the exact
figure to the bank — no FX derivation, no `batch_fx`, no `originalCurrency` field on the
output (holding currency is AED in every sample row; if a group ever mixes holding
currencies, that's a hard error, not a silent average — Checkout settling one currency
account in more than one currency at once should never happen and is worth surfacing loud).

**Per-order `transactions[]`** (sub-grouped by `Payment ID` within the payout group):
- `netShare` = sum of `Holding Currency Amount` for that `Payment ID`.
- `grossShare` = sum of positive `Holding Currency Amount` rows for that `Payment ID`
  (the charge side, before fees).
- `feeShare` = sum of negative `Holding Currency Amount` rows, as a positive magnitude.
- `ref` = first non-blank `Reference` cell across the `Payment ID`'s rows, `#`-stripped.
- `isRefund` = `Action Type` contains `refund` (case-insensitive) for any row in the group,
  OR `netShare < 0`.
- `quality`: `"clean"` (exactly one non-blank `Reference` value seen), `"unparseable"` (none
  seen — net still counts toward the payout total, just unattributed), `"multi"` (more than
  one distinct `Reference` value under one `Payment ID` — shouldn't normally happen, flag it
  rather than silently pick one).

`orderRefs` on the `ParsedPayout` = the deduplicated `ref` values across all `Payment ID`
groups with a `ref`.

## 3. Tabby / Tamara: emit `transactions[]`

Both `parseTabbyXlsx` and `parseTamaraXlsx` already compute, per row: the AED net/gross/fee
(via `toAed`), `isRefund` (from `jType`/`jRefundId`), and the cleaned `ref`. The only change
is to also push a `PayoutTransactionShare` per row into a `transactions` array, and include
it on the returned `ParsedPayout` — mirroring exactly what `parseStripeCsv` does for its
`byPayout` map. No change to `lib/reconciliation/engine.ts` or
`lib/repositories/payouts.repository.ts` — both already fully consume
`ParsedPayout.transactions` when present (that's the whole reason Stripe already shows
per-order refund badges and quality flags in the UI); Tabby/Tamara have just never
populated it.

`quality` for these: `"clean"` for a normal single-ref row, `"refund"` when `isRefund`,
`"multi"` if the same `ref` appears more than once in the statement (shares get summed, not
overwritten — matches the even-split precedent already used for Stripe's multi-ref
descriptions).

## 4. UI: contrast + situational messaging

`components/finance/finance-workspace.tsx`:

- New CSS tone `info` (teal, e.g. `--info: #2E6B7A; --info-wash: #E8F1F3;`) distinct from
  `ok`/`warn`/`bad`/`gold`. Applied to `.row.info`, `.pill.info`, `.doc-chip.info`,
  `.kpi.info`.
- `STATE_META.AWAITING_PAYOUT` moves from `tone: "muted"` to `tone: "info"`.
- The expanded-row note for `AWAITING_PAYOUT` becomes situational instead of one fixed
  string per confidence level:
  - If the parsed reference looks like a recognized pattern (`INV\d+`, a wire code, etc.),
    name it: *"Bank credit confirmed as **{provider}** (ref **{reference}**). Upload the
    {provider} {statement-noun} that explains it — the invoice/reference number visible
    here should match the file."* `{statement-noun}` varies per provider (`"settlement
    report"` for Tabby, `"merchant statement"` for Tamara, `"remittance invoice"` for COD,
    `"payout reconciliation report"` for Stripe, `"settlement export"` for Checkout,
    `"payout file"` generic fallback) — small lookup table, not a hardcoded sentence.
  - Low/unknown confidence keeps today's honest "no classification rule matches" copy —
    that path is not being touched, it's already correct.
- Collapsed row already shows `provider` and the state pill; add the reference (when
  present) next to the bank `ChainLink`'s `sub` text so a founder scanning the list without
  expanding anything can see `Bank · INV16964` immediately — currently `sub` falls back to
  `r.id.slice(0,8)` (an opaque UUID fragment) whenever `reference` is empty, which is
  exactly the "no fruitful info" complaint. This already works correctly once (1) ships;
  this bullet is just confirming no separate change is needed here beyond making sure
  `reference` renders when present.

## Testing & verification (founder requirement — no guesswork, real math)

Every new/changed parser gets a fixture-based unit test asserting **exact** totals, not
approximate ones:

- **Fixtures:** hand-built CSV/XLSX strings in the test files themselves (same pattern as
  any existing parser tests in the repo — checked before writing, so format matches), with
  known, hand-computed expected totals. For Checkout: a fixture built directly from the
  founder's pasted sample rows (Network Token Update fee, Authorization fee + tax, Scheme
  fee + tax), with the expected net computed by hand from those exact numbers and asserted
  to the cent (`toFixed(2)`), not rounded loosely.
- **COD:** fixture with at least two order rows summing to a known COD amount, plus a
  banner-only invoice number case and a filename-only invoice number case (all three
  detection paths exercised, not just the happy path).
- **Tabby/Tamara `transactions[]`:** fixture asserting that `sum(transactions[].netShare)
  === payout.net` exactly, and that a refund row's `isRefund` and negative share both
  surface correctly, and that a duplicated ref across two rows sums (not overwrites).
- **Checkout grouping:** fixture with two `Payment ID`s under one `(account, date)` key and
  a `multi`-quality case (two different `Reference` values under one `Payment ID`) to prove
  the quality flag fires rather than silently picking one.
- **Reconciliation-level (`lib/reconciliation/engine.ts`):** at least one test per new
  provider proving bank credit → payout → order resolves to `SETTLED` with `variance ===
  0.00` on matching fixtures, and a mismatched-amount fixture proving the `TOLERANCE_AED`
  gate correctly produces `PAYOUT_VARIANCE` rather than silently accepting a near-miss.
- **No hardcoded FX guesses:** Checkout/COD tests must never invent an FX rate — both are
  AED-native by design in this spec (Checkout's `Holding Currency Amount` already is AED;
  COD collections are already AED cash), so no `originalCurrency`/`netOriginal` fields
  should appear on their `ParsedPayout` output. A test asserts these fields are absent for
  both, catching any future accidental FX-guessing regression.
- Run the full existing parser/engine test suite after each change, not just the new tests
  — Tabby/Tamara currently have passing behavior for net/gross/fee totals that must not
  shift by even a cent when `transactions[]` is added alongside the existing aggregate math.

## Out of scope

- Building a live COD/On Track Delivery API integration (none exists; file upload only,
  matching every other non-Stripe gateway today).
- Telr/Checkout live API pulls (Telr is already known blocked per prior investigation;
  Checkout has no automated pull today, upload-only for this pass).
- Redesigning the full color system beyond the specific `info` tone gap identified — no
  unrelated visual refresh.
