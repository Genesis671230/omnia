import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import type { ParsedBankLine } from "@/lib/parsers/bank";
import { dedupeKey, hasStableWireIdentity } from "@/lib/parsers/bank-dedupe";

export { dedupeKey } from "@/lib/parsers/bank-dedupe";

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

// Rows that would collide on re-parse (see dedupeKey doc), collapsed
// last-wins — guards against one parse emitting the same transaction twice
// (e.g. a segment straddling a merged-PDF page break), which would
// otherwise try to insert two new rows sharing one dedupe_key and trip the
// unique index.
function toRows(lines: ParsedBankLine[], batchId: string): BankLineRow[] {
  const byKey = new Map<string, BankLineRow>();
  for (const l of lines) {
    const dedupe_key = dedupeKey(l);
    byKey.set(dedupe_key, {
      id: "", // assigned by resolveExistingIds, once we know which rows already exist
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
      dedupe_key,
    });
  }
  return [...byKey.values()];
}

// Existing-row lookup, keyed by each row's OWN dedupe_key so callers can map
// straight back onto their input rows. Exported (not just used inside
// insertLines) so the reprocess-bank-archives script's dry-run mode can
// preview exactly what a real run would match/heal, using identical logic.
//
// Split in two because the identity rule differs by row type:
//  - Wire-identity credits (see hasStableWireIdentity) are matched on the
//    actual (date, reference) COLUMNS, not the stored dedupe_key text — a
//    row inserted before this identity rule existed still carries an old,
//    amount-inclusive string in dedupe_key, so a text match against the
//    newly computed key would never find it and every re-upload would
//    insert a duplicate instead of healing the row.
//  - Everything else (debits, no-ref/invoice-fallback credits) never had
//    its key formula change, so a plain dedupe_key match still finds
//    anything inserted under the old code too.
type ExistingLine = { id: string; amount: number; description: string };

// One (date, reference) identity that already has MORE THAN ONE row in the
// table — leftover from before this merge logic existed, when a re-upload
// under the old amount-inclusive key could insert a second row instead of
// healing the first. Surfaced so callers can decide how to consolidate
// rather than silently guessing; the merge itself only ever picks one
// `keepId` to heal and never deletes anything on its own.
export type DuplicateGroup = { reference: string; date: string; keepId: string; extraIds: string[] };

// PostgREST serializes this column as "YYYY-MM-DDT00:00:00" (it's a
// timestamp column, not a bare date) — normalize before comparing against
// the parser's plain "YYYY-MM-DD" date strings, or every wire-identity
// lookup silently misses and heals nothing.
function dateOnly(v: string): string {
  return v.slice(0, 10);
}

async function resolveExisting(
  rows: BankLineRow[],
): Promise<{ existingByKey: Map<string, ExistingLine>; duplicates: DuplicateGroup[] }> {
  const existingByKey = new Map<string, ExistingLine>();
  const duplicates: DuplicateGroup[] = [];

  const plainRows = rows.filter((r) => !hasStableWireIdentity(r));
  if (plainRows.length) {
    const { data, error } = await supabase
      .from("bank_lines")
      .select("id, dedupe_key, amount, description")
      .in("dedupe_key", plainRows.map((r) => r.dedupe_key));
    if (error) throw new Error(`bank_lines lookup failed: ${error.message}`);
    for (const r of data ?? []) existingByKey.set(r.dedupe_key, { id: r.id, amount: r.amount, description: r.description });
  }

  const wireCreditRows = rows.filter((r) => hasStableWireIdentity(r));
  if (wireCreditRows.length) {
    const refs = [...new Set(wireCreditRows.map((r) => r.reference))];
    const { data, error } = await supabase
      .from("bank_lines")
      .select("id, statement_date, reference, amount, description")
      .eq("direction", "credit")
      .in("reference", refs);
    if (error) throw new Error(`bank_lines lookup failed: ${error.message}`);

    const groups = new Map<string, { id: string; amount: number; description: string }[]>();
    for (const r of data ?? []) {
      const key = `${dateOnly(r.statement_date)}|${r.reference}`;
      groups.set(key, [...(groups.get(key) ?? []), { id: r.id, amount: r.amount, description: r.description }]);
    }

    for (const r of wireCreditRows) {
      const key = `${r.statement_date}|${r.reference}`; // r.statement_date is already plain YYYY-MM-DD
      const candidates = groups.get(key);
      if (!candidates || candidates.length === 0) continue;

      // Prefer whichever existing candidate's AMOUNT already matches this
      // fresh parse — deliberately amount-only, not amount+description: the
      // known corruption is always a gross amount error (a real 7384.87
      // credit next to a phantom 6.00 or 1.00 row), while narration can
      // legitimately differ by cosmetic formatting (a stray space around an
      // \HCP suffix) even between two otherwise-identical values. Requiring
      // description equality too was verified to misfire on live data: it
      // rejected the correct, settlement-evidenced row as "not exact" over
      // a whitespace difference and fell through to picking the phantom
      // row as canonical instead — exactly backwards. Only fall back to
      // "last returned" when no candidate's amount matches at all.
      const exact = candidates.find((c) => Math.abs(c.amount - r.amount) <= 0.005);
      const canonical = exact ?? candidates[candidates.length - 1];
      existingByKey.set(r.dedupe_key, canonical);

      if (candidates.length > 1) {
        const extraIds = candidates.filter((c) => c.id !== canonical.id).map((c) => c.id);
        duplicates.push({ reference: r.reference, date: r.statement_date ?? "", keepId: canonical.id, extraIds });
      }
    }
  }

  return { existingByKey, duplicates };
}

