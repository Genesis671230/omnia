// Pure field-derivation for the two invoice templates. Imported by BOTH the
// invoice modal (client) and the invoice route (server), so it must stay free
// of pdf-lib and any server-only dependency — only the drawing modules
// (lib/invoice.ts, lib/invoice-intl.ts) pull in pdf-lib.

import type { InvoiceFields } from "@/lib/invoice";
import type { IntlInvoiceFields } from "@/lib/invoice-intl";
import { defaultCourier } from "@/lib/courier";


export type InvoiceTemplate = "ontrack" | "intl";

// Same AE/non-AE split as the courier: the UAE ships Ontrack (the simple
// two-up label), everywhere else ships SMSA and needs the itemized customs
// invoice. Single source of truth = defaultCourier.
export function selectInvoiceTemplate(country: string): InvoiceTemplate {
  return defaultCourier(country) === "Ontrack" ? "ontrack" : "intl";
}

export type InvStatus =
  | "oversell_risk"    // store selling, Zoho empty — refund risk
  | "unlisted"         // Zoho has stock, listed on ZERO stores — dead cash
  | "stock_mismatch"   // listed, but store qty ≠ Zoho beyond tolerance
  | "out"              // Zoho at 0, not on stores either
  | "critical"         // Zoho 1–3
  | "low"              // Zoho 4–10
  | "ok";

const MISMATCH_ABS = 2;        // ±2 units of drift tolerated
const MISMATCH_PCT = 0.10;     // OR 10% of Zoho, whichever is looser
type StoreQty = { storeId: string; quantity: number | null; listed: boolean;tracking: boolean; };
export function computeStatus(item: {
  zohoStock: number;
  stores: StoreQty[];
}): InvStatus {
  const { zohoStock, stores } = item;
  const listed = stores.filter(s => s.listed);
  const anyLiveQty = listed.some(s => (s.quantity ?? 0) > 0);

  // 1. Store is selling something Zoho says we don't have → highest priority
  if (zohoStock <= 0 && anyLiveQty) return "oversell_risk";

  // 2. Zoho has stock but literally no store carries it → sales gap
  if (zohoStock > 0 && listed.length === 0) return "unlisted";

  // 3. Zoho at zero, no store carries stock either
  if (zohoStock <= 0) return "out";

  // 4. Listed, but store qty drifts from Zoho beyond tolerance
  const tol = Math.max(MISMATCH_ABS, Math.floor(zohoStock * MISMATCH_PCT));
  const maxDiff = Math.max(
    ...listed.map(s => Math.abs(zohoStock - (s.quantity ?? 0)))
  );
  if (maxDiff > tol) return "stock_mismatch";

  if (zohoStock <= 3)  return "critical";
  if (zohoStock <= 10) return "low";
  return "ok";
}
// "Paid" for invoice purposes = money already collected online. COD is money
// still owed at delivery, so a COD order is never auto-marked paid. A store
// may also send an explicit unpaid/pending/refunded financial_status.
export function isPaidOrder(o: { gateway: string; financial_status?: string }): boolean {
  if ((o.gateway || "").toUpperCase() === "COD") return false;
  const fs = (o.financial_status || "").toLowerCase();
  if (["pending", "unpaid", "voided", "refunded", "partially_refunded"].includes(fs)) return false;
  return true;
}

// Flat shipping shown on a paid Ontrack invoice (founder's rule).
export const PAID_SHIPPING_AED = 30;

// Minimal order shape both callers can satisfy (the route's getByUid row and
// the modal's order prop are supersets of this).
export type OrderForInvoice = {
  order_number: string;
  order_date?: string | null;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  city?: string;
  country?: string;
  gateway: string;
  financial_status?: string;
  gross_aed: number;
  currency?: string;
  courier?: string;
};

export type IntlLineItem = { title?: string; qty?: number; total_aed?: number };

function displayDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB");
}

// Ontrack (UAE) prefill. When the order is already paid online the founder's
// invoice shows REMARKS=PAID, a flat AED 30 shipping, the order value, and the
// literal word "PAID" in the TOTAL cell (totalLabel) instead of a number.
export function ontrackPrefill(o: OrderForInvoice): InvoiceFields {
  const paid = isPaidOrder(o);
  const orderValue = Number(o.gross_aed || 0);
  const shipping = paid ? PAID_SHIPPING_AED : 0;
  const isCod = (o.gateway || "").toUpperCase() === "COD";
  return {
    orderNumber: o.order_number,
    invoiceNo: o.order_number,
    customerId: "",
    date: displayDate(o.order_date),
    customerName: o.customer_name || "",
    address1: "",
    address2: [o.city, o.country].filter(Boolean).join(", "),
    mobile: o.customer_phone || "",
    additionalNotes: "",
    remarks: paid ? "PAID" : "",
    orderValue,
    shipping,
    total: orderValue + shipping,
    totalLabel: paid ? "PAID" : undefined,
    paid: isCod ? "COD" : paid ? "Yes" : "No",
    courier: o.courier || (selectInvoiceTemplate(o.country || "") === "ontrack" ? "Ontrack" : "SMSA"),
    currency: o.currency || "AED",
  };
}

// International commercial-invoice prefill. Line items map to the ITEM # /
// DESCRIPTION / QTY / UNIT PRICE table; the item number is the order number
// (per spec), and each description gets the editable "Made in China" origin
// note appended (it is on the founder's real customs invoice). Amounts are AED.
export function intlPrefill(o: OrderForInvoice, lineItems: IntlLineItem[] = []): IntlInvoiceFields {
  const country = (o.country || "").trim().toUpperCase();
  const items = (lineItems || [])
    .filter((li) => li && (li.title || li.qty))
    .map((li) => {
      const qty = Number(li.qty) || 1;
      const total = Number(li.total_aed) || 0;
      return {
        itemNo: o.order_number,
        description: `${li.title || "Item"} — Made in China`,
        qty,
        unitPrice: qty ? total / qty : total,
      };
    });
  // Fall back to a single summary line so an invoice is always producible even
  // for an order whose line items didn't sync.
  const finalItems = items.length
    ? items
    : [{ itemNo: o.order_number, description: `Order #${o.order_number} — Made in China`, qty: 1, unitPrice: Number(o.gross_aed || 0) }];

  return {
    invoiceNo: o.order_number,
    customerId: `#${country}${o.order_number}`,
    date: displayDate(o.order_date),
    name: o.customer_name || "",
    address: [o.city, o.country].filter(Boolean).join(", "),
    tel: o.customer_phone || "",
    email: o.customer_email || "",
    shipDate: displayDate(o.order_date),
    terms: "-",
    items: finalItems,
    shipping: 0,
    currency: "AED",
    contactName: "Omnia Fouad",
    contactEmail: "support@omniastores.com",
    contactPhone: "+971565478227",
  };
}
