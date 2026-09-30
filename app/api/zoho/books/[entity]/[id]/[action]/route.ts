import { NextResponse } from "next/server";
import { zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { entityDef, runRecordAction, type EntityName, zohoError } from "@/lib/integrations/zoho-books-actions";
import { requireRole } from "@/lib/auth/session-role";

// POST /api/zoho/books/:entity/:id/:action?zohoOrg=  { optional Zoho body }
//   invoices: void | mark_sent | email      (admin / finance)

type Ctx = { params: Promise<{ entity: string; id: string; action: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { entity, id, action } = await params;
  if (!entityDef(entity)) return NextResponse.json({ error: `Unknown entity "${entity}"` }, { status: 404 });
  const auth = await requireRole("admin", "finance");
  if ("denied" in auth) return auth.denied;
  const body = await req.json().catch(() => undefined);
  return zohoOrgScoped(req, async () => {
    try { return NextResponse.json(await runRecordAction(entity as EntityName, id, action, body && typeof body === "object" ? body : undefined, auth.session.username)); } catch (e) { return zohoError(e); }
  });
}