export const BankRepository = {
  // Re-uploading the same or an overlapping-period statement must never
  // duplicate a row, and — critically — must HEAL a row that a previous,
  // buggier parse corrupted (wrong amount, truncated narration) instead of
  // leaving the corrupted row stranded next to a freshly inserted correct
  // one. So this is a merge, not an insert: existing rows are looked up
  // first (resolveExistingIds), and any match is updated BY ITS EXISTING
  // id — the id is never regenerated, because recon_lines.bank_line_id and
  // settlement_records.bank_line_id point at it; changing it would orphan
  // reconciliation state and settlement audit history for anything already
  // confirmed against that row.
  async insertLines(
    lines: ParsedBankLine[],
    batchId: string,
  ): Promise<{ inserted: number; updated: number; collapsed: number; duplicates: DuplicateGroup[] }> {
    if (lines.length === 0) return { inserted: 0, updated: 0, collapsed: 0, duplicates: [] };

    const rows = toRows(lines, batchId);
    const collapsed = lines.length - rows.length;
    const { existingByKey, duplicates } = await resolveExisting(rows);
    for (const row of rows) row.id = existingByKey.get(row.dedupe_key)?.id ?? randomUUID();

    const { error } = await supabase.from("bank_lines").upsert(rows, { onConflict: "id" }).select("id");
    if (error) throw new Error(`bank_lines upsert failed: ${error.message}`);

    const updated = rows.filter((r) => existingByKey.has(r.dedupe_key)).length;
    return { inserted: rows.length - updated, updated, collapsed, duplicates };
  },

  // Read-only preview of what insertLines() would do — used by the
  // reprocess-bank-archives script's --dry-run mode so a founder can see
  // exactly which rows would be inserted vs. healed (and how) before any
  // write touches production data.
  async previewMerge(
    lines: ParsedBankLine[],
    batchId: string,
  ): Promise<{
    new: BankLineRow[];
    heal: { row: BankLineRow; existing: ExistingLine }[];
    unchanged: number;
    duplicates: DuplicateGroup[];
  }> {
    const rows = toRows(lines, batchId);
    const { existingByKey, duplicates } = await resolveExisting(rows);

    const isNew: BankLineRow[] = [];
    const heal: { row: BankLineRow; existing: ExistingLine }[] = [];
    let unchanged = 0;
    for (const row of rows) {
      const existing = existingByKey.get(row.dedupe_key);
      if (!existing) {
        isNew.push(row);
      } else if (Math.abs(existing.amount - row.amount) > 0.005 || existing.description !== row.description) {
        heal.push({ row, existing });
      } else {
        unchanged += 1;
      }
    }
    return { new: isNew, heal, unchanged, duplicates };
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
