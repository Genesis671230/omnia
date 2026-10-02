import { NextResponse } from "next/server";
import { markReconDirty } from "@/lib/reconciliation/snapshot";
import { parseBankStatement } from "@/lib/parsers/bank";
import { xlsxToCsvText } from "@/lib/parsers/xlsx-to-csv";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";
import { detectStatementAccount, LEGACY_ACCOUNT, listStatementAccounts } from "@/lib/finance/statement-accounts";

export const maxDuration = 60;

// POST /api/upload/bank — multipart form with `file` (PDF, CSV, or TXT) and
// `account` (statement_accounts.id). Without `account`, the statement's own
// header (account number, card mask, holder) picks it; a statement that names
// none of them is the Omniastores SIB export, as every upload was before.
// Bank-agnostic: handles ENBD statements (PDF + CSV export) and any
// statement with date / description / debit / credit / amount columns.
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (field name: file)" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let text: string;
  let parserFilename = file.name;
  try {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const extracted = await extractText(pdf, { mergePages: true });
      text = extracted.text;
    } else if (/\.xlsx?$/i.test(file.name)) {
      text = xlsxToCsvText(buf);
      parserFilename = "statement.csv"; // force the existing CSV header-matching path
    } else {
      text = buf.toString("utf8");
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't read this file: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const accounts = await listStatementAccounts().catch(() => []);
  const asked = String(form.get("account") ?? "").trim();
  if (asked && !accounts.some((a) => a.id === asked)) {
    return NextResponse.json({ error: `Unknown statement account "${asked}"` }, { status: 400 });
  }
  const detected = detectStatementAccount(text, accounts);
  if (asked && detected && detected.id !== asked) {
    return NextResponse.json(
      { error: `This statement looks like ${detected.label}, but it was uploaded to ${accounts.find((a) => a.id === asked)?.label}. Pick the right account and upload again.` },
      { status: 409 },
    );
  }
  const account = asked || detected?.id || LEGACY_ACCOUNT;
  const accountLabel = accounts.find((a) => a.id === account)?.label ?? account;

  const parsed = parseBankStatement(text, parserFilename);
  const credits = parsed.credits.map((l) => ({ ...l, account }));
  const debits = parsed.debits.map((l) => ({ ...l, account }));
  const format = parsed.format;
  if (credits.length === 0 && debits.length === 0) {
    return NextResponse.json(
      {
        error:
          "No transactions recognized. Upload a bank statement as PDF, XLS/XLSX, or a CSV export with date, description, and debit/credit (or amount) columns.",
      },
      { status: 422 },
    );
  }

  const batchId = `BANK-${account === LEGACY_ACCOUNT ? "" : `${account}-`}${new Date().toISOString().slice(0, 10)}-${file.name.slice(0, 40)}`;
  let result: Awaited<ReturnType<typeof BankRepository.insertLines>>;
  try {
    result = await BankRepository.insertLines([...credits, ...debits], batchId);
  } catch (e) {
    // Parsed fine but couldn't be saved — say so in JSON (an unhandled throw
    // returns an HTML 500 the upload dialog can only show as "Unexpected token").
    return NextResponse.json(
      { error: `Read ${credits.length} credits + ${debits.length} debits but couldn't save them: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  try {
    await FilesRepository.save({
      kind: "bank",
      filename: file.name,
      mime: file.type || undefined,
      content: buf,
      parseSummary: `${accountLabel}: ${credits.length} credits + ${debits.length} debits (${format}) · ${result.inserted} new lines`,
    });
  } catch (e) {
    console.error("uploaded_files archive failed:", (e as Error).message);
  }

  await markReconDirty("upload/bank");
  return NextResponse.json({
    batchId,
    account,
    accountLabel,
    format,
    credits: credits.length,
    debits: debits.length,
    creditTotal: +credits.reduce((s, c) => s + c.amount, 0).toFixed(2),
    debitTotal: +debits.reduce((s, c) => s + c.amount, 0).toFixed(2),
    inserted: result.inserted,
    updated: result.updated,
    collapsedDuplicates: result.collapsed,
    preexistingDuplicateReferences: result.duplicates.length,
    unclassifiedCredits: credits.filter((c) => c.confidence === "unknown").length,
  });
}
