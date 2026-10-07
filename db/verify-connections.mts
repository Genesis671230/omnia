// Release-1 gate: what the env-based code resolves must equal what the DB
// resolves, and every connection must be healthy.
//   npx tsx db/verify-connections.mts            → exit 0 when everything matches
import { config } from "dotenv";
import { listConnections } from "@/lib/connectors";
import { describeSettings } from "@/lib/settings";
import { SETTINGS } from "@/lib/settings/registry";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const env = process.env;
const problems: string[] = [];
const conns = await listConnections(undefined, { includeDisabled: true });

for (const code of (env.SHOPIFY_STORE_CODES || "WA,UAE,KSA,MAIN").split(",").map((c) => c.trim().toUpperCase())) {
  const url = env[`SHOPIFY_${code}_URL`], token = env[`SHOPIFY_${code}_TOKEN`];
  if (!url || !token) continue;
  const c = conns.find((x) => x.provider === "shopify" && (x.config as { store_id?: string }).store_id === code);
  if (!c) { problems.push(`shopify ${code}: in .env, not in connections`); continue; }
  if (new URL(url).hostname.toLowerCase() !== c.accountRef) problems.push(`shopify ${code}: domain differs (${c.accountRef})`);
  if (c.authMode === "token" && c.secrets.access_token !== token) problems.push(`shopify ${code}: token differs from .env`);
}
for (const mailbox of String(env.GMAIL_USER || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
  if (!conns.some((c) => c.provider === "gmail" && c.accountRef === mailbox)) problems.push(`gmail ${mailbox}: in .env, not in connections`);
}
if (env.ZOHO_ORGANIZATION_ID) {
  const z = conns.find((c) => c.id === "env");
  if (!z) problems.push("zoho main org: no connection with id 'env'");
  else if (z.accountRef !== env.ZOHO_ORGANIZATION_ID) problems.push(`zoho main org: org id ${z.accountRef} ≠ .env ${env.ZOHO_ORGANIZATION_ID}`);
}
for (const s of await describeSettings()) {
  const d = SETTINGS.find((x) => x.key === s.key)!;
  if (d.legacyEnv && env[d.legacyEnv] && s.source !== "database") problems.push(`setting ${s.key}: still read from ${s.source} (${d.legacyEnv})`);
}
for (const c of conns) if (c.status === "error" || c.status === "needs_reauth") problems.push(`${c.id}: ${c.status}${c.lastError ? ` — ${c.lastError}` : ""}`);

console.log(problems.length ? `✗ ${problems.length} problem(s):\n  ${problems.join("\n  ")}` : `✓ connections and settings match .env (${conns.length} connections)`);
process.exit(problems.length ? 1 : 0);
