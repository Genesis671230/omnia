// Evidence documents for non-API gateway settlements. One uploaded file can
// cover many orders (a whole payout statement) — confirming the document
// cascades evidence_confirmed=true to every linked settlement_records row.

import crypto from "node:crypto";
import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type SettlementDocument = {
  id: string;
  uploaded_file_id: string;
  confirm_token: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type SettlementDocumentWithLinks = SettlementDocument & {
  settlementRecordIds: string[];
};

export const SettlementDocumentsRepository = {
  async create(args: { uploadedFileId: string; settlementRecordIds: string[] }): Promise<SettlementDocumentWithLinks> {
    const confirmToken = crypto.randomBytes(24).toString("base64url");
    const { data, error } = await supabase
      .from("settlement_documents")
      .insert({ tenant_id: TENANT, uploaded_file_id: args.uploadedFileId, confirm_token: confirmToken })
      .select("*")
      .single();
    if (error || !data) throw new Error(`settlement_documents insert failed: ${error?.message}`);

    if (args.settlementRecordIds.length > 0) {
      const links = args.settlementRecordIds.map((settlement_record_id) => ({
        settlement_document_id: data.id,
        settlement_record_id,
      }));
      const { error: linkError } = await supabase.from("settlement_document_links").insert(links);
      if (linkError) throw new Error(`settlement_document_links insert failed: ${linkError.message}`);

      const { error: docIdError } = await supabase
        .from("settlement_records")
        .update({ evidence_type: "document", evidence_document_id: data.id })
        .in("id", args.settlementRecordIds);
      if (docIdError) throw new Error(`settlement_records evidence_document_id update failed: ${docIdError.message}`);
    }

    return { ...(data as SettlementDocument), settlementRecordIds: args.settlementRecordIds };
  },

  async getByToken(token: string): Promise<SettlementDocumentWithLinks | null> {
    const { data, error } = await supabase
      .from("settlement_documents")
      .select("*")
      .eq("confirm_token", token)
      .maybeSingle();
    if (error || !data) return null;

    const { data: links, error: linksError } = await supabase
      .from("settlement_document_links")
      .select("settlement_record_id")
      .eq("settlement_document_id", data.id);
    if (linksError) throw new Error(`settlement_document_links select failed: ${linksError.message}`);

    return {
      ...(data as SettlementDocument),
      settlementRecordIds: (links ?? []).map((l) => l.settlement_record_id as string),
    };
  },

  async confirm(token: string, confirmedBy: string): Promise<SettlementDocumentWithLinks> {
    const existing = await this.getByToken(token);
    if (!existing) throw new Error("Unknown confirm token");
    if (existing.confirmed_at) return existing; // idempotent — already confirmed

    const confirmedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("settlement_documents")
      .update({ confirmed_by: confirmedBy, confirmed_at: confirmedAt })
      .eq("confirm_token", token)
      .select("*")
      .single();
    if (error || !data) throw new Error(`settlement_documents confirm failed: ${error?.message}`);

    if (existing.settlementRecordIds.length > 0) {
      const { error: srError } = await supabase
        .from("settlement_records")
        .update({ evidence_confirmed: true, evidence_confirmed_by: confirmedBy, evidence_confirmed_at: confirmedAt })
        .in("id", existing.settlementRecordIds);
      if (srError) throw new Error(`settlement_records confirm cascade failed: ${srError.message}`);
    }

    return { ...(data as SettlementDocument), settlementRecordIds: existing.settlementRecordIds };
  },
};
