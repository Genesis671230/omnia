import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { completePending, peekPendingAccounts } from "@/lib/connectors";

export const dynamic = "force-dynamic";

// GET  → { provider, accounts } for the picker (no secrets)
// POST { accountRefs: string[] } → { connectionIds }
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const p = await peekPendingAccounts((await params).id);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "This account picker expired — connect again" }, { status: 410 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const { accountRefs } = (await req.json().catch(() => ({}))) as { accountRefs?: unknown };
  const refs = Array.isArray(accountRefs) ? accountRefs.filter((r): r is string => typeof r === "string") : [];
  try {
    return NextResponse.json({ connectionIds: await completePending((await params).id, refs, auth.session.username) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
