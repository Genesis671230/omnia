# Payout playbooks — what to do for each gateway × currency

How each gateway payout is recognized, parsed, matched, and **booked in Zoho Books**, with worked examples from real statements (verified against live Zoho and the bank in Sept 2026). An agent booking payouts should decide everything from this file plus the live data — never from guesses about a gateway's fee or VAT convention. The conventions differ between gateways and they are the #1 source of wrong books.

Code that implements all of this:
- Parsing: `lib/parsers/payouts.ts` (`parseTabbyXlsx`, `parseTamaraXlsx`)
- Matching: `lib/reconciliation/engine.ts` (`computeReconLines`, `isConfirmablePartial`)
- Booking math (pure, unit-tested): `lib/finance/settlement-posting.ts`
- Booking sequence + idempotency: `lib/finance/publish-settlements.ts`, `lib/finance/publish-refunds.ts`
- Zoho I/O: `lib/integrations/zoho-settlement-posting.ts`
- Routes: `POST /api/settlements/publish`, `POST /api/settlements/refunds`, `GET /api/settlements/posting-options`, `/api/reconcile/ref-links`
- Tests with the real figures below: `tests/finance/settlement-posting.test.ts`, `tests/parsers/payouts-tabby-tamara.test.ts`, `tests/reconciliation/engine.test.ts`

---

## 0. The decision table

| Payout | Recognize by | Fee column | VAT on fee | Deposit To (clearing) | Difference booked as |
|---|---|---|---|---|---|
| **Tabby AED** | xlsx header `Order Number` + `Transferred amount`; statement id `Tabby<YYYYMMDD>AED`; bank narration `TABBY LLC` | `Total Deduction` — **VAT already INSIDE** | `fee ÷ 105 × 5`, claimed as input VAT | `TABBY AED` | rounding only (≤ max(AED 1, 0.25%)) |
| **Tabby SAR** (KSA) | same layout, `Currency` = SAR, id `Tabby<date>SAR` | `Total Deduction` converted at the bank's rate | **none** | `TABBY KSA` | **exchange gain/loss** |
| **Tabby KWD / QAR** | same, KWD / QAR | same | none | `TABBY KWD` / `TABBY QTR` | exchange gain/loss |
| **Tamara AED** | xlsx header `Merchant Order ID` + `Total Payable to Merchant`; Statement ID like `P8498683AE260905`; bank narration `TAMARA FZE` | `Total Fees` — **VAT NOT included** | **on top**: its own column `VAT Collected by Tamara` = `Total Fees × 5%` | `TAMARA` | rounding only |
| **Tamara SAR** (KSA) | KSA layout adds `Merchant Order Number` (`#SA3507`); `Currency` = SAR | (`Total Fees` + any VAT column) converted at the bank's rate | **none** (no UAE VAT reclaim) | `TAMARA KSA` | exchange gain/loss |
| **Tamara KWD** | Currency KWD | same | none | `TAMARA KWD` | exchange gain/loss |

**The invariant every booking must satisfy, per order:**

```
invoice amount (AED, from Zoho)  =  fee deducted (AED)  +  net received (AED, at the bank's rate)  +  difference
```

and per payout: `Σ payments − Σ fee expenses − Σ differences − Σ refunds = bank credit`. After booking, the clearing account holds exactly the bank credit, and the payout-level transfer (clearing → bank, `app/api/integrations/zoho/post-payout`) empties it to zero. If that doesn't hold, something is booked wrong — stop, don't "fix" it with a plug entry.

---

## 1. The three Zoho documents per order

Every settled order on a gateway payout becomes up to three Zoho Books documents, all through the gateway's clearing account:

1. **Customer payment** — amount = the Zoho invoice's **full balance** (never the gateway's gross, never net). Deposit To = the clearing account. Closes the invoice as Paid. Reference = bank reference (e.g. `FT262509ZBLR`).
2. **Expense** — the whole amount the gateway deducted for the order. `account_id` = Payment Gateway Charges, `paid_through_account_id` = the clearing account, `tax_treatment: "vat_registered"`, `place_of_supply: "DU"`.
   - AED payouts: `is_inclusive_tax: true` + `tax_id` = Standard Rate 5% → Zoho splits input VAT out.
   - Cross-border: `is_inclusive_tax: false`, no `tax_id`.
   - Reference `<bankRef>/<order>/FEE`.
