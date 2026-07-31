// Canonical SKU form used everywhere: warehouse (Zoho), store snapshots,
// order line items, comparisons, future order-driven decrement webhooks.
// If any write path bypasses this, that path will invent phantom SKUs.
export function normalizeSku(raw: string | null | undefined): string {
    if (raw == null) return "";
    return String(raw).trim().toUpperCase();
  }
  
  export function isValidSku(sku: string): boolean {
    return sku.length > 0 && sku === normalizeSku(sku);
  }