import { supabase } from "@/lib/supabase";
import type { OrderRow } from "@/lib/normalize/order";
import { keywordsForLocation } from "@/lib/orders-locations";
import { dropClobberRiskFields } from "@/lib/orders-clobber-guard";

const ORDER_COLUMNS =
  "uid, store_id, order_number, order_date, customer_name, customer_email, customer_phone, customer_id, city, country, currency, gross_original, gross_aed, gateway, gateway_raw, financial_status,shipping_address1, shipping_address2,shipping_state,shipping_postcode,shipping_company,billing_address1,billing_address2,billing_state,billing_postcode,billing_company, fulfillment_status, telr_cartid, telr_tranref, payout_id, payout_status, line_items, courier, tracking_number, tracking_url, fulfillment_stage, fulfillment_stage_updated_at, awb_number, shipped_at, label_url, ship_error";

  export type OrdersQuery = {
    days: number; page: number; limit: number;
    store: string | null; location: string | null; q: string;
    fulfillableFrom: "KSA" | "UAE" | null;
  };
export type OrderRowRaw = {
  uid: string; store_id: string; order_number: string; order_date: string | null;
  customer_name: string; customer_email: string; customer_phone: string; customer_id: string | null;
  shipping_address1:string;
  shipping_address2:string;
  shipping_state:string;
  shipping_postcode:string;
  shipping_company:string;
  billing_address1:string;
  billing_address2:string;
  billing_state:string;
  billing_postcode:string;
  billing_company:string;
  city: string; country: string;
  currency: string; gross_original: number; gross_aed: number; gateway: string;
  gateway_raw: string; financial_status: string; fulfillment_status: string;
  telr_cartid: string; telr_tranref: string; payout_id: string | null;
  payout_status: string;
  line_items: { title: string; sku: string; qty: number; total_aed: number; image_url?: string; stock?: number | null }[];
  courier: string; tracking_number: string; tracking_url: string;
  fulfillment_stage: string; fulfillment_stage_updated_at: string | null;
  awb_number: string; shipped_at: string | null; label_url: string; ship_error: string;
};


// Pure — turns URL search params into clamped, normalized query args. Kept
// separate from the DB call so it's unit-testable without Supabase.
export function parseOrdersQuery(params: URLSearchParams): OrdersQuery {
  // Note: parseInt(...) || <default> would be wrong here — 0 is a valid,
  // meaningful parsed value (days=0 means unbounded; limit clamps to 1) and
  // `0 || x` treats that legitimate 0 as falsy, silently replacing it with
  // the default. Guard on NaN specifically instead.
  const daysParsed = parseInt(params.get("days") ?? "30", 10);
  const days = Math.max(Number.isNaN(daysParsed) ? 30 : daysParsed, 0);
  const pageParsed = parseInt(params.get("page") ?? "1", 10);
  const page = Math.max(Number.isNaN(pageParsed) ? 1 : pageParsed, 1);
  const limitParsed = parseInt(params.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(Number.isNaN(limitParsed) ? 50 : limitParsed, 1), 200);
  const storeRaw = (params.get("store") || "All").trim();
  const store = storeRaw.toLowerCase() === "all" ? null : storeRaw;
  const locationRaw = (params.get("location") || "All locations").trim();
  const location = locationRaw.toLowerCase() === "all locations" ? null : locationRaw;
  const q = (params.get("q") || "").trim();
  const fulfillRaw = (params.get("fulfillableFrom") || "").trim().toUpperCase();
  const fulfillableFrom = fulfillRaw === "KSA" || fulfillRaw === "UAE" ? fulfillRaw : null;
  return { days, page, limit, store, location, q, fulfillableFrom };
}