3. **Journal** — only when `invoice − fee − received ≠ 0`. Loss (positive): Dr Exchange Gain or Loss / Cr clearing. Gain (negative): Dr clearing / Cr Exchange Gain or Loss. Reference `<bankRef>/<order>/FX`.

Refunds netted out of a payout add two more (section 6).

### Live Zoho accounts (org 2026) — re-verify with `GET /api/settlements/posting-options`

| Purpose | Account | Type | id |
|---|---|---|---|
| Tabby AED clearing | TABBY AED | payment_clearing | 2330082000022635001 |
| Tabby SAR clearing | TABBY KSA | payment_clearing | 2330082000024960065 |
| Tabby KWD clearing | TABBY KWD | payment_clearing | 2330082000039507005 |
| Tabby QAR clearing | TABBY QTR | payment_clearing | 2330082000051892001 |
| Tamara AED clearing | TAMARA | payment_clearing | 2330082000004478001 |
| Tamara SAR clearing | TAMARA KSA | payment_clearing | 2330082000004546001 |
| Tamara KWD clearing | TAMARA KWD | payment_clearing | 2330082000004546005 |
| Fee expense | Payment Gateway Charges | expense | 2330082000085768001 |
| FX / rounding | Exchange Gain or Loss | other_expense | 2330082000000000415 |
| UAE VAT on fees | Standard Rate (5%) tax | tax | 2330082000000135019 |
| (Input VAT lands in) | Input VAT | other_current_asset | 2330082000000070040 |
| Refund credit notes | Sales | income | 2330082000000000388 |

Do NOT use "Exchange gain or loss (purchase)" (other_income) — that's the purchases-side account. Do NOT deposit gateway payments straight into Sharjah Islamic Bank — the clearing account is the design (see `lib/integrations/zoho-banking.ts` header); an early build hardcoded the bank account and every booking was wrong.

`suggestPostingAccounts({provider, currency}, options)` picks these by name: provider name + currency token (`KSA|SAR`, `KWD|Kuwait`, `QTR|QAR`); for AED, the provider account whose name carries no other currency token.

---

## 2. Tabby AED

**File:** Tabby settlement report `.xlsx`. Header row contains `Order Number`, `Order Amount`, `Total Deduction`, `Transferred amount`, `Currency`, `Type`. Statement # `Tabby20260907AED`.

**Fee convention:** `Total Deduction` **includes** VAT. `gross − Total Deduction = Transferred amount`.

**Worked example — payout Tabby20260907AED, bank FT262509ZBLR, AED 41,080.84, order 804928:**

| | AED |
|---|---|
| Zoho invoice MNS-052974 balance | 1,363.50 |
| Order Amount | 1,363.50 |
| Total Deduction (fee incl. VAT) | 94.11 |
| → VAT = 94.11 ÷ 105 × 5 | 4.48 |
| → charge ex-VAT | 89.63 |
| Transferred | 1,269.39 |
| Difference | 0.00 |

Books: payment 1,363.50 → TABBY AED; expense 94.11 VAT-inclusive (Zoho: 89.63 Payment Gateway Charges + 4.48 Input VAT) paid through TABBY AED; no journal.

**Matching:** bank credit amount = payout `Transferred` total within `max(AED 1, 2%)`; AED variance must be ≤ AED 1 to be SETTLED.

**Rounding:** an AED gap up to `max(AED 1, 0.25% of invoice)` books to Exchange Gain or Loss as rounding (order 804671: invoice 1,792.57 vs Tabby 1,794.00 → −1.43 rounding gain). Bigger → hold for review, never plug.

## 3. Tabby SAR / KWD / QAR (cross-border)

**File:** same layout, `Currency` = SAR (id `Tabby20260706SAR`). The parser converts to AED at a static estimate (`lib/fx.ts`) and keeps originals (`gross_original`, `fee_original`, `net_original`).

**Rate rule:** the bank credit is the truth. If the narration quotes a rate (`SAR/AED 0.958791`, regex `\b([A-Z]{3})\s*\/\s*AED\s*([\d.]+)`), the engine rescales shares to it. If not, booking rescales every order's fee and net by `bankScale = bank credit ÷ payout net (estimate)` (`bankScaleFor`). Fees are converted with the same rate as the net.

**No VAT** on cross-border fees — the whole deduction is cost.

**Worked example — Tabby20260706SAR, bank FT262220D1Z2 credited AED 28,036.36; estimate net 28,492.32 → bankScale 0.983997. Order SA3544:**

