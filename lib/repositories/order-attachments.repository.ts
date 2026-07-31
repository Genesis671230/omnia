import { supabase } from "../supabase";

// lib/repositories/order-attachments.repository.ts
export const OrderAttachmentsRepository = {
    async attach(orderUid: string, kind: string, url: string, opts: {
      provider?: string; externalRef?: string; createdBy?: string; metadata?: any;
    } = {}) {
      const { data, error } = await supabase.from("order_attachments").insert({
        order_uid: orderUid, kind, url,
        provider: opts.provider ?? "internal",
        external_ref: opts.externalRef ?? null,
        created_by: opts.createdBy ?? "system",
        metadata: opts.metadata ?? {},
      }).select("*").single();
      if (error) throw new Error(`attach failed: ${error.message}`);
      return data;
    },
    async listForOrder(orderUid: string) {
      const { data, error } = await supabase.from("order_attachments")
        .select("*").eq("order_uid", orderUid).order("created_at", { ascending: false });
      if (error) throw new Error(`attachments list failed: ${error.message}`);
      return data ?? [];
    },
  };