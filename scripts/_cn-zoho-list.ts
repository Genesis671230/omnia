// Every credit note in each Zoho org dated/created since FROM, with who created it (history). Read-only.
import { listZohoConnections, withZohoOrg } from "@/lib/integrations/zoho-org";
import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoBooksBase, zohoOrgId } from "@/lib/integrations/zoho-context";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
const fs = require("fs");
const [FROM, out] = process.argv.slice(2);
const get = async (path: string) => {
  const u = new URL(`${zohoBooksBase()}${path}`); u.searchParams.set("organization_id", zohoOrgId());
  const r = await zohoThrottledFetch(u.toString(), { headers: { Authorization: `Zoho-oauthtoken ${await getAccessToken()}` }, cache: "no-store" });
  return r.json();
};
(async () => {
  const res: any[] = [];
  for (const c of (await listZohoConnections()).filter((c) => c.status !== "disabled")) {
    await withZohoOrg(c.id, async () => {
      for (let page = 1; page < 20; page++) {
        const j = await get(`/creditnotes?date_start=${FROM}&per_page=200&page=${page}&sort_column=date`);
        for (const n of j.creditnotes ?? []) res.push({ org: c.id, orgLabel: c.label, id: n.creditnote_id, number: n.creditnote_number, date: n.date, ref: n.reference_number, customer: n.customer_name, total: n.total, balance: n.balance, status: n.status, created_time: n.created_time });
        if (!j.page_context?.has_more_page) break;
      }
      // who created each: first history entry
      for (const n of res.filter((x) => x.org === c.id)) {
        const h = await get(`/creditnotes/${n.id}/comments`);
        const cr = (h.comments ?? []).filter((x: any) => /created/i.test(x.description ?? "")).pop();
        n.created_by = cr?.commented_by ?? "";
        n.touched_by = [...new Set((h.comments ?? []).map((x: any) => x.commented_by))].join(", ");
      }
    });
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  const m = new Map<string, number>(); for (const n of res) m.set(`${n.orgLabel}|${n.created_by}`, (m.get(`${n.orgLabel}|${n.created_by}`) ?? 0) + 1);
  console.log(res.length, m);
})().catch((e) => { console.error(e); process.exit(1); });
