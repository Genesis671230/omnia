import { NextResponse } from "next/server";
import { confirmLine } from "@/lib/reconciliation/engine";

// POST /api/reconcile/confirm — body: { bankLineId, actor? }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  const body = await request.json().catch(() => ({}));

  if (action === "confirm") {
    const { bankLineId, actor } = body;
    if (!bankLineId) {
      return NextResponse.json({ error: "bankLineId required" }, { status: 400 });
    }
    // How many orders this confirmation just made publishable to Zoho — the
    // UI reports it back so a bookkeeper sees the consequence of the click
    // rather than having to go hunting in the Settlements panel.
    const settlementsConfirmed = await confirmLine(bankLineId, actor || "founder");
    return NextResponse.json({
      ok: true, action, bankLineId, settlementsConfirmed,
      updatedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
