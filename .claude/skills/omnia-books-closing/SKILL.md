---
name: omnia-books-closing
description: Close Omnia's books in Zoho from what actually reached the bank. Use this whenever the founder or finance team asks which invoices are paid in the bank but still open in Zoho, wants invoices closed with the correct gateway fee / VAT / exchange difference, wants refunds booked with their gateway charges (VAT on UAE, none on KSA), asks about credit notes left open, exchanges, cancellations, returns or sales returns, wants a today / yesterday / month report from the dispatch sheet (Local orders, SMSA Orders, OnTrack COD) compared with Zoho, or asks for a ledger snapshot accountants can verify. Also use for any daily or month-end close, "book the September payouts", "why is this credit note still open", "reconcile refunds", or preparing a closing plan for approval, even if Zoho, Stripe, Tabby, Tamara, Telr, Shopify Payments or OnTrack are not named explicitly.
---

# Omnia books closing

Turns bank credits into correct Zoho books: every invoice the bank already paid gets
closed at its full balance, with the gateway's fee, its VAT and any exchange
difference booked beside it, and every refund the gateway took out of a payout gets
its credit note refunded and its charge booked. Everything runs through the app's
own booking engine, first as a dry run the founder approves, then live, then read
back from Zoho into a ledger snapshot accountants can tick.

Read `omnia-finance` (accounting playbooks per gateway × currency) and
`omnia-sales-recon` (order → payout → bank chain) for the model this sits on.

## The rhythm that works

The founder decides; the agent proves. Every step before posting is read only, and
posting happens only for sets the founder named. The loop:

1. **Scope** the bank dates (a day, "1st of the month till today"). Money is only
   "received" when a bank credit is matched to a payout file (`recon_lines`); orders
   never reconcile straight to the bank.
2. **Report** open invoices on received money: `scripts/open-invoices-report.ts`
   (one Zoho sweep of all open invoices, ~12 calls, matched by customer-name prefix =
   order number). Split by gateway and by how easy each is to close.
3. **Plan** with the engine's dry run: `scripts/plan-closings.ts` runs
   `publishSettlements({dryRun:true})` and `publishRefunds({dryRun:true})` for every
   credit in scope. Nothing is written. Classify results with the groups below.
4. **Explain and ask.** Give an Excel plan (sheet per group) and a short numbered list
   of decisions. Wait for explicit answers per group; "OK" to one group is not OK to
   another.
5. **Re-plan on the day you post.** The team books from the app too (on 24 Sep they
   booked 17 of the 42 planned orders between plan and approval). Always dry run again
   right before posting and post only what is still `would_post`.
6. **Post** approved sets only: `scripts/post-approved.ts --live`. It skips
   unconfirmed credits, applies founder-approved force allocations for small gaps,
   books fee-only on invoices paid by hand when approved, then refunds.
7. **Read back** every document from Zoho (`scripts/readback.ts`) and build the ledger
   snapshot (`scripts/build-ledger-snapshot.cjs`). Report counts, AED, what was held
   and why, and the next decisions.

Commands, arguments and file flow: `references/closing-run.md`.

## Groups to sort the dry run into

| Group | What the engine says | Proposal |
|---|---|---|
| Close now | `planned`, payment `would_post` | Close full balance, fee (VAT on AED credits), FX/rounding journal |
| A. Small currency gap | review "doesn't match", gap ≤ 3.5% **and** gateway fee + net = gateway gross (±1) | Force-allocate the one open invoice, gap to Exchange Gain or Loss. Needs founder OK |
| B. Exchange top-up | two invoices, one paid, small Stripe amount (30/70/…) | Not a plain close: returned item's credit note applied to the new invoice + the top-up |
| C. Partial / mismatch | gap > 3.5%, or fee + net ≠ gross | Human look: partial payment, multi-order charge, earlier refund |
| D. Duplicate invoices | several open, none or two match | Void the duplicate first |
| E. No invoice | invoice not synced | Create / sync invoice |
| F. No per-order fees | payout file has totals only | Upload the per-order statement |
| G. Paid by hand | `paid_external` | Leave the invoice; book fee + FX only if the founder says the fee was never booked (`bookFeesOnExternallyPaid`) |
| H. Part-paid outside | review "already has … paid" | Finish by hand |
| I. Paid, fee missing | payment `already_done`, fee `would_post` | Safe, but still ask |

Why the fee + net = gross check matters: on Stripe, some charges carry a gross that
does not equal fee + net (multi-order or previously refunded charges). Forcing those
books a wrong "currency" line. Hold them.

## Refunds

