import { NextResponse } from "next/server";
import { parseBankStatement } from "@/lib/parsers/bank";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

export const maxDuration = 60;

// POST /api/upload/bank — multipart form with `file` (PDF, CSV, or TXT).
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
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const extracted = await extractText(pdf, { mergePages: true });
    text = extracted.text;
  } else {
    text = buf.toString("utf8");
  }

  const { credits, debits, format } = parseBankStatement(text, file.name);
  if (credits.length === 0 && debits.length === 0) {
    return NextResponse.json(
      {
        error:
          "No transactions recognized. Upload a bank statement as PDF, or a CSV export with date, description, and debit/credit (or amount) columns.",
      },
      { status: 422 },
    );
  }

  const batchId = `BANK-${new Date().toISOString().slice(0, 10)}-${file.name.slice(0, 40)}`;
  const result = await BankRepository.insertLines([...credits, ...debits], batchId);

  try {
    await FilesRepository.save({
      kind: "bank",
      filename: file.name,
      mime: file.type || undefined,
      content: buf,
      parseSummary: `${credits.length} credits + ${debits.length} debits (${format}) · ${result.inserted} new lines`,
    });
  } catch (e) {
    console.error("uploaded_files archive failed:", (e as Error).message);
  }

  return NextResponse.json({
    batchId,
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
