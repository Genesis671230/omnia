// node returns-report.cjs <workdir with sheetrows.json, zoho-returns.json> <out.xlsx> ; MONTH=09 YEAR=2026 TODAY=24
const path=require("path");const W=process.argv[2]||".";const OUTX=process.argv[3]||"returns-report.xlsx";const MM=process.env.MONTH||"09",YYYY=process.env.YEAR||"2026",T=+(process.env.TODAY||new Date().getDate());
const ExcelJS=require(require.resolve("exceljs",{paths:[process.cwd()]}));
const rows=require(path.resolve(W,"sheetrows.json"));const z=require(path.resolve(W,"zoho-returns.json"));
const r2=n=>Math.round(n*100)/100;
const amtFromText=t=>{const m=String(t).match(/([\d,]+\.?\d*)\s*(SAR|AED)?/i);return m?[parseFloat(m[1].replace(/,/g,"")),(m[2]||"AED").toUpperCase()]:[0,""]};
for(const r of rows){ // amount per kind
  if(r.kinds.includes("Refund only")&&!r.cancelAmt){const [a,c]=amtFromText(r.comments.replace(/^\D*/,""));r.refundTxt=a?`${a} ${c}`:"";r.eventAmt=c==="SAR"?r2(a*0.98):a;}
  else r.eventAmt=r.cancelAmt||0;
  if(r.kinds.includes("Exchange"))r.topup=r.aed;
}
const bySrc=new Map();rows.forEach(r=>{if(!bySrc.has(r.order))bySrc.set(r.order,r.src)});
const ordKey=s=>String(s||"").trim().split(/\s+/)[0];
const cnDay=c=>+c.date.slice(8,10);
const cnType=c=>c.total===0?"Exchange":(c.balance>0?"Return, refund pending":"Return, refunded / applied");
const cns=z.creditnotes.map(c=>({...c,order:ordKey(c.customer_name),src:bySrc.get(ordKey(c.customer_name))||(c.customer_name==="House of Omnia"?"Internal":"Not in Sept sheet"),type:cnType(c),day:cnDay(c)}));
const refunds=z.cnRefunds.filter(x=>(x.date||"").startsWith(`${YYYY}-${MM}`)).map(x=>({...x,amount:x.amount_bcy,day:+x.date.slice(8,10),order:ordKey(x.customer_name)}));
const wb=new ExcelJS.Workbook();
const head=(ws,cols)=>{ws.columns=cols.map(([h,k,w])=>({header:h,key:k,width:w||14}));const h=ws.getRow(1);h.font={bold:true,color:{argb:"FFFFFFFF"}};h.alignment={wrapText:true,vertical:"top"};h.eachCell(c=>c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1F3A5F"}});ws.views=[{state:"frozen",ySplit:1}];};
// ---------- Summary
const S=wb.addWorksheet("Summary");
S.columns=[{width:22},{width:24},{width:9},{width:12},{width:9},{width:12},{width:9},{width:12},{width:4},{width:28},{width:9},{width:12}];
S.addRow(["Exchanges, cancellations, returns and refunds"]).font={bold:true,size:13};
S.addRow(["Dispatch sheet = September 2026 sheet (Local orders + SMSA Orders). Zoho = credit notes and credit note refunds. Dates are the sheet row date (order/dispatch date) and the Zoho document date."]);
S.addRow([]);
const periods=[[`Today (${T})`,r=>r.day===T],[`Yesterday (${T-1})`,r=>r.day===T-1],[`Month to date`,()=>true]];
const K=[["Exchange","Exchange","topup"],["Cancelled","Cancelled","eventAmt"],["Returned & Refunded","Returned & Refunded","eventAmt"],["Refund only (partial / extra payment)","Refund only","eventAmt"]];
for(const [pname,pf] of periods){
  S.addRow([pname]).font={bold:true,size:12};
  const h=S.addRow(["Dispatch sheet","Type","Local #","Local AED","Intl #","Intl AED","Total #","Total AED","","Zoho","#","AED"]);h.font={bold:true};h.eachCell(c=>c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFD9E1F2"}});
  const zl=[["Exchange credit notes (zero value)",cns.filter(c=>c.type==="Exchange"&&pf(c)),"total"],["Return credit notes raised",cns.filter(c=>c.total>0&&pf(c)),"total"],["Credit note refunds paid out",refunds.filter(pf),"amount"],["Return credit notes still open",cns.filter(c=>c.total>0&&c.balance>0&&pf(c)),"balance"]];
  K.forEach(([label,k,f],i)=>{const L=rows.filter(r=>pf(r)&&r.src==="Local"&&r.kinds.includes(k)),I=rows.filter(r=>pf(r)&&r.src==="International"&&r.kinds.includes(k));const s=l=>r2(l.reduce((a,r)=>a+(r[f]||0),0));
    const zz=zl[i]||["","",""];S.addRow(["",label+(k==="Exchange"?" (AED = top up collected)":""),L.length,s(L),I.length,s(I),L.length+I.length,r2(s(L)+s(I)),"",zz[0],zz[1]?zz[1].length:"",zz[1]?r2(zz[1].reduce((a,x)=>a+Number(x[zz[2]]||0),0)):""]);});
  S.addRow([]);
}
[4,6,8,12].forEach(c=>S.getColumn(c).numFmt="#,##0.00");
S.addRow([`Check against the sheet's own Summary tab: ${rows.length} orders (${rows.filter(r=>r.src==="Local").length} local, ${rows.filter(r=>r.src==="International").length} international). Cancelled + refunded totals must equal the Summary tab's Cancelled Int / LOCAL figures.`]);
// ---------- sheet detail
const D=wb.addWorksheet("Sheet detail");
head(D,[["Date","date",11],["Local / Intl","src",12],["Order #","order",11],["Type","k",26],["Amount AED","amt",11],["Order total AED","aed",11],["Ccy","ccy",6],["Gateway / Party","party",14],["Delivery by","db",11],["Comments","comments",50],["Payment status","actual",18],["Zoho credit note","cn",22]]);
const cnByOrder={};cns.forEach(c=>{(cnByOrder[c.order]=cnByOrder[c.order]||[]).push(`${c.creditnote_number} ${c.total}${c.balance>0?" open":""}`)});
rows.filter(r=>r.kinds.length).sort((a,b)=>b.day-a.day).forEach(r=>D.addRow({date:r.date,src:r.src,order:r.order,k:r.kinds.join(" + "),amt:r.kinds.includes("Exchange")&&!r.eventAmt?r.topup:r.eventAmt,aed:r.aed,ccy:r.ccy,party:r.party,db:r.deliveryBy,comments:r.comments,actual:r.actual,cn:(cnByOrder[r.order]||[]).join(", ")}));
D.getColumn("amt").numFmt=D.getColumn("aed").numFmt="#,##0.00";
// ---------- Zoho credit notes
const Z=wb.addWorksheet("Zoho credit notes");
head(Z,[["Date","date",11],["Credit note","n",11],["Order / customer","c",30],["Local / Intl","src",14],["Type","t",24],["Total AED","tot",10],["Open AED","bal",10],["In sheet as","sheet",30]]);
const sheetByOrder={};rows.forEach(r=>{if(r.kinds.length)sheetByOrder[r.order]=(sheetByOrder[r.order]?sheetByOrder[r.order]+"; ":"")+r.kinds.join("+")});
cns.forEach(c=>Z.addRow({date:c.date,n:c.creditnote_number,c:c.customer_name,src:c.src,t:c.type,tot:c.total,bal:c.balance,sheet:sheetByOrder[c.order]||"not marked in sheet"}));
Z.getColumn("tot").numFmt=Z.getColumn("bal").numFmt="#,##0.00";
Z.addRow([]);Z.addRow(["Credit note refunds paid out in September"]).font={bold:true};
Z.addRow(["Date","Credit note","Customer","Amount","Reference"]).font={bold:true};
refunds.forEach(x=>Z.addRow([x.date,x.creditnote_number,x.customer_name,x.amount,x.reference_number]));
// ---------- OnTrack
const O=wb.addWorksheet("OnTrack (local)");
const loc=rows.filter(r=>r.src==="Local");const isOT=r=>/^(ontrack|ot|on track)$/i.test(r.deliveryBy.replace(/\s/g,"").replace("ontrack","ontrack"))||/on\s*track|^ot$/i.test(r.deliveryBy);
const groups=[["OnTrack",loc.filter(isOT)],["Muneeb (own driver)",loc.filter(r=>/muneeb/i.test(r.deliveryBy))],["Delivery by not filled in",loc.filter(r=>!isOT(r)&&!/muneeb/i.test(r.deliveryBy))]];
O.columns=[{width:34},{width:10},{width:14},{width:4},{width:34},{width:10},{width:14}];
O.addRow(["Local orders by delivery, September 1 to 24"]).font={bold:true,size:12};
O.addRow(["Delivery by","Orders","Order value AED"]).font={bold:true};
groups.forEach(([n,l])=>O.addRow([n,l.length,r2(l.reduce((a,r)=>a+r.aed,0))]));
O.addRow([]);
const ot=groups[0][1];const isCOD=r=>/cod/i.test(r.typeOfSale+" "+r.party);
const cod=ot.filter(isCOD);const sum=(l,f)=>r2(l.reduce((a,r)=>a+(r[f]||0),0));
const codSale=cod.filter(r=>!r.kinds.includes("Exchange"));const codEx=cod.filter(r=>r.kinds.includes("Exchange"));
const cancelled=r=>r.kinds.includes("Cancelled")||/cancel/i.test(r.actual);
const lines=[
 ["OnTrack orders",ot.length,sum(ot,"aed")],
 ["  Prepaid orders (gateway paid)",ot.filter(r=>!isCOD(r)&&!r.kinds.includes("Exchange")).length,sum(ot.filter(r=>!isCOD(r)&&!r.kinds.includes("Exchange")),"aed")],
 ["  COD sale orders",codSale.length,sum(codSale,"aed")],
 ["  Exchanges (COD 30 AED fee or paid top up)",ot.filter(r=>r.kinds.includes("Exchange")).length,sum(ot.filter(r=>r.kinds.includes("Exchange")),"aed")],
 ["  Cancelled (amount = cancelled value)",ot.filter(r=>r.kinds.includes("Cancelled")).length,sum(ot.filter(r=>r.kinds.includes("Cancelled")),"eventAmt")],
 ["  Returned & refunded",ot.filter(r=>r.kinds.includes("Returned & Refunded")).length,sum(ot.filter(r=>r.kinds.includes("Returned & Refunded")),"eventAmt")],
 ["COD to collect (sale + exchange fees)",cod.filter(r=>!cancelled(r)).length,sum(cod.filter(r=>!cancelled(r)),"aed")],
 ["  Received from OnTrack",cod.filter(r=>!cancelled(r)&&/received/i.test(r.actual)).length,sum(cod.filter(r=>!cancelled(r)&&/received/i.test(r.actual)),"aed")],
 ["  Not yet received",cod.filter(r=>!cancelled(r)&&!/received/i.test(r.actual)).length,sum(cod.filter(r=>!cancelled(r)&&!/received/i.test(r.actual)),"aed")],
];
O.addRow(["OnTrack breakdown","Orders","AED"]).font={bold:true};lines.forEach(l=>O.addRow(l));
O.addRow([]);O.addRow(["OnTrack COD remittances (OT invoice #)","Orders","COD AED","","Received on"]).font={bold:true};
const byOT={};ot.filter(r=>r.ot).forEach(r=>{const k=r.ot;byOT[k]=byOT[k]||{n:0,a:0,rec:r.received};byOT[k].n++;byOT[k].a+=r.aed});
Object.entries(byOT).sort().forEach(([k,v])=>O.addRow([k,v.n,r2(v.a),"",v.rec]));
O.getColumn(3).numFmt="#,##0.00";
wb.xlsx.writeFile(OUTX).then(()=>{
 console.log(lines);console.log("pending",cod.filter(r=>!cancelled(r)&&!/received/i.test(r.actual)).map(r=>r.date+" "+r.order+" "+r.aed+" "+r.typeOfSale).join(" | "));console.log(groups.map(([n,l])=>n+" "+l.length));console.log("OT vouchers",Object.keys(byOT).length);
 for(const [p,pf] of periods){console.log(p,"zoho exch",cns.filter(c=>c.type==="Exchange"&&pf(c)).length,"ret",cns.filter(c=>c.total>0&&pf(c)).length,r2(cns.filter(c=>c.total>0&&pf(c)).reduce((a,c)=>a+c.total,0)),"refunds",refunds.filter(pf).length,r2(refunds.filter(pf).reduce((a,x)=>a+x.amount,0)));}
 const s=r=>r.kinds;const sheetRet=rows.filter(r=>r.kinds.some(k=>/Refund/.test(k)));console.log("sheet ret/refund no CN",sheetRet.filter(r=>!cnByOrder[r.order]).map(r=>r.order+" "+r.kinds).join(", "));
 console.log("CN valued not marked in sheet",cns.filter(c=>c.total>0&&!sheetByOrder[c.order]).map(c=>c.order+" "+c.total).join(", "));
 console.log("cn by src",JSON.stringify(cns.reduce((a,c)=>{const k=c.src+"|"+c.type;a[k]=(a[k]||0)+1;return a},{})));
 const ref=r=>rows.filter(r=>r.kinds.includes("Refund only")).map(r=>r.order+" "+r.refundTxt+" "+r.comments);console.log(ref());
});
