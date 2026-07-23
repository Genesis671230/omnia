import { NextResponse } from "next/server";
import { confirmLine, flagLine } from "@/lib/reconciliation/engine";

// POST /api/reconcile/confirm — body: { bankLineId, actor? }
// POST /api/reconcile/flag    — body: { bankLineId, flagged, note? }
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

  if (action === "flag") {
    const { bankLineId, flagged, note } = body;
    if (!bankLineId) {
      return NextResponse.json({ error: "bankLineId required" }, { status: 400 });
    }
    // A flag is a human judgement about a credit, so it is stored and read
    // back verbatim — matching never sets or clears it.
    await flagLine(bankLineId, Boolean(flagged), typeof note === "string" ? note : "");
    return NextResponse.json({
      ok: true, action, bankLineId, flagged: Boolean(flagged),
      updatedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
