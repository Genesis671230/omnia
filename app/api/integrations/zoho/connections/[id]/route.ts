import { NextResponse } from "next/server";
import { deleteZohoConnection, testZohoConnection, updateZohoConnection } from "@/lib/integrations/zoho-org";

export const dynamic = "force-dynamic";

// POST   /api/integrations/zoho/connections/:id        → test: refresh token + read the org
// PATCH  /api/integrations/zoho/connections/:id        { label?, status?: "active"|"disabled", dailyBudget?, defaultForProviders?: ["COD"] }
// DELETE /api/integrations/zoho/connections/:id        refused while payouts settle into it

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json(await testZohoConnection(id));
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { label?: string; status?: string; dailyBudget?: number; defaultForProviders?: unknown };
  const providers = Array.isArray(b.defaultForProviders) ? b.defaultForProviders.map(String) : undefined;
  if (b.status && b.status !== "active" && b.status !== "disabled") return NextResponse.json({ error: "status must be active or disabled" }, { status: 400 });
  try {
    await updateZohoConnection(id, { label: b.label, status: b.status as "active" | "disabled" | undefined, dailyBudget: b.dailyBudget, defaultForProviders: providers });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteZohoConnection(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
