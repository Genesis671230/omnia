// node build-tracker.cjs <crawl.json> <out.xlsx> <out.csv>
const fs = require("fs");
const ExcelJS = require("exceljs");
const [src, outX, outC] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(src, "utf8")).filter((r) => !r.skip);

const CAT = [
  ["Perfume & oud", /perfum|oud|fragranc|bakhoor|attar|scent/i],
  ["Beauty & skincare", /beauty|skin|cosmetic|makeup|hair|nail|lash/i],
  ["Fashion & abaya", /fashion|abaya|cloth|wear|dress|modest|kaftan|jalabiya|apparel|boutique|shoe|sneaker|bag/i],
  ["Jewellery & watches", /jewel|gold|diamond|watch|silver/i],
  ["Home & furniture", /furnitur|home|decor|mattress|bed|kitchen|curtain|carpet|rug|sofa|living/i],
  ["Electronics & mobile", /electronic|mobile|phone|laptop|gaming|computer|gadget|tech/i],
  ["Kids & toys", /kid|baby|toy|child|mum|mom/i],
  ["Sports & outdoor", /sport|fitness|gym|bike|cycle|outdoor|camp|motor/i],
  ["Health & supplements", /supplement|vitamin|health|nutrition|protein|pharma|optic|lens|eyewear/i],
  ["Flowers, gifts & food", /flower|gift|chocolate|cake|coffee|tea|dates|sweet|food/i],
  ["Pets", /\bpet|dog|cat\b/i],
];
const category = (r) => (CAT.find(([, re]) => re.test(`${r.title} ${r.title_tag} ${r.desc}`)) || ["General retail"])[0];

function score(r) {
  let s = 0; const why = []; const rails = ["Tabby"];
  if (r.tamara) { s += 3; rails.push("Tamara"); why.push("Tabby and Tamara both settle separately, net of fees and refunds, so two BNPL payout reports have to be matched to orders every month"); }
  if (r.cod) { s += 2; rails.push("COD"); why.push("Cash on delivery means courier remittances arrive in batches with charges taken off, and they have to be tied back to delivered orders"); }
  if (r.shop_pay) { s += 1; rails.push("Shopify Payments"); }
  else if (r.stripe) { s += 1; rails.push("Stripe/cards"); }
  if (rails.length >= 3) why.push(`${rails.length} payment rails land in one bank account as lump sums, so the bank never equals the store's sales report`);
  if (r.ksa) { s += 1; why.push("Site mentions Saudi Arabia (check they ship there): SAR orders would add exchange differences on top of the fees"); }
  else if (r.gcc) { s += 1; why.push("They ship across the GCC, so some orders arrive in other currencies"); }
  if (r.platform === "Shopify") { s += 1; why.push("Shopify store: RAMZA reads the orders and payouts directly"); }
  else if (r.platform === "WooCommerce") { s += 0.5; why.push("WooCommerce store: orders come in as an export"); }
  if (r.products >= 20) { s += 1; why.push("Large catalogue on the home page points to steady order volume"); }
  if (r.email) s += 1;
  if (r.instagram) s += 0.5;
  if (!why.length) why.push("Tabby settles net of its fee and of refunds, so the payout never equals the orders behind it");
  return { s, rails: rails.join(" + "), why: why.join(". ") + "." };
}

const BADMAIL = /^(test|example|name|your|email)@|@(sentry|example)/i;
const saudiBased = (r) => /\.sa(\/|$)|\.com\.sa|zid\.store/i.test(r.final || r.link) || r.platform === "Zid";
rows.forEach((r) => { r.email = (r.email || "").split(", ").filter((e) => e && !BADMAIL.test(e)).join(", "); });
const scored = rows.map((r) => ({ ...r, cat: category(r), saudi: saudiBased(r), ...score(r) }))
  .filter((r) => r.s >= 3)
  .sort((a, b) => (a.saudi - b.saudi) || b.s - a.s || a.page - b.page);
