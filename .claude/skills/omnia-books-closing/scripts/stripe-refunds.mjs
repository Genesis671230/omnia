// ENV_FILE=.env.local SINCE=YYYY-MM-DD node stripe-refunds.mjs  → stripe-refunds.json (charge ccy, refund ccy, rate): proves whether a refund gap is FX or a short refund
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE||".env.local","utf8").split("\n").filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,"")]}));
const keys = Object.keys(env).filter(k=>/^STRIPE.*(SECRET|KEY)/.test(k)); console.log("keys",keys);
const out=[];
for (const k of keys) {
  const key=env[k]; if(!/^(sk|rk)_/.test(key)) continue;
  let url=`https://api.stripe.com/v1/refunds?limit=100&created[gte]=${Math.floor(Date.parse(process.env.SINCE||"2026-08-20")/1000)}&expand[]=data.charge&expand[]=data.balance_transaction`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${key}`}}); const j=await r.json();
  if(j.error){console.log(k,j.error.message);continue;}
  for(const f of j.data){const c=f.charge||{};const bt=f.balance_transaction||{};
    out.push({acct:k,created:new Date(f.created*1000).toISOString().slice(0,10),desc:c.description,refundAmt:f.amount/100,refundCur:f.currency,chargeAmt:c.amount/100,chargeCur:c.currency,amountRefunded:c.amount_refunded/100,btAmt:bt.amount/100,btCur:bt.currency,btFee:bt.fee/100,rate:bt.exchange_rate,reason:f.reason,status:f.status,meta:f.metadata});}
}
fs.writeFileSync("stripe-refunds.json",JSON.stringify(out,null,1));
for(const o of out)console.log(o.created,o.desc,"| refund",o.refundAmt,o.refundCur,"of charge",o.chargeAmt,o.chargeCur,"(refunded total",o.amountRefunded+")","| balance",o.btAmt,o.btCur,"fee",o.btFee,"rate",o.rate,o.status);
