import { NextResponse } from "next/server";
import { buildUploads } from "@/lib/dashboard/uploads.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/admin-money/uploads
// Latest payout per gateway + the bank statement / payout file upload log,
// each with when it was uploaded. Read-only.
export async function GET() {
  try {
    return NextResponse.json(await buildUploads());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
