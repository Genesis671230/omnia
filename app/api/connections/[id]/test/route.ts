import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { testConnection } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  return NextResponse.json(await testConnection((await params).id));
}