| | AED |
|---|---|
| Zoho invoice MNS-050270 (AED, at order-day rate) | 1,490.93 |
| Fee 95.75 × 0.983997 | 94.22 |
| Net 1,362.45 × 0.983997 (what the bank really paid) | 1,340.65 |
| Difference 1,490.93 − 94.22 − 1,340.65 | **56.06 loss** |

Books: payment 1,490.93 → TABBY KSA; expense 94.22 no VAT; journal Dr Exchange Gain or Loss 56.06 / Cr TABBY KSA 56.06.

**Sanity:** a cross-border difference above 15% of the invoice is not FX — it's a wrong invoice match or partial refund → review. Also compare each order's implied rate with the payout's median; a sign flip (SA3593 showed a 44.09 *gain* while every other order was a ~4% loss) is an outlier worth a look.

## 4. Tamara AED

**File:** Tamara merchant statement `.xlsx`. Summary block, then transaction header: `Transaction Date`, `Tamara Order ID`, `Merchant Order ID`, `Refund Reason`, `Payment Type`, `Order Status`, `Currency`, `Order Amount`, `Event`, `Event Amount`, `Event Date`, `Tamara Fixed Fees`, `Tamara Variable Fees %`, `Tamara Variable Fees`, `Total Fees`, `VAT Collected by Tamara`, `Total Payable to Merchant`, `Installments`. Statement ID label → payout id `TAMARA-<id>`.

**Fee convention (opposite of Tabby):** `Total Fees` **excludes** VAT. VAT is charged on top in its own column: `VAT = Total Fees × 5%`. `Event Amount − Total Fees − VAT = Total Payable to Merchant`.

**Worked example — statement P8498683AE260905 (29/08–04/09/2026), bank FT262517PC8K, AED 17,783.66, order WA55560:**

| | AED |
|---|---|
| Zoho invoice MNS-052648 | 2,662.00 |
| Total Fees | 160.95 |
| VAT Collected by Tamara (160.95 × 5%) | 8.05 |
| **Expense = fee + VAT** | **169.00** |
| Total Payable | 2,493.00 |
| Difference | 0.00 |

