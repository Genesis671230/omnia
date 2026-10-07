import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { runSync, ReauthRequiredError } from "@/lib/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  try {
    return NextResponse.json(await runSync((await params).id));
  } catch (e) {
    const reauth = e instanceof ReauthRequiredError;
    return NextResponse.json({ error: (e as Error).message, reauth }, { status: reauth ? 409 : 500 });
  }
}
