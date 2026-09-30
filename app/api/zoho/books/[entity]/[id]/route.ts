import { NextResponse } from "next/server";
import { zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { deleteRecord, entityDef, getRecord, updateRecord, type EntityName, zohoError } from "@/lib/integrations/zoho-books-actions";
import { requireRole } from "@/lib/auth/session-role";

// GET    /api/zoho/books/:entity/:id?zohoOrg=          get
// PUT    /api/zoho/books/:entity/:id?zohoOrg=  {…}     update (admin / finance)
// DELETE /api/zoho/books/:entity/:id?zohoOrg=          delete (admin only)

type Ctx = { params: Promise<{ entity: string; id: string }> };
const unknown = (entity: string) => NextResponse.json({ error: `Unknown entity "${entity}"` }, { status: 404 });

export async function GET(req: Request, { params }: Ctx) {
  const { entity, id } = await params;
  if (!entityDef(entity)) return unknown(entity);
  return zohoOrgScoped(req, async () => {
    try { return NextResponse.json({ record: await getRecord(entity as EntityName, id) }); } catch (e) { return zohoError(e); }
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { entity, id } = await params;
  if (!entityDef(entity)) return unknown(entity);
  const auth = await requireRole("admin", "finance");
  if ("denied" in auth) return auth.denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Send the fields to change as a JSON object" }, { status: 400 });
  return zohoOrgScoped(req, async () => {
    try { return NextResponse.json({ record: await updateRecord(entity as EntityName, id, body, auth.session.username) }); } catch (e) { return zohoError(e); }
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { entity, id } = await params;
  if (!entityDef(entity)) return unknown(entity);
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  return zohoOrgScoped(req, async () => {
    try { return NextResponse.json(await deleteRecord(entity as EntityName, id, auth.session.username)); } catch (e) { return zohoError(e); }
  });
}
