# Refunds and credit notes

## Line math (`planRefundLine`, `refundLinesOf`)

- `refundAmount = |grossShare|` when gross < 0, else 0 (charge-only line).
- `charge = netShare − min(grossShare, 0)`: + fee handed back, − extra charge kept.
- Scale: 1 for AED; for cross-border, bank credit ÷ payout net, **unless** the payout's
  shares are already at the bank's quoted rate (`fxSource === "bank"`). Then 1.
  Getting this wrong understated every SAR refund by the wire-charge ratio (~0.4%).

## Documents per line

1. Pick the invoice: paid, big enough (`pickInvoiceForRefund`). Unpaid invoice → book the
   original payment first (`E_REFUND_UNPAID_ORIGINAL`).
2. Credit note: ours by reference → an open one whose balance equals the refund → the
   smallest open one that covers it → create one (single VAT-inclusive line, invoice's
   tax and sales account, linked to the invoice, no item, so no restock).
3. Refund the credit note from the clearing account, reference `<bank>/<order>/RFD`.
4. Charge:
   - kept (−): expense, `<bank>/<order>/RFC`, VAT-inclusive with Standard Rate only on AED
     payouts. KSA Tamara lines carry 15% KSA VAT in the file; it is not UAE input VAT, so
     the whole amount is cost.
   - handed back (+): journal under the **same** reference as the refund, Dr clearing /
     Cr Payment Gateway Charges (ex-VAT) / Cr Input VAT. VAT share = original fee's
     `fee_vat_aed / fee_aed` on the settlement record; no record + AED payout → ÷105×5;
     else none.

Invariant per line: −refund + charge = payout file net share. Per payout, with all
orders and refunds booked and the wire journal, clearing = bank credit.

## Leftover on a reused credit note

Common: the note was raised for the item's full value; the gateway refunded less.
Decompose before proposing anything:

- **Currency part** = refund in the customer's currency ÷ the order's own rate
  (charge ccy ÷ invoice AED) − AED the gateway actually took.
- **Over-credit part** = note balance − refund at the order's rate.

Sources for the customer-currency refund: Stripe refunds API (`stripe-refunds.mjs`,
fields: refund amount/currency, charge amount/currency, balance transaction exchange
rate); Tabby/Tamara statements' `grossOriginal` on `payout_transactions`.

Proposals: currency-only (Tabby SAR WA55483: statement gross = note exactly) → close
leftover from Exchange Gain or Loss. Over-credit → founder decides: reduce the credit
note to the refunded amount, or keep as store credit. Large partial (801903, 802637,
WA55516) → ask what was actually returned.

## Verify, don't trust

- Read each credit note live (`getCreditNoteLive`): balance, refunds and their
  references and from-accounts.
- `refund_postings.zoho_charge_id` values `CLOSED:<cn>` (manual close route) mean the
  returned fee was folded into the credit note close, **not** journaled. Search
  journals by `<bank>/<order>/RFD`; if none, the clearing account is short by the fee.
- Old "net" bookings (refund = net only, fee still open on the note): add the missing
  refund part + returned-fee journal, or run `/api/settlements/refunds/restructure`.

## Repairs seen in Sept 2026 (for pattern matching)

| Order | Problem | Fix |
|---|---|---|
| 804900, 804899, 804717 | CLOSED marker, no returned-fee journal | Journal Dr TABBY AED / Cr PGC / Cr Input VAT (3.51 / 1.42 / 3.97) |
| SA3952 | Marked booked, no refund on OCN-03627 | Refund 798.14 from SHOPIFY |
| 803739 | Old net booking 829.84 | +44.89 refund, journal 39.36 (KSA, no VAT) |
| 804522 | Booked 1.82 short (double-scaled) | +1.82 refund from TAMARA KSA |
