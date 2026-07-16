// The audit trail: one immutable row per order the moment its bank credit is
// confirmed SETTLED. This is what a founder points an accountant — or Zoho
// Books — at, independent of whatever the live orders/payouts tables say
// later. Written by the reconciliation engine, never by hand.

import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type SettlementRecord = {
  id: string;
  order_uid: string;
  order_number: string;
  store_id: string;
  customer_name: string;
  customer_email: string;
  order_date: string | null;
  settlement_date: string | null;
  gateway: string;
  currency: string;
  gross_aed: number;
  bank_line_id: string;
  payout_id: string | null;
  bank_reference: string;
  recorded_at: string;
};

export const SettlementsRepository = {
  async upsertMany(rows: Omit<SettlementRecord, "recorded_at">[]): Promise<void> {
    if (rows.length === 0) return;
    const withTenant = rows.map((r) => ({ ...r, tenant_id: TENANT }));
    const { error } = await supabase.from("settlement_records").upsert(withTenant, { onConflict: "id" });
    if (error) throw new Error(`settlement_records upsert failed: ${error.message}`);
  },

  async listByDate(date: string): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("settlement_date", date)
      .order("gateway", { ascending: true });
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  async listRange(fromDate: string, toDate: string): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .gte("settlement_date", fromDate)
      .lte("settlement_date", toDate)
      .order("settlement_date", { ascending: false });
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  async listDatesWithCounts(): Promise<{ date: string; count: number; total: number }[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("settlement_date, gross_aed")
      .order("settlement_date", { ascending: false })
      .limit(5000);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    const byDate = new Map<string, { count: number; total: number }>();
    for (const r of data ?? []) {
      if (!r.settlement_date) continue;
      const v = byDate.get(r.settlement_date) ?? { count: 0, total: 0 };
      v.count += 1;
      v.total += Number(r.gross_aed || 0);
      byDate.set(r.settlement_date, v);
    }
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, count: v.count, total: +v.total.toFixed(2) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  },
};
