// Copy .env + legacy zoho_connections into connections / workspace_settings.
//   npx tsx db/import-connections.mts --dry-run   (prints, writes nothing)
//   npx tsx db/import-connections.mts             (insert-only; safe to re-run)
// The server also runs this once at boot (instrumentation.ts).
import { config } from "dotenv";
import { importFromEnv, readLegacyZohoRows } from "@/lib/connectors/importer";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const dryRun = process.argv.includes("--dry-run");
const report = await importFromEnv(process.env, await readLegacyZohoRows(), { dryRun });
console.log(JSON.stringify({ dryRun, ...report }, null, 2));
