import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { getConnection, removeConnection, toPublic, updateConnection } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getConnection((await params).id);
  return c ? NextResponse.json({ connection: toPublic(c) }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

// PATCH { label?, config?, status?: "active" | "disabled", secrets?: { webhook_secret?, client_id?, client_secret?, access_token? } }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  if (b.status !== undefined && !["active", "disabled"].includes(b.status)) {
    return NextResponse.json({ error: "status must be active or disabled" }, { status: 400 });
  }
  const allowedSecrets = ["webhook_secret", "client_id", "client_secret", "access_token"];
  const secrets = b.secrets && typeof b.secrets === "object"
    ? Object.fromEntries(Object.entries(b.secrets).filter(([k, v]) => allowedSecrets.includes(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim()]))
    : undefined;
  try {
    await updateConnection((await params).id, {
      label: typeof b.label === "string" ? b.label : undefined,
      config: b.config && typeof b.config === "object" ? b.config : undefined,
      status: b.status,
      secrets: secrets && Object.keys(secrets).length ? secrets : undefined,
    }, auth.session.username);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  try {
    const out = await removeConnection((await params).id, auth.session.username);
    return "blocked" in out
      ? NextResponse.json({ error: `Still used by: ${out.blocked.join("; ")}. Disable it instead.`, blocked: out.blocked }, { status: 409 })
      : NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
