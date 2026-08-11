// Deliberately scoped to TODAY (Dubai calendar day) only — this is a
// catch-up for orders that should have been pushed automatically but were
// missed (the scheduler outage, the sheet only just being connected), not a
// retroactive dump of historical orders the team already handled manually
// weeks/months ago into a live operational sheet.
import "dotenv/config";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { sendNewOrderAlerts } from "@/lib/alerts/order-alerts";
import { dubaiDayBoundsUtc } from "@/lib/reports/cfo-digest";
import type { OrderRow } from "@/lib/normalize/order";

async function main() {
  const todayDubai = new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(0, 10);
  const { fromUtc } = dubaiDayBoundsUtc(todayDubai);
  const raw = await OrdersRepository.listInWindow({ from: fromUtc });
  console.log(`${raw.length} orders today (${todayDubai}, Dubai)`);

  const rows: OrderRow[] = raw
    .filter((r) => r.order_date != null)
    .map((r) => ({
      id: r.uid, tenant_id: "omnia", uid: r.uid, store_id: r.store_id, order_id: r.uid,
      order_number: r.order_number, order_date: r.order_date!,
      currency: r.currency, gross_original: Number(r.gross_original), gross_aed: Number(r.gross_aed),
      subtotal_aed: 0, shipping_aed: 0, tax_aed: 0, discount_aed: 0,
      gateway: r.gateway, gateway_raw: r.gateway_raw,
      telr_cartid: r.telr_cartid, telr_tranref: r.telr_tranref,
      shipping_address1: r.shipping_address1, shipping_address2: r.shipping_address2,
      shipping_state: r.shipping_state, shipping_postcode: r.shipping_postcode, shipping_company: r.shipping_company,
      billing_address1: r.billing_address1, billing_address2: r.billing_address2,
      billing_state: r.billing_state, billing_postcode: r.billing_postcode, billing_company: r.billing_company,
      financial_status: r.financial_status, fulfillment_status: r.fulfillment_status,
      city: r.city, country: r.country,
      customer_name: r.customer_name, customer_email: r.customer_email, customer_phone: r.customer_phone,
      customer_id: r.customer_id,
      source: r.store_id, payout_status: r.payout_status, updated_at: new Date().toISOString(),
      line_items: (r.line_items ?? []).map((li) => ({
        title: li.title, sku: li.sku, qty: li.qty, total_aed: li.total_aed,
        image_url: li.image_url ?? "", stock: li.stock ?? null,
      })),
      courier: r.courier, tracking_number: r.tracking_number, tracking_url: r.tracking_url,
    }));

  console.log(`processing ${rows.length} orders — will skip anything already in the sheet or already Telegram-alerted with no sheet gap`);
  await sendNewOrderAlerts(rows);
  console.log("done");
}

main();
