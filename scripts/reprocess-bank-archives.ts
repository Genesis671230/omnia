// One-time historical heal: every bank statement ever uploaded is archived
// byte-for-byte in `uploaded_files` (kind='bank'). This replays each one
// through the CURRENT parser + BankRepository.insertLines merge logic, so
// any row corrupted by a since-fixed parser bug (e.g. the wire-reference
// trailing-digit regex bug — see lib/parsers/bank.ts) gets healed in place:
// same dedupe_key, same row id, corrected amount/narration. No raw SQL
// surgery — this only replays the exact, tested ingestion path, so the
// result is exactly what a manual re-upload of each file would produce.
//
// Safe to re-run: unchanged rows are re-upserted to identical values
// (no-op). New rows are never expected here (every parsed line has already
// been uploaded once), so a nonzero "inserted" count usually means the
// parser now recognizes transactions it used to miss entirely.
//
// Run: npx tsx scripts/reprocess-bank-archives.ts [--dry-run]
import "dotenv/config";
import { supabase } from "@/lib/supabase";
import { parseBankStatement } from "@/lib/parsers/bank";
import { BankRepository, type DuplicateGroup } from "@/lib/repositories/bank.repository";

const DRY_RUN = process.argv.includes("--dry-run");

type ArchivedFile = { id: string; filename: string; uploaded_at: string };

async function listBankArchives(): Promise<ArchivedFile[]> {
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("id, filename, uploaded_at")
    .eq("kind", "bank")
    .order("uploaded_at", { ascending: true });
  if (error) throw new Error(`uploaded_files select failed: ${error.message}`);
  return data ?? [];
}

async function getContent(id: string): Promise<Buffer> {
  const { data, error } = await supabase.from("uploaded_files").select("content_base64").eq("id", id).single();
  if (error || !data) throw new Error(`uploaded_files fetch failed for ${id}: ${error?.message}`);
  return Buffer.from(data.content_base64, "base64");
}

