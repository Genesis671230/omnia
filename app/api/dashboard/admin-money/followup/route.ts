import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";
import { buildOverdueFollowup, callSettings, placeOverdueCall, sendOverdueTelegram } from "@/lib/alerts/overdue-followup.service";
import { telegramCfoConfigured } from "@/lib/integrations/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/dashboard/admin-money/followup → preview of today's overdue chase
//      (Telegram text, call script, whether each channel is set up). Sends nothing.
// POST { action: "telegram" | "call" } → send it now (admin only). The
//      scheduler does the same at 10:00 / 16:00 (Telegram) and 11:00 (call).
export async function GET() {
  try {
    const [f, c] = await Promise.all([buildOverdueFollowup(), callSettings()]);
    return NextResponse.json({ ...f, telegram: { configured: telegramCfoConfigured() }, call: { configured: c.configured, to: c.to ? `…${c.to.slice(-4)}` : "", minAed: c.minAed } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (session?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (action === "telegram") return NextResponse.json(await sendOverdueTelegram());
    if (action === "call") return NextResponse.json(await placeOverdueCall({ force: true }));
    return NextResponse.json({ error: "action must be telegram or call" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