const tierOf = (r) => (r.saudi ? "KSA-based" : r.s >= 8 ? "A" : r.s >= 6 ? "B" : "C");

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Targets", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
const STATUSES = ["Not contacted", "Sent – day 1", "Follow-up 1 sent", "Follow-up 2 sent", "Replied", "Audit booked", "Audit delivered", "Won", "Lost / not now", "Do not contact"];
ws.columns = [
  ["#", 5], ["Brand", 26], ["Tier", 6], ["Fit score", 8], ["Category", 18], ["Website", 30], ["Platform", 12],
  ["Payment rails seen", 30], ["KSA / GCC", 10], ["Why they would buy", 70], ["Email", 30], ["Instagram", 32], ["TikTok", 28],
  ["Facebook", 28], ["LinkedIn", 30], ["WhatsApp", 15], ["Phone", 16], ["Decision maker (name)", 22], ["Role", 16],
  ["Decision maker LinkedIn / email", 30], ["Channel", 12], ["Status", 17], ["First touch", 12], ["Follow-up 1 due", 13],
  ["Follow-up 2 due", 13], ["Last reply", 12], ["Audit result (AED found)", 14], ["Next step", 26], ["Notes", 30], ["Tabby page", 8],
].map(([header, width]) => ({ header, width }));
scored.forEach((r, i) => {
  const n = i + 2;
  ws.addRow([i + 1, r.title.trim(), tierOf(r), r.s, r.cat, r.final || r.link, r.platform, r.rails, r.saudi ? "Saudi-based" : r.ksa ? "UAE + KSA?" : r.gcc ? "UAE + GCC" : "UAE",
    r.why, r.email, r.instagram, r.tiktok, r.facebook, r.linkedin, r.whatsapp, r.phone, "", "", "",
    r.email ? "Email" : r.instagram ? "Instagram DM" : r.whatsapp ? "WhatsApp" : "LinkedIn", "Not contacted", null,
    { formula: `IF(W${n}="","",W${n}+3)` }, { formula: `IF(W${n}="","",W${n}+7)` }, null, null, "", "", r.page]);
});
const last = scored.length + 1;
ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1533" } };
ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
ws.autoFilter = { from: "A1", to: `AD${last}` };
for (let n = 2; n <= last; n++) {
  ws.getCell(`V${n}`).dataValidation = { type: "list", allowBlank: false, formulae: [`"${STATUSES.join(",")}"`] };
  ws.getCell(`U${n}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Email,Instagram DM,WhatsApp,LinkedIn,Call"'] };
  for (const c of ["W", "X", "Y", "Z"]) ws.getCell(`${c}${n}`).numFmt = "dd mmm";
  ws.getCell(`J${n}`).alignment = { wrapText: true, vertical: "top" };
  for (const c of ["F", "K", "L", "M", "N", "O"]) {
    const v = ws.getCell(`${c}${n}`).value;
    if (typeof v === "string" && v.startsWith("http")) ws.getCell(`${c}${n}`).value = { text: v.split(", ")[0], hyperlink: v.split(", ")[0] };
    else if (c === "K" && v) ws.getCell(`${c}${n}`).value = { text: v.split(", ")[0], hyperlink: `mailto:${v.split(", ")[0]}` };
  }
}
ws.addConditionalFormatting({ ref: `V2:V${last}`, rules: [
  { type: "containsText", operator: "containsText", text: "Won", style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC8F0D2" } } } },
  { type: "containsText", operator: "containsText", text: "Audit", style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDCE3FD" } } } },
  { type: "containsText", operator: "containsText", text: "Replied", style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF1C2" } } } },
  { type: "containsText", operator: "containsText", text: "Lost", style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFEDEDED" } } } },
] });
// Follow-up due today or overdue and still waiting → red
ws.addConditionalFormatting({ ref: `X2:Y${last}`, rules: [{ type: "expression", formulae: [`AND(X2<>"",X2<=TODAY(),OR($V2="Sent – day 1",$V2="Follow-up 1 sent"))`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFAD4D4" } } } }] });

const p = wb.addWorksheet("Pipeline");
p.columns = [{ width: 26 }, { width: 12 }, { width: 14 }];
p.addRow(["Stage", "Brands", "% of contacted"]).font = { bold: true };
STATUSES.forEach((st, i) => p.addRow([st, { formula: `COUNTIF(Targets!V:V,"${st}")` }, i === 0 ? "" : { formula: `IFERROR(B${i + 2}/(COUNTA(Targets!B:B)-1-B2),0)` }]));
for (let i = 3; i <= STATUSES.length + 1; i++) p.getCell(`C${i}`).numFmt = "0%";
p.addRow([]);
p.addRow(["Follow-ups due today or overdue", { formula: `COUNTIFS(Targets!X:X,"<="&TODAY(),Targets!V:V,"Sent – day 1")+COUNTIFS(Targets!Y:Y,"<="&TODAY(),Targets!V:V,"Follow-up 1 sent")` }]);
p.addRow(["AED found in delivered audits", { formula: "SUM(Targets!AA:AA)" }]);
p.addRow(["Tier A / B / C", { formula: `COUNTIF(Targets!C:C,"A")&" / "&COUNTIF(Targets!C:C,"B")&" / "&COUNTIF(Targets!C:C,"C")&" / KSA "&COUNTIF(Targets!C:C,"KSA-based")` }]);
p.addRow([]);
p.addRow(["Daily rhythm: 20 new first touches a day (Tier A first), then every red follow-up cell."]);

const m = wb.addWorksheet("How fit is scored");
m.columns = [{ width: 40 }, { width: 10 }];
[["Signal (seen on the store's own site)", "Points"], ["Tamara as well as Tabby", 3], ["Cash on delivery", 2], ["Site mentions Saudi Arabia (verify)", 1], ["Ships to the rest of the GCC", 1], ["Shopify Payments or Stripe cards", 1], ["Runs on Shopify", 1], ["20+ products on the home page", 1], ["Public email found", 1], ["Instagram found", 0.5], ["Tier A ≥ 8, B ≥ 6, C ≥ 3. Brands under 3 are dropped. Saudi-based stores (.sa domain or the Zid platform) are listed last as KSA-based: they file with ZATCA, not the UAE, so contact them only once the UAE list is worked.", ""], ["Source: tabby.ai/en-AE/shop/stores pages 2–120, crawled 25 Oct 2026. Signals are what the site's own code shows (checkout widgets, footer text), so check before quoting them in a message.", ""]].forEach((r, i) => { const row = m.addRow(r); if (i === 0) row.font = { bold: true }; });

wb.xlsx.writeFile(outX).then(() => {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["rank", "brand", "tier", "score", "category", "website", "platform", "rails", "markets", "why", "email", "instagram", "tiktok", "facebook", "linkedin", "whatsapp", "phone"];
  fs.writeFileSync(outC, [head.join(","), ...scored.map((r, i) => [i + 1, r.title.trim(), tierOf(r), r.s, r.cat, r.final || r.link, r.platform, r.rails, r.saudi ? "Saudi-based" : r.ksa ? "UAE + KSA?" : r.gcc ? "UAE + GCC" : "UAE", r.why, r.email, r.instagram, r.tiktok, r.facebook, r.linkedin, r.whatsapp, r.phone].map(esc).join(","))].join("\n"));
  const t = (x) => scored.filter((r) => tierOf(r) === x).length;
  console.log(JSON.stringify({ reachable: rows.length, kept: scored.length, A: t("A"), B: t("B"), C: t("C"), KSA: t("KSA-based"), withEmail: scored.filter((r) => r.email).length, withIG: scored.filter((r) => r.instagram).length, shopify: rows.filter((r) => r.platform === "Shopify").length, tamaraToo: rows.filter((r) => r.tamara).length, cod: rows.filter((r) => r.cod).length, ksa: rows.filter((r) => r.ksa).length }));
});
