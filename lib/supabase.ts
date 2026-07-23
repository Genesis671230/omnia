import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to reach the database.",
      );
    }
    client = createClient(url, key);
  }
  return client;
}

// Lazy proxy — the client is constructed on first property access rather than
// at module load. Call sites (`supabase.from(...)`) are unchanged.
//
// Why: modules that talk to the database also export pure logic — most
// importantly computeReconLines() in lib/reconciliation/engine.ts, which is
// deliberately IO-free so the bank→payout→order money math can be fixture
// tested. Constructing the client eagerly made merely *importing* that pure
// function throw without live credentials, so every reconciliation and
// settlement test failed for want of a database it never actually used.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getClient();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
