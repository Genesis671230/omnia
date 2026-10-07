import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/session-role";
import { completeCallback, OAuthFlowError } from "@/lib/connectors";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET /api/connections/oauth/:provider/callback — where the provider sends the
// browser back. Always ends in a redirect to Settings with the outcome.
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?tab=connections&${q}`, url.origin));
  const session = await currentSession();
  if (!session || session.role !== "admin") return back("error=not_admin");
  try {
    const out = await completeCallback(provider, url.searchParams, session.username);
    if ("pendingId" in out) return back(`pick=${encodeURIComponent(out.pendingId)}`);
    return back(`connected=${encodeURIComponent(out.connectionIds.join(","))}`);
  } catch (e) {
    const code = e instanceof OAuthFlowError ? e.code : "exchange_failed";
    await writeAudit({ entity: "connection", entityId: provider, event: "connect_failed", actor: session.username, payload: { code, message: (e as Error).message } });
    return back(`error=${code}&message=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