// Supabase's fluent query builder returns an increasingly specific generic
// type after each chained call — typing that precisely here isn't worth it
// for internal glue code that just narrows a select; `any` in, `any` out,
// the caller re-asserts the final row shape it actually wants.
function applyOrdersFilters(
  query: any,
  opts: { from?: string; to?: string; store?: string | null; location?: string | null; q?: string;fulfillableFrom?: "KSA" | "UAE" | null; },
): any {
  let qy = query;
  if (opts.from) qy = qy.gte("order_date", opts.from);
  if (opts.to) qy = qy.lte("order_date", opts.to);
  if (opts.store) qy = qy.eq("store_id", opts.store);
  if (opts.fulfillableFrom === "KSA") qy = qy.eq("stock_coverage_ksa", true);
  if (opts.fulfillableFrom === "UAE") qy = qy.eq("stock_coverage_uae", true);
  if (opts.location) {
    const keywords = keywordsForLocation(opts.location);
    if (keywords && keywords.length > 0) {
      qy = qy.or(keywords.map((k) => `city.ilike.%${k}%`).join(","));
    }
  }
  if (opts.q) {
    const term = opts.q.replace(/[%,]/g, "");
    qy = qy.or(
      [
        `customer_name.ilike.%${term}%`,
        `order_number.ilike.%${term}%`,
        `city.ilike.%${term}%`,
        `country.ilike.%${term}%`,
        `customer_phone.ilike.%${term}%`,
      ].join(","),
    );
  }
  // Repeated .or()/.eq()/.gte() calls each add an independent, ANDed filter
  // clause in PostgREST — so the location OR-group and the search OR-group
  // combine as (location keyword match) AND (search column match), not one
  // flat OR across everything. That's the whole point of calling them
  // separately rather than merging into a single .or() string.
  return qy;
}

