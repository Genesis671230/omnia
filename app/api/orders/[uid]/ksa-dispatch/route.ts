import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";
import { preview, record, retry, send, zohoCheck } from "@/lib/ksa-dispatch/ksa-dispatch.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET  → items with live KSA/UAE stock, suggested packaging, today's sheet tab, any earlier send
// GET ?record=1 → just the saved send (cheap — for the flag card)
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  try {
    if (new URL(req.url).searchParams.get("record")) return NextResponse.json({ record: await record(uid) });
    return NextResponse.json(await preview(uid));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// POST { ksaSkus: string[], packaging: {sku, qty}[] } → reserve + KSA sheet rows + Zoho SO close.
// Idempotent: sending again retries the steps that failed. { retry: true } resends the saved selection.
export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const b = await req.json().catch(() => ({}));
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    const actor = session?.username ?? "unknown";
    const pick = {
      ksaSkus: Array.isArray(b.ksaSkus) ? b.ksaSkus.map(String) : [],
      packaging: Array.isArray(b.packaging) ? b.packaging.map((p: { sku?: unknown; qty?: unknown }) => ({ sku: String(p.sku ?? ""), qty: Number(p.qty ?? 0) })) : [],
      uaePackaging: Array.isArray(b.uaePackaging) ? b.uaePackaging.map((p: { sku?: unknown; qty?: unknown }) => ({ sku: String(p.sku ?? ""), qty: Number(p.qty ?? 0) })) : [],
      rateOverride: b.rateOverride == null || b.rateOverride === "" ? undefined : Number(b.rateOverride),
      matchOrderTotal: Boolean(b.matchOrderTotal),
    };
    // { check: true } → Zoho dry run only, nothing written
    if (b.check) return NextResponse.json({ ok: true, check: await zohoCheck(uid, pick) });
    if (b.retry) return NextResponse.json({ ok: true, ...(await retry(uid, actor)) });
    const result = await send(uid, { ...pick, actor });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
  }
}
