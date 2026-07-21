import { supabase } from "@/lib/supabase";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { aggregateCustomers } from "@/lib/customers/aggregate";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";
const CHUNK = 500;

export const CustomersRepository = {
  // Full rebuild from the current order book — not an incremental update.
  // A customer's aggregate depends on ALL of their orders across ALL
  // stores, so a partial update touching only "orders changed in this
  // batch" would need to re-fetch that customer's full history anyway; at
  // that point a full rebuild is simpler and no more expensive in
  // aggregate. Cheap at this row count (same judgment call the live
  // /api/customers route already makes doing this in-memory per request).
  async rebuildAll(): Promise<{ customerCount: number; unidentifiedCount: number }> {
    const orders = await OrdersRepository.listAll();
    const { customers, unidentifiedCount } = aggregateCustomers(orders);

    const rows = customers.map((c) => ({
      id: c.id,
      tenant_id: TENANT,
      matched_by: c.matchedBy,
      name: c.name,
      email: c.email,
      phone: c.phone,
      stores: c.stores,
      total_orders: c.totalOrders,
      total_spend_aed: c.totalSpendAed,
      aov_aed: c.aov,
      first_order_date: c.firstOrderDate,
      last_order_date: c.lastOrderDate,
      expected_ltv_next_year: c.expectedLtvNextYear,
      updated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from("customers").upsert(rows.slice(i, i + CHUNK), { onConflict: "id" });
      if (error) throw new Error(`customers upsert failed: ${error.message}`);
    }

    return { customerCount: customers.length, unidentifiedCount };
  },
};
