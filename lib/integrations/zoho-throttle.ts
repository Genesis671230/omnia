// Single chokepoint for every outbound Zoho API call.
//
// Zoho's plan caps us at ~5,000 API requests per calendar day (org-wide,
// shared across Books + Inventory). Before this module, calls were made
// with a bare `fetch` from a dozen call sites, so one bad page load or a
// stuck poll could quietly burn the whole day's budget and take
// reconciliation + invoicing down until midnight UTC.
//
// zohoThrottledFetch() enforces three things for the whole Node process:
//   1. Serialised, min-gap pacing  — no bursts, at most ~1 call / GAP ms.
//   2. A hard daily budget         — a Postgres counter (zoho_api_usage),
//      atomic via the zoho_consume_quota() function, so it survives across
//      serverless invocations and multiple instances. Over budget → throws
//      ZohoQuotaExceededError instead of hitting Zoho.
//   3. 429 back-off                — honours Retry-After, a few retries.
//
// The OAuth token refresh (accounts.zoho.com) is deliberately NOT metered
// here: it's a different host with its own limit, it's cached ~55min, and
// counting it would waste real quota headroom.

import { supabase } from "@/lib/supabase";

const MIN_GAP_MS = Number(process.env.ZOHO_MIN_GAP_MS ?? 150);
const DAILY_BUDGET = Number(process.env.ZOHO_DAILY_BUDGET ?? 7000);
const MAX_429_RETRIES = Number(process.env.ZOHO_MAX_429_RETRIES ?? 3);

