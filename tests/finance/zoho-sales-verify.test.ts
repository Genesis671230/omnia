import { test } from "node:test";
import assert from "node:assert/strict";
import { orderNumberOf, verifyMonthSales, type VerifyOrder, type ZohoDoc } from "../../lib/finance/zoho-sales-verify";

const doc = (kind: ZohoDoc["kind"], number: string, total: number, extra: Partial<ZohoDoc> = {}): ZohoDoc => ({
  kind, org: "env", id: number, number, reference: "", customer: "", date: "2026-09-10", status: kind === "invoice" ? "paid" : "closed", total, balance: 0, ...extra,
});
const order = (n: string, gross: number, extra: Partial<VerifyOrder> = {}): VerifyOrder => ({
  order_number: n, order_date: "2026-09-10T08:00:00", gross_aed: gross, financial_status: "paid", store_id: "MAIN", gateway: "Stripe", ...extra,
});

test("the order number comes from the reference, the SO number, or the customer name", () => {
  assert.equal(orderNumberOf(doc("invoice", "MNS-054059", 0, { reference: "OS3992" })), "OS3992");
  assert.equal(orderNumberOf(doc("creditnote", "OCN-03688", 0, { reference: "FT262740F518/OS3712/RFN" })), "OS3712");
  assert.equal(orderNumberOf(doc("invoice", "INV-005217", 0, { customer: "OS4029 Sareea Mohamed" })), "OS4029");
  assert.equal(orderNumberOf(doc("salesorder", "WA55936", 0)), "WA55936");
  assert.equal(orderNumberOf(doc("creditnote", "CN-1", 0, { customer: "House of Omnia" })), "");
});

test("sales vs Zoho: missing, mismatched, Zoho-only, cancelled-but-invoiced; refunds vs exchanges", () => {
  const v = verifyMonthSales({
    fromDay: "2026-09-01", toDay: "2026-09-30",
    orders: [
      order("OS3701", 1000),
      order("OS3702", 500),                                            // no Zoho document → flagged
      order("OS3703", 800),                                            // Zoho says 700 → mismatch
      order("OS3704", 300, { financial_status: "cancelled" }),         // cancelled, but invoiced
      order("WA3705", 400, { store_id: "WA", gateway: "Tabby", financial_status: "pending" }), // SO only → fine
    ],
    docs: [
      doc("invoice", "INV-1", 1000, { reference: "OS3701" }),
      doc("invoice", "INV-3", 700, { reference: "OS3703" }),
      doc("invoice", "INV-4", 300, { reference: "OS3704" }),
      doc("invoice", "INV-9", 250, { reference: "OS3709" }),           // no such order
      doc("invoice", "INV-D", 90, { reference: "OS3701", status: "draft" }),
      doc("salesorder", "WA3705", 400),
      doc("creditnote", "OCN-1", 587.64, { reference: "FT1/OS3701/RFN" }),
      doc("creditnote", "OCN-2", 0, { customer: "OS3703 Myr Taj" }),   // exchange
      doc("invoice", "INV-V", 999, { reference: "OS3702", status: "void" }),
    ],
  });
  assert.equal(v.ours.orders, 4);
  assert.equal(v.ours.salesAed, 2700);
  assert.equal(v.zoho.invoices, 4);
  assert.equal(v.zoho.invoicedAed, 2250);
  assert.equal(v.refunds.count, 1);
  assert.equal(v.refunds.totalAed, 587.64);
  assert.equal(v.exchanges.count, 1);
  assert.equal(v.exchanges.list[0].order, "OS3703");
  assert.equal(v.cancellations.count, 1);
  const types = v.flags.map((f) => `${f.type}:${"order" in f ? f.order : ""}`).sort();
  assert.deepEqual(types, ["amount_mismatch:OS3703", "cancelled_but_invoiced:OS3704", "draft_invoice:OS3701", "not_in_zoho:OS3702", "zoho_without_order:OS3709"]);
});

test("an exchanged order invoiced twice is told apart from a duplicate invoice", () => {
  const v = verifyMonthSales({
    fromDay: "2026-09-01", toDay: "2026-09-30",
    orders: [order("OS3760", 1258.5), order("OS3790", 817.5)],
    docs: [
      doc("invoice", "MNS-053658", 1258.5, { reference: "OS3760" }),
      doc("invoice", "MNS-053900", 1148.18, { reference: "OS3760" }),
      doc("creditnote", "OCN-03650", 0, { customer: "OS3760 Myr Taj" }),
      doc("invoice", "MNS-053700", 817.5, { reference: "OS3790" }),
      doc("invoice", "MNS-053889", 1072.58, { reference: "OS3790" }),
    ],
  });
  const reasons = Object.fromEntries(v.flags.filter((f) => f.type === "amount_mismatch").map((f) => [f.order, (f as { reason: string }).reason]));
  assert.deepEqual(reasons, { OS3760: "exchange_reinvoiced", OS3790: "duplicate_invoice" });
});
