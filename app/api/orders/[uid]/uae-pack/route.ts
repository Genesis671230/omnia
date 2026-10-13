import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";
import { check, preview, record, send } from "@/lib/uae-pack/uae-pack.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET → items + boxes with live Omniastores LLC stock, suggested boxes, SO status, any earlier pack
// GET ?record=1 → just the saved pack
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  try {
    if (new URL(req.url).searchParams.get("record")) return NextResponse.json({ record: await record(uid) });
    return NextResponse.json(await preview(uid));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// POST { packaging: {sku, qty}[], rateOverride?, matchOrderTotal? } → reserve from Omniastores LLC + Zoho SO close.
// { check: true } → Zoho dry run only, nothing written.
export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const input = {
      packaging: Array.isArray(b.packaging) ? b.packaging.map((p: { sku?: unknown; qty?: unknown }) => ({ sku: String(p.sku ?? ""), qty: Number(p.qty ?? 0) })) : [],
      rateOverride: b.rateOverride == null || b.rateOverride === "" ? undefined : Number(b.rateOverride),
      matchOrderTotal: Boolean(b.matchOrderTotal),
    };
    if (b.check) return NextResponse.json({ ok: true, check: await check(uid, input) });
    if (b.confirm !== true) return NextResponse.json({ ok: false, error: "confirm: true required" }, { status: 400 });
    const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
    return NextResponse.json({ ok: true, ...(await send(uid, { ...input, actor: session?.username ?? "unknown" })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
  }
}
