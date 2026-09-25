# Returns, exchanges, cancellations: dispatch sheet vs Zoho

## Getting the data

```
MONTH_KEY=2026-09 npx tsx --env-file=.env.local scripts/_dispatch-dump.ts $W/month-sheet.json
FROM=2026-09-01 npx tsx --env-file=.env.local scripts/_zoho-returns.ts $W/zoho-returns.json
MONTH=09 MON=Sep YEAR=2026 TODAY=24 node scripts/returns-classify.cjs $W
MONTH=09 YEAR=2026 TODAY=24 node scripts/returns-report.cjs $W ~/Downloads/Exchanges_Cancellations_Returns_<Mon>.xlsx
```

The sheet id comes from `payment_sheet_months` (`month_key` → `spreadsheet_id`). The env
`GOOGLE_SHEETS_SPREADSHEET_ID` is an older sheet the app appends new orders to; it is not
the ops month.

## Sheet layout (Sept 2026; headers drift, find them by text)

` Local orders` (leading space): Date, Order #, Voucher #, **Type of Sale** (Paid, COD,
Exchange, Exchange/COD, Exchange/Paid), Total, Party (gateway), Customer, Comments,
Payment Status, **Delivery By** (On Track / Ontrack / OT, Muneeb = own driver, blank),
Actual Payment Status ("Payment Received", "Cancelled"), Payment Received on (includes the
remittance amount), **OT Invoice#** (OnTrack COD voucher), Total Amount, Fee Deducted,
Amount After Deduction, **Cancelled / Refunded Amount**, sales person, Shipment Status.

`SMSA Orders` (international): Date, Order #, Total Amt, Currency, In AED, Party,
**Part** (Paid, Exchange, Exchange/Paid), Exc Rate, Status / Comments, Payment
Authorised, Actual Payment Status, Payment Received Date, …, **Cancelled / Refunded
Amount**, Fee%, sales person, **Refund Date**.

` Summary `: Total Orders (Inter / Local), Cancelled Int / LOCAL, Overall Sales. Your
parse must reproduce these before you report anything.

Dates: `01.Sep.2026`, `06. Sep.2026`, `21 Sep.2026`, `2026-09-24 21:38` (app-appended).

## Classification (comments + type columns)

- Exchange: `exchang` anywhere (type/part or comments). Amount = top-up collected.
- Cancelled: `cancel` / `Canceled BD` (before dispatch). Amount = Cancelled/Refunded column.
- Returned & refunded: `return` and `refund`. Amount = Cancelled/Refunded column.
- Refund only: `refund` without `return` (partial, extra payment); amount from comment
  text (`Refund - 211.50`, `109.30 SAR`).
- Rows can carry two kinds (an exchange with a refund).

## Zoho side

- Credit note total 0 → exchange (stock back, no money).
- Total > 0, balance > 0 → return raised, refund pending (or store credit / to apply).
- Balance 0 → refunded or applied.
- Credit note refunds (filter by date locally). Void invoices (usually none; cancels
  live in the sheet).
- Sales returns endpoint: 401 for this token.

## OnTrack block (local)

Orders by Delivery By; for OnTrack: prepaid vs COD vs exchanges, cancelled, returned;
COD to collect (sale + exchange 30 AED fees, excluding cancelled) split into received
(Actual Payment Status "received") and not yet received; remittances grouped by OT
Invoice# with the received-on text. COD vouchers themselves are parsed from the PDF by
`lib/parsers/ontrack-voucher.ts` when uploaded.

## Mismatches to always list

- Sheet exchanges with no zero-value credit note (Sept: 63 vs 21) → stock not returned in Zoho.
- Sheet "returned and refunded" / "refund" with no credit note.
- Valued credit notes not marked in the sheet.
- Open return credit notes with no gateway refund in any payout (pending refunds or exchanges to apply).
