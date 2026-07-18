import { NextResponse } from "next/server";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

// GET /api/confirm/:token — public (no auth). Resolves a confirm token to
// its document metadata + the orders it evidences, for the /confirm page.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await SettlementDocumentsRepository.getByToken(token);
  if (!doc) return NextResponse.json({ error: "Unknown or expired link" }, { status: 404 });

  const [file, settlements] = await Promise.all([
    FilesRepository.get(doc.uploaded_file_id),
    SettlementsRepository.listByIds(doc.settlementRecordIds),
  ]);

  return NextResponse.json({
    confirmed: Boolean(doc.confirmed_at),
    confirmedBy: doc.confirmed_by,
    confirmedAt: doc.confirmed_at,
    filename: file?.filename ?? "document",
    settlements: settlements.map((s) => ({
      id: s.id,
      orderNumber: s.order_number,
      customerName: s.customer_name,
      grossAed: s.gross_aed,
      gateway: s.gateway,
      settlementDate: s.settlement_date,
    })),
  });
}

// POST /api/confirm/:token — records the confirmation. Idempotent: a
// second confirm on an already-confirmed token just returns the existing
// confirmation rather than erroring.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const confirmedBy = String(body.confirmedBy || "").trim();
  if (!confirmedBy) return NextResponse.json({ error: "confirmedBy (name or email) is required" }, { status: 400 });

  try {
    const doc = await SettlementDocumentsRepository.confirm(token, confirmedBy);
    return NextResponse.json({ confirmed: true, confirmedBy: doc.confirmed_by, confirmedAt: doc.confirmed_at });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
