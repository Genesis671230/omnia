import { NextResponse } from "next/server";
import { confirmLine, flagLine, forceBookLine, NoPayoutToConfirmError, NotForceBookableError } from "@/lib/reconciliation/engine";

// POST /api/reconcile/confirm — body: { bankLineId, actor? }
// POST /api/reconcile/flag    — body: { bankLineId, flagged, note? }
// POST /api/reconcile/force-book — body: { bankLineId, note, accountId, accountName?, actor? }
//   Books a variance too large to pass as the bank's cut: the orders close in
//   full and the gap books once to accountId. See forceBookLine().
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
    try {
      const settlementsConfirmed = await confirmLine(bankLineId, actor || "founder");
      return NextResponse.json({
        ok: true, action, bankLineId, settlementsConfirmed,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      if (e instanceof NoPayoutToConfirmError) {
        return NextResponse.json({ error: e.message, needsPayoutFile: true }, { status: 409 });
      }
      throw e;
    }
  }

  if (action === "force-book") {
    const { bankLineId, note, accountId, accountName, actor } = body;
    if (!bankLineId) return NextResponse.json({ error: "bankLineId required" }, { status: 400 });
    try {
      const settlementsConfirmed = await forceBookLine({
        bankLineId: String(bankLineId),
        actor: String(actor || "founder"),
        note: typeof note === "string" ? note : "",
        accountId: typeof accountId === "string" ? accountId : "",
        accountName: typeof accountName === "string" ? accountName : "",
      });
      return NextResponse.json({ ok: true, action, bankLineId, settlementsConfirmed, updatedAt: new Date().toISOString() });
    } catch (e) {
      if (e instanceof NotForceBookableError) return NextResponse.json({ error: e.message }, { status: 409 });
      if (e instanceof NoPayoutToConfirmError) {
        return NextResponse.json({ error: e.message, needsPayoutFile: true }, { status: 409 });
      }
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
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
