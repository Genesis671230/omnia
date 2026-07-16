import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import type { ParsedBankLine } from "@/lib/parsers/bank";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type BankLineRow = {
  id: string;
  tenant_id: string;
  batch_id: string;
  statement_date: string | null;
  description: string;
  reference: string;
  amount: number;
  currency: string;
  direction: "credit" | "debit";
  gateway_guess: string | null;
  confidence: string | null;
  kind: string | null;
  status: string;
  dedupe_key: string;
};

// Cross-format fingerprint: the PDF and CSV renderings of one transaction
// differ in description tails (merged reference tokens, \HCP suffixes),
// never in the head — so fingerprint the reference-scrubbed prefix.
function dedupeKey(l: ParsedBankLine): string {
  let scrubbed = l.narration.replace(/\\HCP\b/g, "");
  if (l.reference) scrubbed = scrubbed.split(l.reference).join(" ");
  const descPrefix = scrubbed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
  return [l.date, l.direction, l.amount.toFixed(2), l.reference, descPrefix].join("|");
}

export const BankRepository = {
  async insertLines(lines: ParsedBankLine[], batchId: string): Promise<{ inserted: number; skipped: number }> {
    if (lines.length === 0) return { inserted: 0, skipped: 0 };
    const rows: BankLineRow[] = lines.map((l) => ({
      id: randomUUID(),
      tenant_id: TENANT,
      batch_id: batchId,
      statement_date: l.date || null,
      description: l.narration,
      reference: l.reference,
      amount: l.amount,
      currency: "AED",
      direction: l.direction,
      gateway_guess: l.provider ?? null,
      confidence: l.confidence ?? null,
      kind: l.kind ?? null,
      status: "imported",
      dedupe_key: dedupeKey(l),
    }));

    const { data, error } = await supabase
      .from("bank_lines")
      .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`bank_lines insert failed: ${error.message}`);
    const inserted = data?.length ?? 0;
    return { inserted, skipped: rows.length - inserted };
  },

  async listCredits() {
    const { data, error } = await supabase
      .from("bank_lines")
      .select("id, batch_id, statement_date, description, reference, amount, gateway_guess, confidence, status")
      .eq("direction", "credit")
      .order("statement_date", { ascending: false })
      .order("amount", { ascending: false });
    if (error) throw new Error(`bank_lines select failed: ${error.message}`);
    return data ?? [];
  },

  async listDebits() {
    const { data, error } = await supabase
      .from("bank_lines")
      .select("id, statement_date, description, reference, amount, kind")
      .eq("direction", "debit")
      .order("statement_date", { ascending: false });
    if (error) throw new Error(`bank_lines select failed: ${error.message}`);
    return data ?? [];
  },
};
