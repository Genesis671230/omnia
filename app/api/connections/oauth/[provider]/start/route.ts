import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { startConnect, OAuthFlowError } from "@/lib/connectors";

export const dynamic = "force-dynamic";

// POST /api/connections/oauth/:provider/start
//   { authMode, grantType?, ownApp?: { clientId, clientSecret }, token?, refreshToken?, webhookSecret?, params? }
//   → { redirect } (OAuth) | { connection } (token / refresh token / client credentials)
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const { provider } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const out = await startConnect({
      provider,
      authMode: b.authMode as any,
      grantType: b.grantType as any,
      ownApp: b.ownApp as any,
      token: typeof b.token === "string" ? b.token : undefined,
      refreshToken: typeof b.refreshToken === "string" ? b.refreshToken : undefined,
      webhookSecret: typeof b.webhookSecret === "string" ? b.webhookSecret : undefined,
      params: b.params && typeof b.params === "object" ? (b.params as Record<string, string>) : {},
    }, auth.session.username);
    return NextResponse.json(out);
  } catch (e) {
    const known = e instanceof OAuthFlowError;
    return NextResponse.json({ error: (e as Error).message, code: known ? e.code : undefined }, { status: known ? 400 : 422 });
  }
}