export class ZohoQuotaExceededError extends Error {
  readonly used: number;
  readonly budget: number;
  constructor(used: number, budget: number) {
    super(
      `Zoho daily API budget reached (${used < 0 ? "?" : used}/${budget}). ` +
        `Further Zoho calls are blocked until 00:00 UTC. ` +
        `Raise ZOHO_DAILY_BUDGET if this is expected.`,
    );
    this.name = "ZohoQuotaExceededError";
    this.used = used;
    this.budget = budget;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Process-wide serialisation: every call chains off the previous one so we
// never fire two Zoho requests concurrently and always leave MIN_GAP_MS
// between them.
let tail: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

// Reserve one unit of today's budget. Returns the running count on success,
// or throws ZohoQuotaExceededError when the budget is spent. If the DB call
// itself fails we log and allow the request — a monitoring blip must not
// wedge invoicing.
async function reserveDailyQuota(label: string): Promise<number> {
  try {
    // The label rides along on the same RPC that reserves the unit, so the
    // per-endpoint counters always sum to the day's total. Before this, the
    // label existed but was only ever printed in a 429 warning — which meant
    // "where did 5,000 calls go?" could only be answered by reading every
    // call site by hand.
    const { data, error } = await supabase.rpc("zoho_consume_quota", {
      p_limit: DAILY_BUDGET,
      p_label: label,
    });
    if (error) {
      console.error("[zoho-throttle] quota rpc failed, allowing call:", error.message);
      return -1;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const allowed = row?.allowed ?? true;
    const used = Number(row?.used ?? -1);
    if (!allowed) throw new ZohoQuotaExceededError(used, DAILY_BUDGET);
    return used;
  } catch (e) {
    if (e instanceof ZohoQuotaExceededError) throw e;
    console.error("[zoho-throttle] quota check threw, allowing call:", e);
    return -1;
  }
}

/**
 * A label for a call that did not supply one, derived from what it is actually
 * asking Zoho for.
 *
 * Hand-labelling 21 call sites was the obvious move and the wrong one: the
 * generic wrappers (zohoFetch, books(), booksFetch) each serve a dozen
 * endpoints, so a per-site label would have lumped them together, and the next
 * call site added would arrive unlabelled again. Deriving from the URL means
 * attribution cannot drift out of date, and "unlabelled" stops existing.
 *
 *   GET  /books/v3/invoices?...              → books.invoices.list
 *   GET  /books/v3/invoices/90300123/        → books.invoices.get
 *   POST /books/v3/customerpayments          → books.customerpayments.create
 *   PUT  /inventory/v1/items/551/            → inventory.items.update
 */
export function deriveZohoLabel(input: string | URL, init?: RequestInit): string {
  let path: string;
  try {
    path = new URL(String(input)).pathname;
  } catch {
    return "unparsed";
  }

  const parts = path.split("/").filter(Boolean);
  // Drop the API family's version segment: books/v3/... → books/...
  const api = parts.shift() ?? "zoho";
  if (parts[0] && /^v\d+$/i.test(parts[0])) parts.shift();

  const resource = parts.shift() ?? "root";
  // Anything after the resource that looks like an id means "one of these".
  const rest = parts.filter((p) => p.length > 0);
  const byId = rest.some((p) => /^\d{5,}$/.test(p) || /^[0-9a-f-]{16,}$/i.test(p));

  const method = (init?.method ?? "GET").toUpperCase();
  const verb =
    method === "POST" ? "create"
    : method === "PUT" ? "update"
    : method === "DELETE" ? "delete"
    : byId ? "get"
    : "list";

  // Sub-resource (…/invoices/123/payments) is worth keeping; ids are not.
  const sub = rest.filter((p) => !/^\d{5,}$/.test(p) && !/^[0-9a-f-]{16,}$/i.test(p));
  const tail = sub.length ? `.${sub.join(".")}` : "";

  return `${api}.${resource}${tail}.${verb}`.slice(0, 120);
}

export type ZohoFetchOpts = {
  /** Skip the daily-budget counter (OAuth refresh, health checks). Pacing still applies. */
  skipQuota?: boolean;
  /** Overrides the URL-derived label. Only worth setting when one endpoint
   *  serves two purposes worth telling apart in the usage table. */
  label?: string;
};

export async function zohoThrottledFetch(
  input: string | URL,
  init?: RequestInit,
  opts: ZohoFetchOpts = {},
): Promise<Response> {
  const run = async (): Promise<Response> => {
    const gap = MIN_GAP_MS - (Date.now() - lastCallAt);
    if (gap > 0) await sleep(gap);

    if (!opts.skipQuota) {
      const used = await reserveDailyQuota(opts.label ?? deriveZohoLabel(input, init));
      if (used >= 0 && used % 250 === 0) {
        console.warn(`[zoho-throttle] ${used}/${DAILY_BUDGET} Zoho calls used today`);
      }
    }

    let attempt = 0;
    for (;;) {
      lastCallAt = Date.now();
      const res = await fetch(input, init);
      if (res.status !== 429 || attempt >= MAX_429_RETRIES) return res;
      attempt += 1;
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      console.warn(
        `[zoho-throttle] 429 on ${opts.label ?? String(input)} — retry ${attempt}/${MAX_429_RETRIES} in ${waitMs}ms`,
      );
      await sleep(waitMs);
    }
  };

  // Chain onto the tail regardless of whether the previous call resolved or
  // rejected, so one failure doesn't stall the queue.
  const result = tail.then(run, run);
  tail = result.catch(() => undefined);
  return result;
}

/** Today's Zoho usage, for a status endpoint / dashboard. Never throws. */
export async function zohoQuotaStatus(): Promise<{ used: number; budget: number } | null> {
  try {
    const { data, error } = await supabase
      .from("zoho_api_usage")
      .select("request_count")
      .eq("usage_date", new Date().toISOString().slice(0, 10))
      .maybeSingle();
    if (error) return null;
    return { used: Number(data?.request_count ?? 0), budget: DAILY_BUDGET };
  } catch {
    return null;
  }
}

/** Today's spend broken down by call site, biggest first — the view that
 *  turns "the budget is gone" into "this endpoint spent it". Never throws. */
export async function zohoQuotaByLabel(
  date = new Date().toISOString().slice(0, 10),
): Promise<{ label: string; count: number }[]> {
  try {
    const { data, error } = await supabase
      .from("zoho_api_usage_labels")
      .select("label, request_count")
      .eq("usage_date", date)
      .order("request_count", { ascending: false });
    if (error) return [];
    return (data ?? []).map((r) => ({ label: String(r.label), count: Number(r.request_count) }));
  } catch {
    return [];
  }
}
