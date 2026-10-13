import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";
import { ADJUSTMENT_KINDS, type AdjustmentKind } from "@/lib/orders/order-adjustment";
import { getAdjustmentContext, runAdjustment, undoAdjustment } from "@/lib/orders/order-adjustment.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders/:uid/adjust[?zohoOrg=&invoiceId=]
//   The order, its adjustments, its Zoho invoices in every org, and the
//   chosen invoice's lines — what the Cancel / Return / Exchange dialog needs.
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const sp = new URL(req.url).searchParams;
  try {
    return NextResponse.json(await getAdjustmentContext(uid, { connectionId: sp.get("zohoOrg"), invoiceId: sp.get("invoiceId") }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/orders/:uid/adjust  { kind, zohoOrg, invoiceId, date, picks, deductAed, exchange, note, markOnly, dryRun }
//   dryRun (default true) returns the plan; dryRun:false writes to Zoho.
export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const b = await req.json().catch(() => ({}));
  if (!ADJUSTMENT_KINDS.includes(b.kind)) {
    return NextResponse.json({ error: `kind must be one of: ${ADJUSTMENT_KINDS.join(", ")}` }, { status: 400 });
  }
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    const result = await runAdjustment({
      uid, kind: b.kind as AdjustmentKind, connectionId: b.zohoOrg ?? null, invoiceId: b.invoiceId ?? null, date: b.date,
      picks: Array.isArray(b.picks) ? b.picks : undefined, deductAed: Number(b.deductAed) || 0,
      exchange: Array.isArray(b.exchange) ? b.exchange : undefined, note: typeof b.note === "string" ? b.note : "",
      markOnly: Boolean(b.markOnly), dryRun: b.dryRun !== false, actor: session?.username ?? "unknown",
      receivedAed: Number(b.receivedAed) || 0, receivedVia: typeof b.receivedVia === "string" ? b.receivedVia : "",
      depositAccountId: typeof b.depositAccountId === "string" ? b.depositAccountId : "", depositAccountName: typeof b.depositAccountName === "string" ? b.depositAccountName : "",
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/orders/:uid/adjust?id=…  — undo (Zoho documents must be gone first)
export async function DELETE(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const id = new URL(req.url).searchParams.get("id") || "";
  try {
    const r = await undoAdjustment(uid, id);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
