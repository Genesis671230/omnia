// lib/repositories/order-events.repository.ts
import { supabase } from "@/lib/supabase";

export type OrderEvent = {
  id: string; order_uid: string; actor: string; kind: string;
  from_state: string | null; to_state: string | null;
  payload: any; created_at: string;
};

export const OrderEventsRepository = {
  async log(orderUid: string, actor: string, kind: string,
            from: string | null, to: string | null, payload: any = {}) {
    const { data, error } = await supabase.rpc("log_order_event", {
      p_order_uid: orderUid, p_actor: actor, p_kind: kind,
      p_from: from, p_to: to, p_payload: payload,
    });
    if (error) console.error("event log failed:", error.message);  // never throw — logging is best-effort
    return data as string | null;
  },
  async listForOrder(orderUid: string): Promise<OrderEvent[]> {
    const { data, error } = await supabase
      .from("order_events")
      .select("*")
      .eq("order_uid", orderUid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`events list failed: ${error.message}`);
    return (data ?? []) as OrderEvent[];
  },
};