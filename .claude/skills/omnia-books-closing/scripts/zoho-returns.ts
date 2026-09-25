// Zoho side of returns/exchanges: credit notes, credit-note refunds, void invoices for a range.
// Credit note list gives total/balance, enough to classify: total 0 = exchange (stock-only
// return), balance > 0 = return with refund pending, else refunded/applied. The refunds
// endpoint ignores the date filter, so it is filtered locally by date.
//   FROM=2026-09-01 TO=2026-09-30 npx tsx --env-file=.env.local scripts/_zoho-returns.ts <out/zoho-returns.json>
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
const ORG = process.env.ZOHO_ORGANIZATION_ID!;
const FROM = process.env.FROM!, TO = process.env.TO ?? new Date().toISOString().slice(0, 10);
async function all(t: string, path: string, key: string) {
  const out: any[] = [];
  for (let p = 1; p <= 20; p++) {
    const r = await zohoThrottledFetch(`https://www.zohoapis.com/books/v3/${path}&organization_id=${ORG}&per_page=200&page=${p}`, { headers: { Authorization: `Zoho-oauthtoken ${t}` }, cache: "no-store" });
    const j = await r.json(); if (j.code !== 0) { console.log(path, j.message); break; }
    out.push(...(j[key] ?? [])); if (!j.page_context?.has_more_page) break;
  }
  return out;
}
(async () => {
  if (!FROM) throw new Error("set FROM=YYYY-MM-DD");
  const t = await getAccessToken();
  const creditnotes = await all(t, `creditnotes?date_start=${FROM}&date_end=${TO}`, "creditnotes");
  const cnRefunds = (await all(t, `creditnotes/refunds?date_start=${FROM}&date_end=${TO}`, "creditnote_refunds"))
    .filter((x) => x.date >= FROM && x.date <= TO);
  const voids = await all(t, `invoices?filter_by=Status.Void&date_start=${FROM}&date_end=${TO}`, "invoices");
  writeFileSync(process.argv[2], JSON.stringify({ creditnotes, cnRefunds, voids }));
  console.log("credit notes", creditnotes.length, "refunds", cnRefunds.length, "void invoices", voids.length);
})();
