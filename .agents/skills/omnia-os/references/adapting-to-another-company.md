# Running this for another company

Reusable as is:
- The chain bank → payout → order → invoice, with the bank as truth.
- One adapter (parser) per gateway into `payouts` + `payout_transactions` (gross, fee,
  VAT, net per order, original currency kept).
- Booking per order: payment for the invoice balance into a clearing account, fee
  expense (VAT per jurisdiction), difference journal; payout transfer empties clearing.
- Refund model: credit note = amount refunded, refunded from clearing, charge booked beside it.
- The approval rhythm: dry run, grouped plan, explicit yes per group, post, read back.
- Idempotency: reference per document, PENDING markers, lookup by reference before writing.

Change per company:
- Accounting system adapter (Zoho here; Xero/QuickBooks need their own posting module
  with the same functions: payment, expense, journal, credit note, credit note refund).
- Chart of accounts: clearing account names per gateway × currency, fee account, FX
  account, VAT tax and Input VAT account (`suggestPostingAccounts` matches by name).
- VAT rules per country (UAE 5% reclaimable; KSA VAT on KSA fees not reclaimable in UAE).
- Store platforms and how an order number appears in each gateway's file.
- Where operations track orders (a dispatch sheet here); map its columns by header text.
- Timezone for day bucketing (Dubai here).

Start by collecting one real payout file per gateway and one bank statement, write the
parsers with tests from those files, and prove two gateways end to end before
generalising (lesson repeated on this project).
