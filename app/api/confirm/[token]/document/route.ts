import { NextResponse } from "next/server";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

// file.mime is whatever the uploader's browser sent (file.type at upload
// time) — attacker/uploader-controlled, not server-derived. This route is
// public and unauthenticated, so only render inline for types that can't
// execute script in a browser; anything else forces a download instead of
// risking an uploaded "evidence" file rendering as live HTML/SVG.
const INLINE_SAFE_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// GET /api/confirm/:token/document — public (no auth), but only ever
// serves the ONE file tied to this token — never an arbitrary uploaded_files id.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await SettlementDocumentsRepository.getByToken(token);
  if (!doc) return NextResponse.json({ error: "Unknown or expired link" }, { status: 404 });

  const file = await FilesRepository.get(doc.uploaded_file_id);
  if (!file) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const safe = Boolean(file.mime && INLINE_SAFE_MIME.has(file.mime));
  const filename = file.filename.replace(/"/g, "");

  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": safe ? file.mime! : "application/octet-stream",
      "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${filename}"`,
      "Content-Length": String(file.content.length),
    },
  });
}