A refund line on a payout books as: the credit note for the refunded amount (reuse an
open one, else create one VAT-inclusive at the invoice's tax), refunded in full from the
clearing account, plus the gateway charge:

| Charge | Book as | VAT |
|---|---|---|
| Gateway kept an extra charge (net < gross) | Expense to Payment Gateway Charges, paid from clearing | AED payout: inclusive 5% (Tamara: its VAT column). KSA/SAR payout: none, all cost |
| Gateway handed its fee back (net > gross) | Journal, same reference as the refund: Dr clearing / Cr Payment Gateway Charges / Cr Input VAT | VAT only if the order's original fee carried VAT |

Per refund line the clearing movement (−refund + charge) must equal the payout file's
net for that line. Details, the credit-note-leftover analysis and repairs:
`references/refunds-and-credit-notes.md`.

**Credit note left open after the refund** is common and is a decision, not an error.
Use the Stripe refunds API (`scripts/stripe-refunds.mjs`) to prove what the customer got
back in their own currency. On Sept 2026 data customers received about 3.2% less than
the note in SAR, and only about 0.2% was exchange rate. Offer: reduce the note to the
refunded amount, or keep the balance as store credit. Only a pure FX leftover (e.g.
Tabby SAR, statement gross = note exactly) goes to Exchange Gain or Loss.

## Returns, exchanges, cancellations report

Two sources, always side by side: the month's dispatch sheet (id from
`payment_sheet_months`, tabs `SMSA Orders` = international, ` Local orders` = local,
OnTrack in Delivery By) and Zoho (credit notes: total 0 = exchange stock return,
balance > 0 = refund pending; credit-note refunds; void invoices). Periods: today,
yesterday, month to date, split local / international, with an OnTrack COD block.
Prove the sheet parse against its own ` Summary ` tab (order counts, Cancelled Int /
LOCAL) before reporting. Columns, keyword rules and known gaps:
`references/returns-exchanges-dispatch.md`.

## Pitfalls that cost real money

- **Never trust local "booked" flags.** `refund_postings` showed SA3952 booked while its
  Zoho credit note had no refund. The manual "Close credit note" route stamps
  `zoho_charge_id = CLOSED:<cn>` without posting the returned-fee journal (804900,
  804899, 804717 left TABBY AED short 186.72). Read the document in Zoho.
- **`PENDING:` markers** mean a write may have reached Zoho unanswered. Rerun that one
  record through `publishSettlements` in dry run: `found_existing` relinks the real id
  with no new Zoho write (SA4021).
- **Bank-rate SAR payouts** (`payout.fxSource === "bank"`): shares are already at the
  bank's rate; rescaling again double-counts the wire charge. Fixed in `refundLinesOf`
  (2026-09-25); make sure any new code passes `sharesAtBankRate`.
- **Unconfirmed credits** never post (the publish and refund routes refuse them too).
- **Shopify Payments** clearing account is named `SHOPIFY`; `suggestPostingAccounts`
  finds no match by provider name, so pass it explicitly.
- **WA store Stripe orders** are invoiced in AED but charged in SAR/KWD/QAR; small gaps
  are Stripe's conversion. The order row says AED, the Stripe charge says otherwise.
- **Zoho quota**: ~5k/day org-wide (throttle budget shown by `zohoQuotaStatus()`). A full
  month dry run ≈ 1,000 calls; check before starting.
- **Zoho sales returns** endpoint returns 401 for this token; credit notes cover returns.
- **Scheduler code** is captured at server boot: editing `lib/finance/*` does not change
  a running server's background jobs until restart.

## Output conventions

- Files the founder or accountants use go to `~/Downloads/` as `.xlsx` (exceljs), one
  sheet per group, a plain Summary sheet first, a "Not done and why" sheet last.
- Every posted document is searchable by reference: `<bank ref>/<order>/PAY|FEE|FX|RFN|RFD|RFC`.
- Report after posting: what was done (count, AED), how to verify, what was held and
  why, the numbered decisions still open. No figure in the report that was not read back
  from Zoho.

## Files

| Need | File |
|---|---|
| Booking math, VAT split, invoice picking | `lib/finance/settlement-posting.ts` |
| Order booking sequence, force allocations, idempotency | `lib/finance/publish-settlements.ts` |
| Refund booking, charge journals | `lib/finance/publish-refunds.ts` |
| Bank → payout → orders | `lib/reconciliation/engine.ts` (`computeReconLines`; `runReconciliation` also persists) |
| Zoho reads/writes | `lib/integrations/zoho.ts`, `zoho-settlement-posting.ts`, `zoho-throttle.ts` |
| Dispatch sheet | `lib/integrations/google-sheets.ts`, `dispatch-sheet.ts`, `payment_sheet_months` |
| Founder routes | `/api/settlements/publish`, `/refunds`, `/refunds/close`, `/refunds/restructure`, `/[id]/force` |
| Tests | `tests/finance/settlement-posting.test.ts`, `refund-charges.test.ts`, `refund-lines.test.ts` |

Scripts in `scripts/` here are templates: copy into the repo's `scripts/` as `_name.ts`
(they use the `@/` alias), run with `npx tsx --env-file=.env.local`, delete after.
