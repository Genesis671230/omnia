// A month's sales documents from every active Zoho organisation: sales
// orders, invoices and credit notes (void ones are told apart later). ~20 calls for a month of Omniastores; read only when someone asks
// for a verification, never on a page load.

import { getAccessToken } from "./zoho";
import { zohoBooksBase, zohoOrgId } from "./zoho-context";
import { listZohoConnections, withZohoOrg } from "./zoho-org";
import { zohoThrottledFetch } from "./zoho-throttle";
import type { ZohoDoc } from "@/lib/finance/zoho-sales-verify";

const KINDS = [
  { kind: "salesorder", path: "salesorders", list: "salesorders", id: "salesorder_id", number: "salesorder_number" },
  { kind: "invoice", path: "invoices", list: "invoices", id: "invoice_id", number: "invoice_number" },
  { kind: "creditnote", path: "creditnotes", list: "creditnotes", id: "creditnote_id", number: "creditnote_number" },
] as const;

async function listKind(k: (typeof KINDS)[number], orgLabel: string, fromDay: string, toDay: string): Promise<{ docs: ZohoDoc[]; calls: number }> {
  const token = await getAccessToken();
  const docs: ZohoDoc[] = [];
  let calls = 0;
  for (let page = 1; page <= 40; page++) {
    // No filter_by: Zoho drops date_start/date_end when filter_by=Status.All
    // is sent (verified 2026-10-01 — it returned invoices back to 2022).
    const qs = new URLSearchParams({ organization_id: zohoOrgId(), date_start: fromDay, date_end: toDay, per_page: "200", page: String(page) });
    const res = await zohoThrottledFetch(`${zohoBooksBase()}/${k.path}?${qs}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: "no-store" });
    calls += 1;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { code?: number; message?: string; page_context?: { has_more_page?: boolean } };
    if (!res.ok || json.code !== 0) throw new Error(`Zoho ${k.path} HTTP ${res.status}: ${json.message ?? "error"}`);
    for (const r of (json[k.list] ?? []) as Record<string, unknown>[]) {
      docs.push({
        kind: k.kind, org: orgLabel, id: String(r[k.id]), number: String(r[k.number] ?? ""),
        reference: String(r.reference_number ?? ""), customer: String(r.customer_name ?? ""), date: String(r.date ?? ""),
        status: String(r.status ?? ""), total: Number(r.total ?? 0), balance: Number(r.balance ?? 0),
      });
    }
    if (!json.page_context?.has_more_page) break;
  }
  return { docs, calls };
}

export async function fetchSalesDocs(fromDay: string, toDay: string, only?: ZohoDoc["kind"][]): Promise<{ docs: ZohoDoc[]; calls: number; orgs: { id: string; label: string; error?: string }[] }> {
  const conns = (await listZohoConnections()).filter((c) => c.status !== "disabled");
  const docs: ZohoDoc[] = [];
  const orgs: { id: string; label: string; error?: string }[] = [];
  let calls = 0;
  for (const c of conns) {
    try {
      await withZohoOrg(c.id, async () => {
        for (const k of KINDS.filter((x) => !only || only.includes(x.kind))) {
          const r = await listKind(k, c.label, fromDay, toDay);
          docs.push(...r.docs);
          calls += r.calls;
        }
      });
      orgs.push({ id: c.id, label: c.label });
    } catch (e) {
      orgs.push({ id: c.id, label: c.label, error: (e as Error).message });
    }
  }
  return { docs, calls, orgs };
}
