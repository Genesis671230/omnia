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
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getClient();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});

/** PostgREST caps an unpaginated select at 1000 rows and reports no error when
 *  it truncates — you simply get 1000 rows and a silently incomplete answer.
 *
 *  That bit hard: payout_transactions passed 1000 rows and the reconciler
 *  stopped seeing the order refs of the most recently uploaded payouts. Files
 *  uploaded fine, parsed fine, stored fine, and then showed zero orders on
 *  screen with no error anywhere.
 *
 *  Use this for every read that means "the whole table". Pass a function that
 *  applies your filters and returns the query for one page.
 *
 *    const rows = await selectAllPages((from, to) =>
 *      supabase.from("payout_transactions").select("payout_id, order_ref").range(from, to));
 */
export async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label = "select",
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(`${label} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
