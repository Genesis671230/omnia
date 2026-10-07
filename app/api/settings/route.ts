import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { describeSettings, setSetting, SettingError } from "@/lib/settings";
import { SETTINGS_BY_KEY } from "@/lib/settings/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  return NextResponse.json({ settings: await describeSettings() });
}

// PUT { values: { [key]: value } } — every value is validated before any is written.
export async function PUT(req: Request) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const { values } = (await req.json().catch(() => ({}))) as { values?: Record<string, unknown> };
  if (!values || typeof values !== "object" || Array.isArray(values)) return NextResponse.json({ error: "values required" }, { status: 400 });
  for (const [k, v] of Object.entries(values)) {
    const def = SETTINGS_BY_KEY.get(k);
    if (!def) return NextResponse.json({ error: `Unknown setting "${k}"` }, { status: 400 });
    const parsed = def.schema.safeParse(v);
    if (!parsed.success) return NextResponse.json({ error: `${def.label}: ${parsed.error.issues[0]?.message ?? "invalid value"}` }, { status: 400 });
  }
  try {
    for (const [k, v] of Object.entries(values)) await setSetting(k, v, auth.session.username);
    return NextResponse.json({ settings: await describeSettings() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof SettingError ? 400 : 500 });
  }
}
