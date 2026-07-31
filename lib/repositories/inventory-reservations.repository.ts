// lib/repositories/inventory-reservations.repository.ts
import { supabase } from "@/lib/supabase";

export type ReserveResult =
  | { ok: true; warehouse_id: string; warehouse_name: string;
      reservations: { sku: string; qty: number }[] }
  | { ok: false; error: string; stage?: string;
      failures?: { sku: string; need?: number; have?: number; reason: string }[] };

export type FulfillmentOption = {
  warehouse_id: string; warehouse_name: string;
  can_fulfill: boolean; blockers: any[];
};

export const InventoryReservationsRepository = {
  async reserve(orderUid: string, warehouseId: string, by: string): Promise<ReserveResult> {
    const { data, error } = await supabase.rpc("reserve_order_from_warehouse", {
      p_order_uid: orderUid, p_warehouse_id: warehouseId, p_reserved_by: by,
    });
    if (error) throw new Error(`reserve failed: ${error.message}`);
    return data as ReserveResult;
  },
  async release(orderUid: string, reason: string): Promise<number> {
    const { data, error } = await supabase.rpc("release_order_reservations", {
      p_order_uid: orderUid, p_reason: reason,
    });
    if (error) throw new Error(`release failed: ${error.message}`);
    return (data as number) ?? 0;
  },
  async options(orderUid: string): Promise<FulfillmentOption[]> {
    const { data, error } = await supabase.rpc("order_fulfillment_options", { p_order_uid: orderUid });
    if (error) throw new Error(`options failed: ${error.message}`);
    return (data ?? []) as FulfillmentOption[];
  },
  async listForOrder(orderUid: string) {
    const { data, error } = await supabase
      .from("inventory_reservations")
      .select("*").eq("order_uid", orderUid).is("released_at", null);
    if (error) throw new Error(`list failed: ${error.message}`);
    return data ?? [];
  },
};