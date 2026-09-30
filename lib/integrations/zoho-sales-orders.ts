// Which orders already have a Zoho sales order. Staff create one per order
// (numbered with the order number itself, e.g. OS4014 / WA55941), in whichever
// organisation sells it — so every active organisation is read. Numbers only:
// the Orders page's "Not in Zoho" tab is a to-do list for the team.

import { getAccessToken } from "./zoho";
import { zohoBooksBase, zohoOrgId } from "./zoho-context";
import { listZohoConnections, withZohoOrg } from "./zoho-org";
import { zohoThrottledFetch } from "./zoho-throttle";

const CACHE_MS = 10 * 60 * 1000;
const MAX_PAGES = 25; // 5,000 sales orders per org per window — far above a month
const cache = new Map<string, { at: number; value: SalesOrderIndex }>();

export type SalesOrderIndex = {
  /** Upper-cased sales order numbers (and reference numbers) across orgs. */
  numbers: Set<string>;
  orgs: { id: string; label: string; count: number; error?: string }[];
};

const norm = (s: string | null | undefined) => String(s ?? "").trim().replace(/^#/, "").toUpperCase();

async function salesOrderNumbersInOrg(fromDay: string, toDay: string): Promise<string[]> {
  const token = await getAccessToken();
  const out: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      organization_id: zohoOrgId(), date_start: fromDay, date_end: toDay, per_page: "200", page: String(page),
    });
    const res = await zohoThrottledFetch(`${zohoBooksBase()}/salesorders?${qs}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      code?: number; message?: string;
      salesorders?: { salesorder_number?: string; reference_number?: string }[];
      page_context?: { has_more_page?: boolean };
    };
    if (!res.ok || json.code !== 0) throw new Error(`Zoho sales orders HTTP ${res.status}: ${json.message ?? "error"}`);
    for (const so of json.salesorders ?? []) {
      if (so.salesorder_number) out.push(norm(so.salesorder_number));
      if (so.reference_number) out.push(norm(so.reference_number));
    }
    if (!json.page_context?.has_more_page) break;
  }
  return out;
}

/** Sales orders dated fromDay..toDay (a few days either side is sensible:
 *  staff may date the sales order the day after the order). */
export async function salesOrderIndex(fromDay: string, toDay: string): Promise<SalesOrderIndex> {
  const key = `${fromDay}|${toDay}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const conns = (await listZohoConnections()).filter((c) => c.status !== "disabled");
  const numbers = new Set<string>();
  const orgs: SalesOrderIndex["orgs"] = [];
  for (const c of conns) {
    try {
      const list = await withZohoOrg(c.id, () => salesOrderNumbersInOrg(fromDay, toDay));
      list.forEach((n) => n && numbers.add(n));
      orgs.push({ id: c.id, label: c.label, count: list.length });
    } catch (e) {
      orgs.push({ id: c.id, label: c.label, count: 0, error: (e as Error).message });
    }
  }
  const value = { numbers, orgs };
  // A failed org would make every order look missing — don't cache that.
  if (orgs.every((o) => !o.error)) cache.set(key, { at: Date.now(), value });
  return value;
}

/** An order counts as in Zoho when a sales order carries its number, with or
 *  without the store prefix (numeric Woo-era orders were sometimes entered bare). */
export function hasSalesOrder(index: SalesOrderIndex, orderNumber: string): boolean {
  const n = norm(orderNumber);
  return index.numbers.has(n) || index.numbers.has(n.replace(/^(WA|UAE|KSA|WOO|SA|OS)/, ""));
}
