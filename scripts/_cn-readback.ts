import { withZohoOrg } from "@/lib/integrations/zoho-org";
import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoBooksBase, zohoOrgId } from "@/lib/integrations/zoho-context";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
const fs = require("fs");
const [inp, out] = process.argv.slice(2);
const get = async (path: string) => {
  const u = new URL(`${zohoBooksBase()}${path}`); u.searchParams.set("organization_id", zohoOrgId());
  const r = await zohoThrottledFetch(u.toString(), { headers: { Authorization: `Zoho-oauthtoken ${await getAccessToken()}` }, cache: "no-store" });
  return r.json();
};
(async () => {
  const rows = JSON.parse(fs.readFileSync(inp, "utf8")).filter((r: any) => r.cn_id && !String(r.cn_id).startsWith("PENDING"));
  for (const r of rows) {
    try {
      await withZohoOrg(r.org === "" ? "env" : r.org, async () => {
        const j = await get(`/creditnotes/${r.cn_id}`);
        const c = j.creditnote;
        if (!c) { r.zoho = { missing: true, message: j.message }; return; }
        const h = await get(`/creditnotes/${r.cn_id}/comments`);
        const created = (h.comments ?? []).filter((x: any) => /created/i.test(x.description ?? "")).pop();
        r.zoho = {
          number: c.creditnote_number, date: c.date, customer: c.customer_name, reference: c.reference_number, total: c.total, balance: c.balance, status: c.status,
          created_by: created?.commented_by ?? c.created_by_name ?? "", created_time: c.created_time,
          applied: (c.invoices_credited ?? []).map((i: any) => `${i.invoice_number} ${i.amount_applied ?? i.amount}`),
          refunds: (c.creditnote_refunds ?? []).map((x: any) => `${x.date} ${x.amount ?? x.amount_bcy}`),
          lines: (c.line_items ?? []).map((l: any) => ({ name: l.name, sku: l.sku ?? "", qty: Number(l.quantity), rate: Number(l.rate), total: Number(l.item_total), warehouse: l.warehouse_name ?? "", type: l.item_type ?? l.product_type ?? "",
            components: (l.mapped_items ?? []).map((m: any) => `${m.quantity}× ${m.name}`).join(", ") })),
          history: (h.comments ?? []).map((x: any) => `${x.date ?? ""} ${x.commented_by ?? ""}: ${x.description ?? ""}`),
        };
      });
    } catch (e) { r.zoho = { error: (e as Error).message }; }
  }
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  console.log("read", rows.length, "missing", rows.filter((r: any) => r.zoho?.missing).length, "errors", rows.filter((r: any) => r.zoho?.error).length);
})();
