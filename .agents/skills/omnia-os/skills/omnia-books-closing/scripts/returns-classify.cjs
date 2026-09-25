// node returns-classify.cjs <workdir with month-sheet.json> ; MONTH=09 MON=Sep YEAR=2026
const fs=require("fs"),path=require("path");const W=process.argv[2]||".";const MM=process.env.MONTH||"09",MON=process.env.MON||"Sep",YYYY=process.env.YEAR||"2026";
const d=require(path.resolve(W,"month-sheet.json"));
const num=v=>{const n=parseFloat(String(v??"").replace(/,/g,""));return isNaN(n)?0:n};
const dayOf=s=>{s=String(s||"");let m=s.match(new RegExp("^"+YYYY+"-(\\d\\d)-(\\d\\d)"));if(m)return m[1]===MM?+m[2]:null;m=s.match(new RegExp("(\\d{1,2})\\s*[.\\s-]\\s*"+MON,"i"));return m?+m[1]:null};
const cls=(txt,type)=>{const t=(txt+" "+type).toLowerCase();const out=[];
  if(/exchang/.test(t))out.push("Exchange");
  if(/cancel|canceled bd/.test(t))out.push("Cancelled");
  if(/return/.test(t)&&/refund/.test(t))out.push("Returned & Refunded");
  else if(/refund/.test(t))out.push("Refund only");
  else if(/return/.test(t)&&!out.includes("Cancelled"))out.push("Returned");
  return out};
const rows=[];
// Local
{const v=d[" Local orders"];for(const r of v.slice(1)){const day=dayOf(r[3]);const o=(r[4]||"").trim();if(!day||!o)continue;
 const txt=[r[11],r[15],r[24]].join(" ");const type=[r[6],r[8],r[12]].join(" ");
 rows.push({src:"Local",day,date:`${String(day).padStart(2,"0")}.${MM}.${YYYY}`,order:o,total:num(r[7]),ccy:"AED",aed:num(r[7]),party:r[8],comments:(r[11]||"").trim(),typeOfSale:r[6],deliveryBy:(r[13]||"").trim(),actual:(r[15]||"").trim(),received:(r[16]||"").trim(),ot:(r[17]||"").trim(),fee:num(r[19]),after:num(r[20]),cancelAmt:num(r[21]),kinds:cls(txt,type)});}}
// International
{const v=d["SMSA Orders"];for(const r of v.slice(1)){const day=dayOf(r[2]);const o=(r[3]||"").trim();if(!day||!o)continue;
 const txt=[r[11],r[13],r[10]].join(" ");const type=[r[8],r[12]].join(" ");
 rows.push({src:"International",day,date:`${String(day).padStart(2,"0")}.${MM}.${YYYY}`,order:o,total:num(r[4]),ccy:r[5],aed:num(r[6]),party:r[7],comments:(r[11]||"").trim(),typeOfSale:r[8],deliveryBy:(r[10]||"").trim(),actual:(r[13]||"").trim(),received:(r[14]||"").trim(),fee:num(r[16]),after:num(r[17]),cancelAmt:num(r[18]),refundDate:(r[21]||"").trim(),kinds:cls(txt,type)});}}
fs.writeFileSync(path.resolve(W,"sheetrows.json"),JSON.stringify(rows));
const ev=rows.filter(r=>r.kinds.length);
const K=["Exchange","Cancelled","Returned & Refunded","Refund only","Returned"];
const agg=(filter)=>{const o={};for(const s of ["Local","International"])for(const k of K){const l=ev.filter(r=>r.src===s&&r.kinds.includes(k)&&filter(r));o[s+"|"+k]={n:l.length,amt:+l.reduce((a,r)=>a+(r.cancelAmt||(k==="Exchange"?r.aed:0)),0).toFixed(2)}}return o};
const T=+(process.env.TODAY||new Date().getDate());console.log("TODAY",agg(r=>r.day===T));console.log("YEST",agg(r=>r.day===T-1));console.log("SEPT",agg(()=>true));
console.log("total rows",rows.length,"local",rows.filter(r=>r.src==="Local").length,"intl",rows.filter(r=>r.src==="International").length);
const db=[...new Set(rows.filter(r=>r.src==="Local").map(r=>r.deliveryBy.toLowerCase().replace(/\s/g,"")))];console.log("deliveryBy",db.slice(0,30));
console.log("today/yest events",ev.filter(r=>r.day>=T-1).map(r=>`${r.day} ${r.src} ${r.order} ${r.kinds} ${r.comments} ${r.typeOfSale} amt ${r.cancelAmt||r.aed}`).join("\n"));
