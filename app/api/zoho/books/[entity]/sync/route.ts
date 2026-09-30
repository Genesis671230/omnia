import { NextResponse } from "next/server";
import { zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { entityDef, syncEntity, type EntityName, zohoError } from "@/lib/integrations/zoho-books-actions";
import { requireRole } from "@/lib/auth/session-role";

export const maxDuration = 120;

// POST /api/zoho/books/:entity/sync?zohoOrg=  → incremental pull into zoho_records
//   ≤ 25 Zoho requests per call; { done: false } means call again to continue.

type Ctx = { params: Promise<{ entity: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { entity } = await params;
  if (!entityDef(entity)) return NextResponse.json({ error: `Unknown entity "${entity}"` }, { status: 404 });
  const auth = await requireRole("admin", "finance");
  if ("denied" in auth) return auth.denied;
  return zohoOrgScoped(req, async () => {
    try { return NextResponse.json(await syncEntity(entity as EntityName)); } catch (e) { return zohoError(e); }
  });
}
