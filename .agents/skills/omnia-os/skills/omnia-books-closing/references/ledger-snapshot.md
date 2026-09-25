# Ledger snapshot for accountants

Built only from documents re-read from Zoho after posting (`readback.ts`), never from
the plan. Sheets:

1. **Summary**: counts and AED per group, fees and Input VAT, refunds, charges kept and
   handed back, "How to verify" bullets, pointer to Not done.
2. **Invoices closed**: group, bank date, gateway, bank ref, order, invoice, total,
   Zoho status now, balance now, payment #, amount, deposited to, fee expense total,
   VAT, fee ex-VAT, difference (+ loss / − gain), net per payout file, check column,
   FX journal #.
3. **Refunds booked**: credit note, refunded amount, from account, balance left, charge,
   charge document, VAT, clearing movement, payout file net.
4. **Ledger entries**: one row per Zoho line. Payment: Dr clearing / Cr Accounts
   Receivable. Fee expense: Dr Payment Gateway Charges (sub total) + Dr Input VAT / Cr
   clearing (total). Journals: their own lines. Credit note refund: Dr Accounts
   Receivable (credit note) / Cr from-account. Total debits = total credits.
5. **By account**: Dr, Cr, net per account, and each clearing account's Zoho
   `closing_balance` (GET `chartofaccounts/{id}`). Clearing stays high until the payout
   transfer (clearing → bank, `/api/integrations/zoho/post-payout`) is posted; say so.
6. **Not done and why**: every held item with the reason and the decision needed.

Checks that must hold before you send it:
- Every closed invoice: status `paid`, balance 0.
- Every order: payment − fee − difference − net received = 0.00.
- Every refund: −refund + charge = payout file net (±0.01).
- Ledger entries: Σ Dr = Σ Cr.
If any fails, say which and why in the Summary; do not send a clean-looking file over a
broken check.
