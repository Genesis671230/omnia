import { NextResponse } from "next/server";
import { zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { createRecord, entityDef, listRecords, zohoError, type EntityName } from "@/lib/integrations/zoho-books-actions";
import { requireRole } from "@/lib/auth/session-role";

// GET  /api/zoho/books/:entity?zohoOrg=&page=&perPage=&search=&<zoho filter>=…   list
// POST /api/zoho/books/:entity?zohoOrg=   { …Zoho Books JSON body }             create (admin / finance)

type Ctx = { params: Promise<{ entity: string }> };


export async function GET(req: Request, { params }: Ctx) {
  const { entity } = await params;
  if (!entityDef(entity)) return NextResponse.json({ error: `Unknown entity "${entity}"` }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const filters: Record<string, string> = {};
  for (const [k, v] of q) if (!["zohoOrg", "page", "perPage", "search"].includes(k)) filters[k] = v;
  return zohoOrgScoped(req, async () => {
    try {
      return NextResponse.json(await listRecords(entity as EntityName, { page: Number(q.get("page")) || 1, perPage: Number(q.get("perPage")) || 50, search: q.get("search") ?? undefined, filters }));
    } catch (e) { return zohoError(e); }
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { entity } = await params;
  if (!entityDef(entity)) return NextResponse.json({ error: `Unknown entity "${entity}"` }, { status: 404 });
  const auth = await requireRole("admin", "finance");
  if ("denied" in auth) return auth.denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Send the Zoho record as a JSON object" }, { status: 400 });
  return zohoOrgScoped(req, async () => {
    try { return NextResponse.json({ record: await createRecord(entity as EntityName, body, auth.session.username) }); } catch (e) { return zohoError(e); }
  });
}