export const OrdersRepository = {
  // Upsert synced orders WITHOUT touching settlement fields — payout_id /
  // payout_status belong to the reconciler, and a re-sync must never
  // un-settle an order. Also protects courier/tracking_number/tracking_url
  // for orders already shipped through this app's own SMSA pipeline (see
  // dropClobberRiskFields above) — those fields belong to whoever shipped
  // the order, not to whatever the store's raw payload says today.
  async upsertMany(rows: OrderRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    const uids = rows.map((r) => r.uid);
    const shippedUids = new Set<string>();
    for (let i = 0; i < uids.length; i += 200) {
      const { data, error } = await supabase
        .from("orders")
        .select("uid")
        .in("uid", uids.slice(i, i + 200))
        .not("awb_number", "is", null)
        .neq("awb_number", "");
      if (error) throw new Error(`orders shipped-lookup failed: ${error.message}`);
      for (const r of data ?? []) shippedUids.add(r.uid as string);
    }

    const syncRows = rows.map((row) => dropClobberRiskFields(row, shippedUids));

    // orders.customer_id carries a FK to customers(id) — a customer row must
    // exist before any order referencing it can be written. These are cheap
    // placeholder values (only touches id/tenant_id/name/email/phone/
    // matched_by, never total_spend_aed etc.), immediately superseded by
    // CustomersRepository.rebuildAll() which runs after every sync/backfill
    // — this step only exists to satisfy the constraint at write time.
    const customerStubs = new Map<string, { id: string; tenant_id: string; name: string; email: string; phone: string; matched_by: string }>();
    for (const row of rows) {
      if (!row.customer_id) continue;
      customerStubs.set(row.customer_id, {
        id: row.customer_id,
        tenant_id: row.tenant_id,
        name: row.customer_name || row.customer_email || row.customer_phone || "Unknown",
        email: row.customer_email,
        phone: row.customer_phone,
        matched_by: row.customer_id.startsWith("email:") ? "email" : "phone",
      });
    }
    if (customerStubs.size > 0) {
      const { error: stubErr } = await supabase
        .from("customers")
        .upsert([...customerStubs.values()], { onConflict: "id" });
      if (stubErr) throw new Error(`customers stub upsert failed: ${stubErr.message}`);
    }

    const { error } = await supabase.from("orders").upsert(syncRows, { onConflict: "uid" });
    if (error) throw new Error(`orders upsert failed: ${error.message}`);

    const { error: fillErr } = await supabase
      .from("orders")
      .update({ payout_status: "awaiting" })
      .is("payout_status", null);
    if (fillErr) throw new Error(`payout_status backfill failed: ${fillErr.message}`);
    return rows.length;
  },

  // Supabase caps a select at 1000 rows — page through everything so the
  // ledger and the reconciler always see the full order book.
  async listAll() {
    const PAGE = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("orders")
        .select(ORDER_COLUMNS)
        .order("order_date", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`orders select failed: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    return rows as OrderRowRaw[];
  },

  // Minimal rows for matching payout refs → orders (Stripe API settlement
  // creation). Chunked: a payout batch can name hundreds of numbers and
  // .in() rides in the request URL.
  async getByOrderNumbers(numbers: string[]) {
    const out: { uid: string; order_number: string; store_id: string; customer_name: string; customer_email: string; order_date: string | null; gross_aed: number }[] = [];
    for (let i = 0; i < numbers.length; i += 200) {
      const { data, error } = await supabase
        .from("orders")
        .select("uid, order_number, store_id, customer_name, customer_email, order_date, gross_aed")
        .in("order_number", numbers.slice(i, i + 200));
      if (error) throw new Error(`orders by-number select failed: ${error.message}`);
      out.push(...(data ?? []));
    }
    return out;
  },

  // Full detail INCLUDING line_items for a set of order numbers, chunked the
  // same way as getByOrderNumbers. Backs the reconciliation proof table's
  // product expansion: the proof table knows order numbers, not uids, so a
  // per-row getByUid would need a lookup per click AND a round trip per order
  // — five for one Stripe payout. This fetches the whole credit at once.
  async getDetailsByOrderNumbers(numbers: string[]) {
    if (numbers.length === 0) return [];
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < numbers.length; i += 200) {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "uid, store_id, order_number, order_date, customer_name, customer_email, customer_phone, city, country, currency, gross_original, gross_aed, gateway, financial_status, fulfillment_status, fulfillment_stage, payout_id, payout_status, line_items, courier, tracking_number, tracking_url, awb_number, shipped_at",
        )
        .in("order_number", numbers.slice(i, i + 200));
      if (error) throw new Error(`orders detail by-number select failed: ${error.message}`);
      out.push(...(data ?? []));
    }
    return out;
  },

  async getByUid(uid: string) {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "uid, store_id, order_number, order_date, customer_name, customer_email, customer_phone, customer_id, city, country, currency, gross_original, gross_aed, gateway, gateway_raw, financial_status, fulfillment_status, payout_id, payout_status, line_items, courier, tracking_number, tracking_url, fulfillment_stage, fulfillment_stage_updated_at, awb_number, shipped_at, label_url, ship_error",
      )
      .eq("uid", uid)
      .single();
    if (error) return null;
    return data;
  },

  async markSettled(orderNumbers: string[], payoutId: string) {
    if (orderNumbers.length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update({ payout_id: payoutId, payout_status: "settled" })
      .in("order_number", orderNumbers);
    if (error) throw new Error(`orders settle stamp failed: ${error.message}`);
  },

  async setFulfillmentStage(uid: string, stage: string, updatedBy: string) {
    const { data, error } = await supabase
      .from("orders")
      .update({ fulfillment_stage: stage, fulfillment_stage_updated_at: new Date().toISOString(), fulfillment_stage_updated_by: updatedBy })
      .eq("uid", uid)
      .select("uid, fulfillment_stage, fulfillment_stage_updated_at")
      .single();
    if (error) throw new Error(`fulfillment stage update failed: ${error.message}`);
    return data;
  },

  async recordShipmentSuccess(uid: string, awb: string, courier: string, labelUrl: string) {
    const { data, error } = await supabase
      .from("orders")
      .update({
        awb_number: awb, courier, label_url: labelUrl, shipped_at: new Date().toISOString(), ship_error: "",
        fulfillment_stage: "shipped", fulfillment_stage_updated_at: new Date().toISOString(), fulfillment_stage_updated_by: "smsa-ship",
      })
      .eq("uid", uid)
      .select("uid, awb_number, courier, label_url, shipped_at, fulfillment_stage")
      .single();
    if (error) throw new Error(`shipment record failed: ${error.message}`);
    return data;
  },

  async recordShipmentError(uid: string, message: string) {
    const { error } = await supabase.from("orders").update({ ship_error: message }).eq("uid", uid);
    if (error) throw new Error(`ship_error write failed: ${error.message}`);
  },

  // UI-facing paginated + filtered query — the ledger's data source going
  // forward. listAll() stays untouched for the reconciler, which needs the
  // full book regardless of any UI filter.
  async listPage({ from, to, store, location, q, page, limit ,fulfillableFrom}: {
    from?: string; to?: string; store?: string | null; location?: string | null;
    q?: string; fulfillableFrom?: "KSA" | "UAE" | null;page: number; limit: number;
  }) {
    let query = supabase.from("orders").select(ORDER_COLUMNS, { count: "exact" });
    query = applyOrdersFilters(query, { from, to, store, location, q ,fulfillableFrom});
    const fromIdx = (page - 1) * limit;
    const { data, error, count } = await query
      .order("order_date", { ascending: false })
      .range(fromIdx, fromIdx + limit - 1);
    if (error) throw new Error(`orders page select failed: ${error.message}`);
    return { rows: (data ?? []) as OrderRowRaw[], total: count ?? 0 };
  },

  async getDispatchDetailsByUids(uids: string[]) {
    if (uids.length === 0) return [];
    const out: any[] = [];
    for (let i = 0; i < uids.length; i += 200) {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "uid, order_number, order_date, store_id, customer_name, customer_phone, city, country, currency, gross_aed, gateway, shipping_address1, shipping_address2, shipping_state, shipping_postcode, line_items",
        )
        .in("uid", uids.slice(i, i + 200));
      if (error) throw new Error(`dispatch detail select failed: ${error.message}`);
      out.push(...(data ?? []));
    }
    return out;
  },
  async getCoverageCounts(_opts: any = {}) {
    // Deliberately no filters — proves the .eq() alone works.
    const ksaRes = await supabase
      .from("orders")
      .select("uid", { count: "exact", head: true })
      .eq("stock_coverage_ksa", true);
    const uaeRes = await supabase
      .from("orders")
      .select("uid", { count: "exact", head: true })
      .eq("stock_coverage_uae", true);
  
    console.log("[coverage] ksa:", ksaRes.count, "err:", ksaRes.error?.message);
    console.log("[coverage] uae:", uaeRes.count, "err:", uaeRes.error?.message);
  
    return { ksa: ksaRes.count ?? 0, uae: uaeRes.count ?? 0, neither: 0 };
  },
  // Full rows within a date window (+ optional store), for dashboard
  // aggregation that needs every row in range, not one page of it. Still
  // pages past Supabase's 1000-row cap internally like listAll(), just only
  // within the window instead of across all history.
  async listInWindow({ from, store }: { from: string; store?: string | null }) {
    const PAGE = 1000;
    const rows: OrderRowRaw[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let query = supabase.from("orders").select(ORDER_COLUMNS);
      query = applyOrdersFilters(query, { from, store });
      const { data, error } = await query
        .order("order_date", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`orders window select failed: ${error.message}`);
      rows.push(...((data ?? []) as OrderRowRaw[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },

  // All-time counts — deliberately NOT date-windowed (matches the dashboard
  // route's existing behavior for these three numbers exactly). Count-only
  // queries (head: true) pull zero row data.
  async getOrderCounts({ store }: { store?: string | null } = {}) {
    const base = () => {
      let q = supabase.from("orders").select("uid", { count: "exact", head: true });
      if (store) q = q.eq("store_id", store);
      return q;
    };
    const cancelled = ["voided", "refunded", "cancelled"];
    const [settledRes, totalRes, codRes] = await Promise.all([
      base().eq("payout_status", "settled"),
      base(),
      (() => {
        let q = supabase.from("orders").select("gross_aed").eq("gateway", "COD").neq("payout_status", "settled");
        if (store) q = q.eq("store_id", store);
        return q.not("financial_status", "in", `(${cancelled.join(",")})`);
      })(),
    ]);
    if (settledRes.error) throw new Error(`settled count failed: ${settledRes.error.message}`);
    if (totalRes.error) throw new Error(`total count failed: ${totalRes.error.message}`);
    if (codRes.error) throw new Error(`cod pending select failed: ${codRes.error.message}`);
    const codRows = codRes.data ?? [];
    return {
      settledOrders: settledRes.count ?? 0,
      totalOrders: totalRes.count ?? 0,
      codPendingCount: codRows.length,
      codPendingAed: +codRows.reduce((s, r) => s + Number(r.gross_aed || 0), 0).toFixed(2),
    };
  },

  // Single most recent order (optionally store-filtered), full row data —
  // for the dashboard spotlight. No date window: a quiet week shouldn't make
  // the spotlight go blank.
  async getMostRecent({ store }: { store?: string | null } = {}) {
    let query = supabase.from("orders").select(ORDER_COLUMNS);
    if (store) query = query.eq("store_id", store);
    const { data, error } = await query
      .order("order_date", { ascending: false })
      .limit(1);
    if (error) throw new Error(`most-recent order select failed: ${error.message}`);
    return (data && data[0]) as OrderRowRaw | undefined ?? null;
  },
};
