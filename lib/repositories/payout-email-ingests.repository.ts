import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type PayoutEmailIngestRow = {
  messageId: string;
  mailbox: string;
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  provider: string | null;
  attachmentName: string | null;
  payoutId: string | null;
  status: "ingested" | "skipped" | "failed";
  error: string | null;
};

export const PayoutEmailIngestsRepository = {
  /** Gmail message ids already examined. The idempotency guard: a message in
   *  here is never fetched or re-ingested, so polling is cheap and repeatable. */
  async seenMessageIds(): Promise<Set<string>> {
    const { data, error } = await supabase
      .from("payout_email_ingests")
      .select("message_id")
      .eq("status", "ingested");
    if (error) throw new Error(`payout_email_ingests select failed: ${error.message}`);
    return new Set((data ?? []).map((r) => r.message_id));
  },

  /** Record an attempt. Upsert on message_id so a message that failed once and
   *  succeeds on a later cycle updates its row rather than duplicating it. */
  async record(row: PayoutEmailIngestRow): Promise<void> {
    const { error } = await supabase.from("payout_email_ingests").upsert(
      {
        id: randomUUID(),
        tenant_id: TENANT,
        message_id: row.messageId,
        mailbox: row.mailbox,
        sender: row.sender,
        subject: row.subject,
        received_at: row.receivedAt,
        provider: row.provider,
        attachment_name: row.attachmentName,
        payout_id: row.payoutId,
        status: row.status,
        error: row.error,
      },
      { onConflict: "message_id" },
    );
    if (error) throw new Error(`payout_email_ingests upsert failed: ${error.message}`);
  },

  async recent(limit = 25) {
    const { data, error } = await supabase
      .from("payout_email_ingests")
      .select("message_id, mailbox, sender, subject, received_at, provider, attachment_name, payout_id, status, error, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`payout_email_ingests recent failed: ${error.message}`);
    return data ?? [];
  },
};
