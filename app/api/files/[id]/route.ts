import { NextResponse } from "next/server";
import { FilesRepository } from "@/lib/repositories/files.repository";

// GET /api/files/:id — download the original uploaded document byte-for-byte.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await FilesRepository.get(id);
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
      "Content-Length": String(file.content.length),
    },
  });
}
