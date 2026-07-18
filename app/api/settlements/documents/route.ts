import { NextResponse } from "next/server";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";

// POST /api/settlements/documents — link an already-uploaded payout file to
// the settlement records it evidences, and mint the public confirm link.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const uploadedFileId = String(body.uploadedFileId || "");
  const settlementRecordIds = Array.isArray(body.settlementRecordIds) ? body.settlementRecordIds.map(String) : [];

  if (!uploadedFileId || settlementRecordIds.length === 0) {
    return NextResponse.json({ error: "uploadedFileId and settlementRecordIds are required" }, { status: 400 });
  }

  const doc = await SettlementDocumentsRepository.create({ uploadedFileId, settlementRecordIds });
  const origin = new URL(request.url).origin;
  return NextResponse.json({ confirmUrl: `${origin}/confirm/${doc.confirm_token}` });
}
