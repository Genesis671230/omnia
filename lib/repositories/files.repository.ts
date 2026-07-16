// Raw uploaded documents (bank statements + payout files). Whatever the
// parsers ingested, the founder can list and re-download byte-for-byte.

import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type StoredFileMeta = {
  id: string;
  kind: "bank" | "payout";
  provider: string | null;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  parse_summary: string | null;
  uploaded_at: string;
};

export const FilesRepository = {
  async save(args: {
    kind: "bank" | "payout";
    provider?: string;
    filename: string;
    mime?: string;
    content: Buffer;
    parseSummary?: string;
  }): Promise<string | null> {
    const { data, error } = await supabase
      .from("uploaded_files")
      .insert({
        tenant_id: TENANT,
        kind: args.kind,
        provider: args.provider ?? null,
        filename: args.filename,
        mime: args.mime ?? null,
        size_bytes: args.content.length,
        content_base64: args.content.toString("base64"),
        parse_summary: args.parseSummary ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`uploaded_files insert failed: ${error.message}`);
    return data?.id ?? null;
  },

  async list(): Promise<StoredFileMeta[]> {
    const { data, error } = await supabase
      .from("uploaded_files")
      .select("id, kind, provider, filename, mime, size_bytes, parse_summary, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`uploaded_files select failed: ${error.message}`);
    return (data ?? []) as StoredFileMeta[];
  },

  async get(id: string): Promise<(StoredFileMeta & { content: Buffer }) | null> {
    const { data, error } = await supabase
      .from("uploaded_files")
      .select("id, kind, provider, filename, mime, size_bytes, parse_summary, uploaded_at, content_base64")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    const { content_base64, ...meta } = data as StoredFileMeta & { content_base64: string };
    return { ...meta, content: Buffer.from(content_base64, "base64") };
  },
};
