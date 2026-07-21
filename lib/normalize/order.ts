// Normalizers: raw store payloads → rows for the existing Supabase `orders`
// table. financial_status is the store's CLAIM — settlement only comes from
// the reconciler stamping payout_id / payout_status.

import { toAed } from "@/lib/fx";
import { classifyOrderGateway } from "@/lib/gateways";
import { customerIdentityKey } from "@/lib/customer-identity";
import type { ShopifyRawOrder, ShopifyStoreCode } from "@/lib/integrations/shopify";
import { telrRefsFromMeta, type WooRawOrder } from "@/lib/integrations/woo";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type OrderRow = {
  id: string;
  tenant_id: string;
  uid: string;
  store_id: string;
  order_id: string;
  order_number: string;
  order_date: string;
  currency: string;
  gross_original: number;
  gross_aed: number;
  subtotal_aed: number;
  shipping_aed: number;
  tax_aed: number;
  discount_aed: number;
  gateway: string;
  gateway_raw: string;
  telr_cartid: string;
  telr_tranref: string;
  financial_status: string;
  fulfillment_status: string;
  city: string;
  country: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_id: string | null;
  source: string;
  payout_status: string;
  updated_at: string;
  line_items: OrderLineItem[];
  courier: string;
  tracking_number: string;
  tracking_url: string;
};

// One vocabulary for both platforms; totals already in AED.
export type OrderLineItem = {
  title: string;
  sku: string;
  qty: number;
  total_aed: number;
  image_url: string;
  stock: number | null; // live variant stock at sync time (Shopify only)
};

const money = (set: { shopMoney: { amount: string } } | null | undefined) =>
  set ? parseFloat(set.shopMoney.amount) : 0;

export function normalizeShopifyOrder(raw: ShopifyRawOrder, store: ShopifyStoreCode): OrderRow {
  const sourceId = raw.id.split("/").pop() || raw.id;
  const uid = `${store}_${sourceId}`;
  const currency = raw.currentTotalPriceSet.shopMoney.currencyCode;
  const gross = money(raw.currentTotalPriceSet);
  const gatewayRaw = raw.paymentGatewayNames.join(",");
  const tracking = raw.fulfillments?.flatMap((f) => f.trackingInfo ?? []).find((t) => t.company || t.number);
  const phone =
    raw.shippingAddress?.phone ||
    raw.billingAddress?.phone ||
    raw.customer?.phone ||
    raw.customer?.defaultAddress?.phone ||
    "";

  return {
    id: uid,
    tenant_id: TENANT,
    uid,
    store_id: store,
    order_id: sourceId,
    order_number: raw.name.replace(/^#/, ""),
    order_date: raw.createdAt,
    currency,
    gross_original: gross,
    gross_aed: toAed(gross, currency),
    subtotal_aed: toAed(money(raw.currentSubtotalPriceSet), currency),
    shipping_aed: toAed(money(raw.totalShippingPriceSet), currency),
    tax_aed: toAed(money(raw.currentTotalTaxSet), currency),
    discount_aed: toAed(money(raw.currentTotalDiscountsSet), currency),
    gateway: classifyOrderGateway(gatewayRaw),
    gateway_raw: gatewayRaw,
    telr_cartid: "",
    telr_tranref: "",
    financial_status: (raw.displayFinancialStatus || "").toLowerCase(),
    fulfillment_status: (raw.displayFulfillmentStatus || "").toLowerCase(),
    city: raw.shippingAddress?.city || "",
    country: raw.shippingAddress?.countryCodeV2 || "",
    customer_name: raw.customer?.displayName || "",
    customer_email: raw.email || "",
    // shippingAddress.phone (entered at checkout) is filled far more often
    // than customer.phone (Shopify's marketing-profile phone, opt-in only).
    // Prefer it, then billing, then the profile phone, then the customer's
    // default saved address — orders frequently carry a number ONLY there.
    customer_phone: phone,
    customer_id: customerIdentityKey(raw.email, phone)?.id ?? null,
    source: "shopify",
    payout_status: "awaiting",
    updated_at: new Date().toISOString(),
    line_items: (raw.lineItems?.nodes ?? []).map((li) => ({
      title: li.title,
      sku: li.sku || "",
      qty: li.quantity,
      total_aed: toAed(li.discountedTotalSet ? parseFloat(li.discountedTotalSet.shopMoney.amount) : 0, currency),
      image_url: li.image?.url || "",
      stock: li.variant?.inventoryQuantity ?? null,
    })),
    courier: tracking?.company || "",
    tracking_number: tracking?.number || "",
    tracking_url: tracking?.url || "",
  };
}

export function normalizeWooOrder(raw: WooRawOrder): OrderRow {
  const uid = `WOO_${raw.id}`;
  const gross = parseFloat(raw.total);
  const { cartId, tranref } = telrRefsFromMeta(raw.meta_data);

  return {
    id: uid,
    tenant_id: TENANT,
    uid,
    store_id: "WOO",
    order_id: String(raw.id),
    order_number: raw.number,
    order_date: raw.date_created,
    currency: raw.currency,
    gross_original: gross,
    gross_aed: toAed(gross, raw.currency),
    subtotal_aed: toAed(
      gross - parseFloat(raw.shipping_total || "0") - parseFloat(raw.total_tax || "0"),
      raw.currency,
    ),
    shipping_aed: toAed(parseFloat(raw.shipping_total || "0"), raw.currency),
    tax_aed: toAed(parseFloat(raw.total_tax || "0"), raw.currency),
    discount_aed: toAed(parseFloat(raw.discount_total || "0"), raw.currency),
    gateway: classifyOrderGateway(`${raw.payment_method} ${raw.payment_method_title}`),
    gateway_raw: raw.payment_method_title || raw.payment_method,
    telr_cartid: cartId || (raw.payment_method?.toLowerCase().includes("telr") ? `${raw.id}_` : ""),
    telr_tranref: tranref,
    financial_status: raw.status === "processing" || raw.status === "completed" ? "paid" : raw.status,
    fulfillment_status: raw.status,
    city: raw.billing?.city || "",
    country: raw.billing?.country || "",
    customer_name: `${raw.billing?.first_name || ""} ${raw.billing?.last_name || ""}`.trim(),
    customer_email: raw.billing?.email || "",
    customer_phone: raw.billing?.phone || "",
    customer_id: customerIdentityKey(raw.billing?.email, raw.billing?.phone)?.id ?? null,
    source: "woocommerce",
    payout_status: "awaiting",
    updated_at: new Date().toISOString(),
    line_items: (raw.line_items ?? []).map((li) => ({
      title: li.name,
      sku: li.sku || "",
      qty: li.quantity,
      total_aed: toAed(parseFloat(li.total || "0"), raw.currency),
      image_url: li.image?.src || "",
      stock: null, // Woo order payload doesn't carry live stock; needs a product lookup
    })),
    courier: raw.shipping_lines?.[0]?.method_title || "",
    tracking_number: "",
    tracking_url: "",
  };
}