Books: payment 2,662.00 → TAMARA; expense **169.00** VAT-inclusive (Zoho splits 169 × 5/105 = 8.05 → exactly the statement's VAT); no journal. Posting fee+VAT inclusive (rather than 160.95 exclusive) guarantees the amount leaving clearing equals what Tamara deducted even if Zoho rounds VAT differently.

**Parser pitfalls that were real bugs:**
- **Negatives in brackets.** Refund row: `Event Amount (592.42)`, `Total Payable (592.42)`. `parseFloat("(592.42)")` is NaN → was 0 → payout net 18,376.08 instead of 17,783.66 → the credit never matched and the upload "did nothing". `num()` now parses `(x)` as −x.
- **Partial refunds:** use `Event Amount` (592.42), not `Order Amount` (672.60).
- **`Merchant Order ID` can be a phone number** (Tamara payment links: `0655572535`). It matches no order → ORDERS_UNRESOLVED. See section 7.

## 5. Tamara SAR / KWD (cross-border)

Not yet seen live in this org — rules come from the owner and the AED statement structure:
- KSA layout has `Merchant Order Number` (`#SA3507`); `Merchant Order ID` there is Tamara's internal id, often Excel-mangled (`6.61169E+12`) — always prefer `Merchant Order Number`.
- Convert `Total Payable to Merchant` and fees to AED at the bank's applied rate (same `bankScale` rule as Tabby SAR).
- **No UAE VAT reclaim.** If the statement carries a VAT column (KSA VAT), it was still deducted — it's included in the fee cost, otherwise the FX line would silently absorb it. (Implemented this way; confirm with the owner the first time a real file arrives.)
- Difference `invoice − fee − received` → Exchange Gain or Loss.
- Deposit To `TAMARA KSA` / `TAMARA KWD`.

**First live Tamara SAR file: run Preview, check that Σ(fee + received) = bank credit and that FX % per order is consistent, and record the verified numbers here.**

## 6. Refunds netted out of a payout

A refund row (Tamara `Event = Refunded`, Tabby `Type` contains refund) reduces the payout. It must be booked or the clearing account ends short by that amount.

Flow (`lib/finance/publish-refunds.ts`, table `refund_postings`):
1. Find the order's invoice that is **paid** and big enough to cover the refund (`pickInvoiceForRefund`). If it's still unpaid, the original capture (in an earlier payout) hasn't been booked — book that first.
2. **Credit note:** if the customer already has an **open credit note** whose balance covers the refund, reuse it (someone raised it by hand — creating another would credit the sale twice). Otherwise create one: single VAT-inclusive line for exactly the refund amount, invoice's own `tax_id` and sales `account_id`, `invoice_id` linked, no `item_id` (no restock). Reference `<bankRef>/<order>/RFN`.
3. **Refund the credit note** from the clearing account: `POST /creditnotes/{id}/refunds` `{from_account_id: clearing, amount, refund_mode: "Bank Transfer", reference: <bankRef>/<order>/RFD}`.

Real case: order 804047 on FT262517PC8K — invoice MNS-052459 (672.60, paid via TAMARA), refund 592.42, customer already had open credit note OCN-03554 (642.60) → reuse it, refund 592.42 against it; 50.18 stays open on the note.

Credit-note creation and credit-note refunds were built and previewed but not yet posted live as of 2026-09-15 — verify the first real one in Zoho.

## 7. Lines that aren't order numbers

- Store prefixes: refs can be `WA5204`, `SA5204`, `KSA…`, `UAE…`, `WOO…` while `orders.order_number` may be bare — the engine tries both.
- **Phone-number refs** (Tamara payment links): link them to the real order via `payout_ref_links` (`POST /api/reconcile/ref-links`). Suggestion ranking: phone match (last 9 digits) ≫ same gateway ≫ exact amount ≫ order date inside `[bank date − 45d, bank date]`; orders already on the same payout are excluded; already-settled orders are demoted.
- A credit whose payout foots but has unmatched lines is **confirmable as a partial** (`isConfirmablePartial`): the matched orders get settlement records and book normally; unmatched lines stay listed until linked.
- **One settlement record per order, ever.** If another payout (e.g. the Stripe API auto-settlement) already holds an order's record, it can't settle here — orders 804643/804694 (Tamara orders) were claimed by Stripe payouts. That's a matching error upstream; surface it, don't overwrite.

## 8. Zoho invoice lookup rules

- Invoices are found by **customer name prefix** = order number (`findZohoInvoiceCandidates`), word-boundary checked, retrying without the store prefix.
- **Multiple invoices per order happen** (re-issues). `pickInvoiceForOrder`: an invoice already booked against (`settlement_records.zoho_invoice_id`) wins; else the one whose total matches the gateway amount (AED: within max(1, 0.25%); cross-border: closest within 15%); open beats paid at the same amount; identical-amount duplicates → review ("void the duplicate"). Example 804891: MNS-053146 (954) vs MNS-052917 (1,678.50), Tabby 1,678.50 → MNS-052917.
- **Never trust the local table for "closed"** — re-read the invoice. 805050 held a payment id that had been deleted in Zoho ("Payment does not exist"); trusting it booked the fee while the invoice stayed overdue. If a saved payment id exists but nothing is applied to the invoice, re-post the payment.
- Invoice already paid with **no payment carrying our reference** = paid by hand (e.g. SA3580: paid 07/07 into TABBY KSA, empty reference). Default: skip payment AND fee/FX (the bookkeeper may have booked the fee too). Only book fee/FX on those when explicitly told the fees were never booked (`bookFeesOnExternallyPaid`).
- Partially paid by someone else → review, book by hand.

## 9. Idempotency (why a retry can never double-book)

- Row lease: `settlement_records.zoho_claimed_at` / `refund_postings.claimed_at`, 5-minute expiry (a crashed run never strands an order).
- Before each Zoho write the id column gets `PENDING:<uuid>`; the real id replaces it; a clean Zoho rejection (`ZohoRejection`) clears it.
- A retry that finds `PENDING:` looks the document up by its reference first (`/expenses?reference_number=`, `/journals?reference_number=`, credit-note refunds list) before writing.
- A payment is only created while the invoice is fully open.
- Legacy `CLAIMED:` markers from the old flow are treated as "not posted" and re-verified against the invoice.

## 10. Numbers an agent must never break

- Zoho daily API budget: 5,000 org-wide; `zohoThrottledFetch` enforces 4,500. A 28-order payout ≈ 150 paced calls. Dry runs cost reads too.
- Money is rounded to 2 dp at each document, not at the end.
- Only ever sum AED columns across currencies.
- The bank statement is truth; the payout file explains it; the invoice is the amount to close.
