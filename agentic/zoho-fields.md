# Zoho field mappings

Fill these from the reconciliation build once confirmed. Placeholders now so the
worker imports cleanly.

## Inventory read
- Endpoint: Zoho Inventory `items` API
- Fields we care about: `item_id`, `sku`, `name`, `available_stock`,
  `warehouse_id`
- Low-stock threshold: 5 units (post ⚠️ below this)

## Invoice generation (on confirm)
- Zoho Books / Inventory `salesorders` → `invoices`
- Required: customer, line items (SKU + qty), amount, currency

## AWB generation
- Triggered per courier after invoice
- (Courier integration TBD — for Day 1 the worker just flags "generate AWB",
  the human does it until Zoho courier hooks are wired.)

## Inventory decrement
- On confirm, decrement `available_stock` by ordered qty per SKU.

Until real Zoho creds/fields are confirmed, the worker runs in REPORT-ONLY mode:
it posts what WOULD happen (invoice/AWB/decrement) without writing to Zoho.