async function extractText(buf: Buffer, filename: string): Promise<string> {
  if (filename.toLowerCase().endsWith(".pdf")) {
    const { extractText: pdfExtractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfExtractText(pdf, { mergePages: true });
    return text;
  }
  return buf.toString("utf8");
}

async function dryRunDiff(lines: Awaited<ReturnType<typeof parseBankStatement>>["credits"], batchId: string) {
  const { new: isNew, heal, unchanged, duplicates } = await BankRepository.previewMerge(lines, batchId);
  for (const row of isNew) {
    console.log(`  [NEW]  ${row.statement_date} ${row.direction} AED ${row.amount} ref:${row.reference}`);
  }
  for (const { row, existing } of heal) {
    console.log(`  [HEAL] ${row.statement_date} ${row.direction} ref:${row.reference}`);
    if (Math.abs(existing.amount - row.amount) > 0.005) console.log(`         amount: AED ${existing.amount} -> AED ${row.amount}`);
    if (existing.description !== row.description) {
      console.log(`         narration: "${existing.description.slice(-60)}" -> "${row.description.slice(-60)}"`);
    }
  }
  return { would_insert: isNew.length, would_heal: heal.length, unchanged, duplicates };
}

// Existing duplicate (date, reference) groups predate this script — a
// re-upload before the merge logic existed could insert a second row
// instead of healing the first.
//
// recon_lines is NOT an audit trail — engine.ts recomputes one row per
// bank_line idempotently on every reconciliation pass (recon_lines_bank_line_idx
// is a plain unique index, recreated fresh each run), so a recon_line merely
// EXISTING for a duplicate is not a reason to keep it. The real audit trail
// is confirmed_by/confirmed_at (a founder clicked "confirm settled") or a
// settlement_records row (gates Zoho Books publish) — only THOSE block
// pruning; anything else is just the engine's disposable preview. There is
// no FK constraint from recon_lines/settlement_records to bank_lines.id
// (verified against information_schema), so deleting a pruned bank_line
// leaves its recon_line orphaned unless we delete that too.
async function prunableDuplicates(groups: DuplicateGroup[]): Promise<{ safeIds: string[]; blockedIds: string[] }> {
  const allExtraIds = [...new Set(groups.flatMap((g) => g.extraIds))];
  if (allExtraIds.length === 0) return { safeIds: [], blockedIds: [] };

  const [recon, settlements] = await Promise.all([
    supabase.from("recon_lines").select("bank_line_id, confirmed_by, confirmed_at").in("bank_line_id", allExtraIds),
    supabase.from("settlement_records").select("bank_line_id").in("bank_line_id", allExtraIds),
  ]);
  const blockedIds = new Set([
    ...(recon.data ?? []).filter((r) => r.confirmed_by || r.confirmed_at).map((r) => r.bank_line_id),
    ...(settlements.data ?? []).map((r) => r.bank_line_id),
  ]);

  console.log(`\n${groups.length} reference(s) have pre-existing duplicate rows:`);
  const safeIds: string[] = [];
  for (const g of groups) {
    const blocked = g.extraIds.filter((id) => blockedIds.has(id));
    const safe = g.extraIds.filter((id) => !blockedIds.has(id));
    safeIds.push(...safe);
    console.log(
      `  ${g.date} ref:${g.reference}  keep=${g.keepId}` +
        (safe.length ? `  safe-to-prune=[${safe.join(", ")}]` : "") +
        (blocked.length ? `  NEEDS MANUAL REVIEW (confirmed/settled elsewhere)=[${blocked.join(", ")}]` : ""),
    );
  }
  return { safeIds, blockedIds: [...blockedIds] };
}

async function pruneDuplicates(groups: DuplicateGroup[], apply: boolean) {
  const { safeIds } = await prunableDuplicates(groups);
  if (!apply || safeIds.length === 0) return;

  console.log(`\nPruning ${safeIds.length} confirmed-safe duplicate row(s)...`);
  const { error: reconErr } = await supabase.from("recon_lines").delete().in("bank_line_id", safeIds);
  if (reconErr) throw new Error(`recon_lines prune failed: ${reconErr.message}`);
  const { error: blErr } = await supabase.from("bank_lines").delete().in("id", safeIds);
  if (blErr) throw new Error(`bank_lines prune failed: ${blErr.message}`);
  console.log(`Pruned ${safeIds.length} row(s).`);
}

async function main() {
  const files = await listBankArchives();
  console.log(`${files.length} archived bank statement(s)${DRY_RUN ? " — DRY RUN, no writes" : ""}\n`);

  const totals = { inserted: 0, updated: 0, collapsed: 0, would_insert: 0, would_heal: 0, unchanged: 0 };
  const duplicatesByGroupKey = new Map<string, DuplicateGroup>();

  for (const f of files) {
    process.stdout.write(`${f.uploaded_at.slice(0, 10)}  ${f.filename} ... `);
    const buf = await getContent(f.id);
    const text = await extractText(buf, f.filename);
    const { credits, debits, format } = parseBankStatement(text, f.filename);
    const lines = [...credits, ...debits];
    if (lines.length === 0) {
      console.log("no transactions recognized, skipped");
      continue;
    }
    console.log(`${credits.length} credits + ${debits.length} debits (${format})`);
    const batchId = `REPROCESS-${f.uploaded_at.slice(0, 10)}-${f.filename.slice(0, 40)}`;

    if (DRY_RUN) {
      const r = await dryRunDiff(lines, batchId);
      totals.would_insert += r.would_insert;
      totals.would_heal += r.would_heal;
      totals.unchanged += r.unchanged;
      for (const g of r.duplicates) duplicatesByGroupKey.set(`${g.date}|${g.reference}`, g);
    } else {
      const r = await BankRepository.insertLines(lines, batchId);
      totals.inserted += r.inserted;
      totals.updated += r.updated;
      totals.collapsed += r.collapsed;
      console.log(`  -> inserted ${r.inserted}, updated ${r.updated}, collapsed ${r.collapsed}`);
      for (const g of r.duplicates) duplicatesByGroupKey.set(`${g.date}|${g.reference}`, g);
    }
  }

  console.log("\nTotals:", DRY_RUN ? totals : { inserted: totals.inserted, updated: totals.updated, collapsed: totals.collapsed });
  await pruneDuplicates([...duplicatesByGroupKey.values()], !DRY_RUN);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
