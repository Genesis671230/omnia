import { NextResponse } from "next/server";
import { ENTITIES, RECORD_ACTIONS, scopeAllows, type EntityName } from "@/lib/integrations/zoho-books-actions";
import { getScopedAccessToken, getZohoConnection, zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { zohoConnectionId } from "@/lib/integrations/zoho-context";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/zoho/books?zohoOrg= — what the generic Zoho Books layer can do in
// this organisation: every entity, its operations and record actions, whether
// the connection's OAuth scopes allow it, and its last sync.
export async function GET(req: Request) {
  return zohoOrgScoped(req, async () => {
    // A refresh reports the granted scopes; make sure they are known.
    await getScopedAccessToken().catch(() => undefined);
    const conn = await getZohoConnection(zohoConnectionId());
    const scopes = conn?.scopes ?? "";
    const { data: cursors } = await supabase.from("zoho_sync_cursors").select("entity, last_run_at, last_count, last_error").eq("connection_id", zohoConnectionId());
    const cur = new Map((cursors ?? []).map((c) => [c.entity as string, c]));
    return NextResponse.json({
      organisation: conn ? { id: conn.id, label: conn.label, orgId: conn.orgId } : null,
      scopesKnown: Boolean(scopes),
      entities: (Object.keys(ENTITIES) as EntityName[]).map((name) => {
        const d = ENTITIES[name];
        return {
          name, label: d.label, idField: d.idField, scope: d.scope, incremental: d.incremental,
          locked: !scopeAllows(scopes, name),
          operations: ["list", "get", ...(d.write ? ["create", "update"] : []), ...(d.del ? ["delete"] : []), "sync"],
          actions: Object.entries((RECORD_ACTIONS as Record<string, Record<string, { label: string }>>)[name] ?? {}).map(([k, v]) => ({ name: k, label: v.label })),
          lastSync: cur.get(name) ?? null,
        };
      }),
    });
  });
}
