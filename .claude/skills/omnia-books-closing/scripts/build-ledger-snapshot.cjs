// node build-ledger-snapshot.cjs <workdir with readback.json, live-run.json, refund-rows.json> <out.xlsx>
const path=require("path");const W=process.argv[2]||".";const OUTX=process.argv[3]||"ledger-snapshot.xlsx";
const ExcelJS=require(require.resolve("exceljs",{paths:[process.cwd()]}));
const d=require(path.resolve(W,"readback.json"));const run=require(path.resolve(W,"live-run.json"));
const r2=n=>n==null||n===""?null:Math.round(Number(n)*100)/100;const day=s=>(s||"").slice(0,10);
const wb=new ExcelJS.Workbook();
const sheet=(name,cols)=>{const ws=wb.addWorksheet(name);ws.columns=cols.map(([h,k,w])=>({header:h,key:k,width:w||13}));const h=ws.getRow(1);h.font={bold:true,color:{argb:"FFFFFFFF"}};h.alignment={wrapText:true,vertical:"top"};h.height=45;h.eachCell(c=>c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1F3A5F"}});ws.views=[{state:"frozen",ySplit:1}];ws.autoFilter={from:"A1",to:{row:1,column:cols.length}};return ws};
const money=(ws,keys)=>keys.forEach(k=>ws.getColumn(k).numFmt="#,##0.00");
const booked=d.orders.filter(o=>o.status==="booked");
const gPlan=Object.fromEntries(run.sg.map(r=>[r.orderNumber,r.plan]));
// ---- invoices
const I=sheet("Invoices closed",[["Group","g",10],["Bank date","date",10],["Gateway","gw",13],["Bank ref","ref",17],["Order","o",10],["Invoice","inv",11],["Invoice total","tot",11],["Zoho status now","st",9],["Balance now","bal",9],["Payment #","pn",10],["Payment AED","pa",11],["Deposited to","acc",17],["Fee expense AED (total deducted)","fee",11],["of which Input VAT","vat",9],["Fee ex VAT (Payment Gateway Charges)","feex",11],["Exchange / rounding (+ loss, − gain)","fx",11],["Net received (payout file)","net",11],["Check: payment − fee − diff − net","chk",10],["Journal # (FX)","fxn",9]]);
for(const o of booked){const p=o.plan||gPlan[o.order]||{};const pay=o.payment||{};
 I.addRow({g:o.group,date:day(o.date),gw:o.provider,ref:o.bankRef,o:o.order,inv:o.invoice?.invoice_number,tot:r2(o.invoice?.total),st:o.invoice?.status,bal:r2(o.invoice?.balance),pn:pay.payment_number||(o.group==="Group G"?"paid by hand, untouched":""),pa:r2(pay.amount),acc:pay.account_name||o.fee?.paid_through_account_name,fee:r2(o.fee?.total),vat:r2(o.fee?.tax_amount||0),feex:r2(o.fee?.sub_total??o.fee?.total),fx:r2(p.difference||0),net:r2(p.netReceived),chk:r2((o.group==="Group G"?p.paymentAmount:pay.amount)-(o.fee?.total||0)-(p.difference||0)-p.netReceived),fxn:o.fx?.entry_number||""});}
const tI=k=>r2(booked.reduce((s,o)=>s+(k(o)||0),0));
I.addRow({o:"TOTAL",pa:tI(o=>o.payment?.amount),fee:tI(o=>o.fee?.total),vat:tI(o=>o.fee?.tax_amount),feex:tI(o=>o.fee?.sub_total),fx:tI(o=>(o.plan||gPlan[o.order]||{}).difference),net:tI(o=>(o.plan||gPlan[o.order]||{}).netReceived)}).font={bold:true};
money(I,["tot","bal","pa","fee","vat","feex","fx","net","chk"]);
// ---- refunds
const R=sheet("Refunds booked",[["Bank date","date",10],["Gateway","gw",13],["Bank ref","ref",17],["Order / ref","o",11],["Credit note","cn",10],["Refunded to customer AED","amt",11],["Refunded from","from",14],["Credit note balance left","left",10],["Charge (+ fee handed back / − kept)","chg",10],["Charge document","cdoc",20],["Charge VAT","cvat",8],["Clearing movement","clr",11],["Payout file net","file",10],["Note","note",60]]);
const rr=(()=>{try{return require(path.resolve(W,"refund-rows.json"))}catch{return []}})();
for(const r of d.refunds){const cnr=(r.cn?.creditnote_refunds||[]).find(x=>(x.reference_number||"").includes("/"+(r.orderNumber||r.ref)+"/RFD"));const c=r.chargeDoc;const row=rr.find(x=>x.order===(r.orderNumber||r.ref)&&x.ref===r.bankRef);
 R.addRow({date:day(r.date),gw:r.provider,ref:r.bankRef,o:r.orderNumber||r.ref,cn:r.cn?.creditnote_number||"",amt:r2(r.amount),from:cnr?.from_account_name||"",left:r.cn?r2(r.cn.balance):null,chg:r2(r.charge),cdoc:c?(c.kind==="journal"?`Journal ${c.entry_number}`:`Expense ${c.reference_number}`):"",cvat:r2(c?.kind==="expense"?c.tax_amount:0),clr:r2(-r.amount+r.charge),file:row?.fileNet??null,note:(r.cn&&r.cn.balance>0.01)?"Left open on the credit note: your decision (reduce the note or keep as store credit)":""});}
R.addRow({o:"TOTAL",amt:r2(d.refunds.reduce((s,r)=>s+r.amount,0)),chg:r2(d.refunds.reduce((s,r)=>s+r.charge,0)),clr:r2(d.refunds.reduce((s,r)=>s+(-r.amount+r.charge),0))}).font={bold:true};
money(R,["amt","left","chg","cvat","clr","file"]);
// ---- ledger entries
const L=sheet("Ledger entries",[["Date","date",10],["Document","doc",16],["Doc # / ref","n",28],["Order","o",10],["Account","acc",26],["Debit","dr",11],["Credit","cr",11]]);
const add=(date,doc,n,o,acc,dr,cr)=>L.addRow({date:day(date),doc,n,o,acc,dr:dr?r2(dr):null,cr:cr?r2(cr):null});
for(const o of booked){const p=o.payment;if(p){add(p.date,"Customer payment",`${p.payment_number} ${p.reference_number}`,o.order,p.account_name,p.amount,0);add(p.date,"Customer payment",`${p.payment_number} → ${o.invoice?.invoice_number}`,o.order,"Accounts Receivable",0,p.amount);}
 const f=o.fee;if(f){add(f.date,"Expense (gateway fee)",f.reference_number,o.order,"Payment Gateway Charges",f.sub_total,0);if(f.tax_amount)add(f.date,"Expense (gateway fee)",f.reference_number,o.order,"Input VAT",f.tax_amount,0);add(f.date,"Expense (gateway fee)",f.reference_number,o.order,f.paid_through_account_name,0,f.total);}
 const j=o.fx;if(j)for(const l of j.line_items)add(j.journal_date,"Journal (FX / rounding)",`${j.entry_number} ${j.reference_number}`,o.order,l.account_name,l.debit_or_credit==="debit"?l.amount:0,l.debit_or_credit==="credit"?l.amount:0);}
for(const r of d.refunds){const cnr=(r.cn?.creditnote_refunds||[]).find(x=>(x.reference_number||"").includes("/"+(r.orderNumber||r.ref)+"/RFD"));
 if(cnr){add(cnr.date,"Credit note refund",`${r.cn.creditnote_number} ${cnr.reference_number}`,r.orderNumber||r.ref,"Accounts Receivable (credit note)",cnr.amount_bcy,0);add(cnr.date,"Credit note refund",`${r.cn.creditnote_number} ${cnr.reference_number}`,r.orderNumber||r.ref,cnr.from_account_name,0,cnr.amount_bcy);}
 const c=r.chargeDoc;if(c?.kind==="journal")for(const l of c.line_items)add(c.journal_date,"Journal (fee handed back)",`${c.entry_number} ${c.reference_number}`,r.orderNumber||r.ref,l.account_name,l.debit_or_credit==="debit"?l.amount:0,l.debit_or_credit==="credit"?l.amount:0);
 if(c?.kind==="expense"){add(c.date,"Expense (refund charge)",c.reference_number,r.orderNumber||r.ref,"Payment Gateway Charges",c.sub_total,0);if(c.tax_amount)add(c.date,"Expense (refund charge)",c.reference_number,r.orderNumber||r.ref,"Input VAT",c.tax_amount,0);add(c.date,"Expense (refund charge)",c.reference_number,r.orderNumber||r.ref,c.paid_through_account_name,0,c.total);}}
let dr=0,cr=0;L.eachRow((row,i)=>{if(i>1){dr+=row.getCell("dr").value||0;cr+=row.getCell("cr").value||0}});
L.addRow({acc:"TOTAL (debits = credits)",dr:r2(dr),cr:r2(cr)}).font={bold:true};money(L,["dr","cr"]);
// ---- per account totals
const A=sheet("By account",[["Account","a",30],["Debit","dr",13],["Credit","cr",13],["Net (Dr − Cr)","net",13],["Closing balance in Zoho now","cb",16]]);
const acc={};L.eachRow((row,i)=>{if(i<2)return;const a=row.getCell("acc").value;if(!a||String(a).startsWith("TOTAL"))return;acc[a]=acc[a]||{dr:0,cr:0};acc[a].dr+=row.getCell("dr").value||0;acc[a].cr+=row.getCell("cr").value||0;});
const cb=Object.fromEntries(d.clearing.map(c=>[c.name,c.raw?.closing_balance]));
Object.entries(acc).sort().forEach(([a,v])=>A.addRow({a,dr:r2(v.dr),cr:r2(v.cr),net:r2(v.dr-v.cr),cb:cb[a]!=null?r2(cb[a]):null}));money(A,["dr","cr","net","cb"]);
// ---- not done
const N=sheet("Not done and why",[["Item","i",22],["Order / credit","o",24],["Why","w",70],["What is needed","n",60]]);
const nd=[
 ["Group G (held)","WA55734, 804796, 804609, 804643, 803968","Invoice already closed by hand. The gateway line is only a small top up (30 or 70 AED) or does not match the invoice. You asked not to close anything on G.","Nothing, unless you want the top up fees booked."],
 ["Group G (left, as asked)","others of the 8","Invoices closed by hand, not touched.",""],
 ["Group A (held, safety check)","WA55766, WA55759, WA55655, WA55647, WA55562","Stripe fee plus net does not equal the Stripe gross for these charges, so the gap is not a pure currency difference.","Check the Stripe charge (multi order or earlier partial refund)."],
 ["Group A (excluded)","WA55658","Gap is a 25 AED overpayment that Stripe refunded, not currency.","Book with the 25 refund."],
 ["Unconfirmed credits (left out, as asked)","22 Sep Telr 854.70 (SA3980), 22 Sep Telr 769.77 (OS3742)","Credit not confirmed in the app.","Confirm the credits, then they book normally."],
 ["Booked earlier from the app","17 orders on 24 Sep Tamara (SA3982…SA4021) and 24 Sep Stripe (WA55777…WA55785)","Booked from the app on 24 Sep evening, before this run.","SA4021 had a stuck marker; I relinked its existing Zoho payment (no new Zoho entry)."],
 ["Refund repairs (awaiting your OK)","804900, 804899, 804717","Credit note refunded in full but the fee Tabby handed back (73.62, 29.82, 83.28 incl. VAT) was never journaled. TABBY AED is short 186.72.","Journal Dr TABBY AED / Cr Payment Gateway Charges / Cr Input VAT for each."],
 ["Refund repairs (awaiting your OK)","SA3952","App shows booked but OCN-03627 has no refund in Zoho. 798.14 never left SHOPIFY.","Refund OCN-03627 by 798.14 from SHOPIFY."],
 ["Refund repairs (awaiting your OK)","803739","Booked by the old net method (829.84).","Add refund 44.89 from TABBY KSA and journal 39.36 (no VAT)."],
 ["Refund repairs (awaiting your OK)","804522","Booked 1.82 short (old rate rule).","Add refund 1.82 from TAMARA KSA."],
 ["Refund on hold","WA55588","Tabby refund row with a positive amount.","Check the Tabby statement line."],
 ["Refund blocked","WA55647","Original payment is in the held Group A list.","Book the payment, then the refund 838.87."],
 ["Credit note balances left open","23 credit notes, see Refunds booked","Customer got back less than the credit note (mostly about 3.2% in their own currency) or partial refund.","Your decision: reduce each note to what was refunded, or keep as store credit."],
 ["Fee only (paid, fee missing)","2 orders","Payment already booked by the app, fee not yet posted. Not in the approved list.","OK to book?"],
];
nd.forEach(x=>N.addRow({i:x[0],o:x[1],w:x[2],n:x[3]}).alignment={wrapText:true,vertical:"top"});
// ---- summary
const S=wb.addWorksheet("Summary");
S.columns=[{width:46},{width:10},{width:16},{width:70}];
S.addRow([`Booking run: ${day(run.startedAt)}`]).font={bold:true,size:13};
S.addRow([`Posted ${day(run.startedAt)} (${run.startedAt.slice(11,16)} to ${run.finishedAt.slice(11,16)} UTC). Every figure below was read back from Zoho after posting.`]);
S.addRow([]);const h=S.addRow(["What","Count","AED","Detail"]);h.font={bold:true};
const g=n=>booked.filter(o=>o.group===n);const pay=l=>r2(l.reduce((s,o)=>s+(o.payment?.amount||0),0));
S.addRow(["Section 1 invoices closed",g("Section 1").length,pay(g("Section 1")),"Clean matches: payment for the full balance, gateway fee with VAT on AED credits, exchange difference where any."]);
S.addRow(["Group A invoices closed (currency gap)",g("Group A").length,pay(g("Group A")),`Gap booked to Exchange Gain or Loss: net AED ${r2(g("Group A").reduce((s,o)=>s+(o.plan?.difference||0),0))} (positive = loss).`]);
S.addRow(["Group G fees booked (invoice untouched)",g("Group G").length,r2(g("Group G").reduce((s,o)=>s+(o.fee?.total||0),0)),"SA3888: fee 109.99 (KSA, no VAT) and exchange 34.70 from TAMARA KSA."]);
S.addRow(["Gateway fees booked",booked.filter(o=>o.fee).length,tI(o=>o.fee?.total),`Input VAT claimed AED ${tI(o=>o.fee?.tax_amount)}.`]);
S.addRow(["Refunds booked",d.refunds.filter(r=>r.amount>0).length,r2(d.refunds.reduce((s,r)=>s+r.amount,0)),"Credit note refunded from the gateway clearing account."]);
S.addRow(["Refund charges kept by gateway",d.refunds.filter(r=>r.charge<0).length,r2(d.refunds.filter(r=>r.charge<0).reduce((s,r)=>s-r.charge,0)),`Expense with VAT on AED credits (VAT AED ${r2(d.refunds.filter(r=>r.chargeDoc?.kind==="expense").reduce((s,r)=>s+(r.chargeDoc.tax_amount||0),0))}), no VAT on KSA.`]);
S.addRow(["Fees handed back on refunds",d.refunds.filter(r=>r.charge>0).length,r2(d.refunds.filter(r=>r.charge>0).reduce((s,r)=>s+r.charge,0)),"Tabby KSA, journal Dr TABBY KSA / Cr Payment Gateway Charges, no VAT."]);
S.addRow([]);
S.addRow(["How to verify"]).font={bold:true};
["Invoices closed: every invoice shows status paid and balance 0 in Zoho (column Balance now).","Each order: payment − fee − exchange difference = net received per the payout file (Check column is 0.00).","Each refund: clearing movement (−refund + charge) = the payout file net for that line.","Ledger entries: every Zoho line posted, debits equal credits. By account: totals per account and the Zoho closing balance of each clearing account now.","All references follow <bank ref>/<order>/FEE, /FX, /RFD, /RFC so each entry can be searched in Zoho."].forEach(t=>S.addRow([t]));
S.addRow([]);S.addRow(["Not done: see sheet Not done and why"]).font={bold:true};
S.getColumn(3).numFmt="#,##0.00";S.getColumn(4).alignment={wrapText:true,vertical:"top"};
wb.worksheets.splice(0,0,wb.worksheets.pop());
wb.xlsx.writeFile(OUTX).then(()=>{
 console.log("S1",g("Section 1").length,pay(g("Section 1")),"A",g("Group A").length,pay(g("Group A")),"Adiff",r2(g("Group A").reduce((s,o)=>s+(o.plan?.difference||0),0)),"fees",tI(o=>o.fee?.total),"vat",tI(o=>o.fee?.tax_amount),"fx",tI(o=>(o.plan||gPlan[o.order]||{}).difference));
 console.log("checks nonzero",I.getColumn("chk").values.filter(v=>typeof v==="number"&&Math.abs(v)>0.011).length,"DR",r2(dr),"CR",r2(cr));
 console.log("refunds",r2(d.refunds.reduce((s,r)=>s+r.amount,0)),"kept",r2(d.refunds.filter(r=>r.charge<0).reduce((s,r)=>s-r.charge,0)),"returned",r2(d.refunds.filter(r=>r.charge>0).reduce((s,r)=>s+r.charge,0)),"refund chk mismatches",d.refunds.filter(r=>{const row=rr.find(x=>x.order===(r.orderNumber||r.ref)&&x.ref===r.bankRef);return row&&Math.abs((-r.amount+r.charge)-row.fileNet)>0.011}).length);
 console.log(Object.entries(acc).map(([a,v])=>a+" "+r2(v.dr-v.cr)+" cb "+cb[a]).join("\n"));
});
