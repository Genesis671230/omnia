import { NextResponse } from "next/server";
import { getSmsaCities, smsaConfigured } from "@/lib/integrations/smsa";

// GET /api/smsa/cities — populates the Ship modal's city dropdown. Server
// cached (see lib/integrations/smsa.ts) so this stays cheap even though the
// modal calls it on every open.
export async function GET() {
  if (!smsaConfigured()) return NextResponse.json({ cities: [] });
  const cities = await getSmsaCities();
  return NextResponse.json({ cities });
}
