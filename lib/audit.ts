import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { currentTenant } from "@/lib/tenant";

const SECRET_KEY = /secret|token|password/i;

/** Copy of `obj` with every secret-looking key replaced by "••••". */
export function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k)) out[k] = "••••";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redactSecrets(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

/** Append one row to audit_logs. Never throws — an audit failure is logged,
 *  not allowed to undo the change it describes. */
export async function writeAudit(e: { entity: string; entityId: string; event: string; actor: string; payload: Record<string, unknown> }): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    id: randomUUID(),
    tenant_id: currentTenant(),
    entity: e.entity,
    entity_id: e.entityId,
    event: e.event,
    actor_id: e.actor,
    payload: redactSecrets(e.payload),
  });
  if (error) console.error(`[audit] ${e.entity}/${e.entityId} ${e.event} not recorded: ${error.message}`);
}
