import { NextResponse } from "next/server";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

// GET /api/confirm/:token/document — public (no auth), but only ever
// serves the ONE file tied to this token — never an arbitrary uploaded_files id.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await SettlementDocumentsRepository.getByToken(token);
  if (!doc) return NextResponse.json({ error: "Unknown or expired link" }, { status: 404 });

  const file = await FilesRepository.get(doc.uploaded_file_id);
  if (!file) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
      "Content-Length": String(file.content.length),
    },
  });
}
