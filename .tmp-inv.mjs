import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data } = await sb.from("settlement_records").select("gateway, zoho_payment_id, zoho_post_error, fx_difference_aed, zoho_fx_journal_id, zoho_invoice_status, order_currency, evidence_confirmed").limit(5000);
const by = {};
for (const s of data) {
  const g = s.gateway || "?";
  by[g] ??= { total:0, booked:0, unbooked:0, withErr:0, fx:0, fxNoJournal:0, confirmed:0 };
  const b = by[g]; b.total++;
  if (s.evidence_confirmed) b.confirmed++;
  const real = s.zoho_payment_id && !/^(CLAIMED|PENDING):/.test(s.zoho_payment_id);
  if (real) b.booked++; else b.unbooked++;
  if (s.zoho_post_error) b.withErr++;
  if (s.fx_difference_aed) { b.fx++; if (!s.zoho_fx_journal_id) b.fxNoJournal++; }
}
console.log("gateway  total confirmed booked unbooked postErr  fxDiff fxNoJournal");
for (const [g,b] of Object.entries(by)) console.log(g.padEnd(9), String(b.total).padStart(5), String(b.confirmed).padStart(9), String(b.booked).padStart(6), String(b.unbooked).padStart(8), String(b.withErr).padStart(7), String(b.fx).padStart(7), String(b.fxNoJournal).padStart(11));
console.log("\n--- distinct post errors (Stripe) ---");
const errs = {};
for (const s of data.filter(x=>x.gateway==='Stripe'&&x.zoho_post_error)) { const k=s.zoho_post_error.slice(0,110); errs[k]=(errs[k]||0)+1; }
for (const [k,v] of Object.entries(errs).sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(String(v).padStart(4), k);
