import ExcelJS from "exceljs";
const fs = require("fs");
const [S, outPath] = process.argv.slice(2);
const rows = [...JSON.parse(fs.readFileSync(`${S}/cn-sep-zoho.json`, "utf8")), ...JSON.parse(fs.readFileSync(`${S}/cn-new-zoho.json`, "utf8"))]
  .sort((a: any, b: any) => String(a.zoho?.date ?? a.at).localeCompare(String(b.zoho?.date ?? b.at)));
const allr = JSON.parse(fs.readFileSync(`${S}/cn-sep.json`, "utf8"));
const FULLSET = /full\s*set/i;
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Credit notes", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    ["System action", 34], ["Org", 14], ["Credit note", 13], ["CN date", 11], ["Status", 8], ["CN total", 10], ["Open balance", 11], ["Order", 10], ["Customer", 22],
    ["Reference", 30], ["Items returned to stock", 60], ["Created by", 12], ["System amount (AED)", 12], ["Refunds on CN", 30], ["Applied to invoices", 24], ["Arsalan refunds in history", 10], ["Team deletes/edits", 10], ["Check", 50], ["Full Zoho history", 80],
  ].map(([header, width]) => ({ header: header as string, width: width as number }));
  const out: unknown[][] = [];
  for (const r of rows) {
    const z = r.zoho; const org = String(r.org).startsWith("house") ? "House of Omnia" : "Omniastores";
    if (z.missing) { out.push([r.source, org, "(deleted in Zoho)", "", "deleted", null, null, r.order, "", "", "", "", r.aed, "", "", 0, 0, "Credit note no longer exists in Zoho", ""]); continue; }
    const h: string[] = z.history;
    const ars = h.filter((x) => x.includes("Arsalan: Credits refunded")).length;
    const dels = h.filter((x) => x.includes("refund deleted")).length;
    const team = h.filter((x) => /deleted|updated/.test(x) && !x.includes("Arsalan")).length;
    const lines = (z.lines ?? []).map((l: any) => `${l.qty}× ${l.sku || l.name}${l.sku && l.name !== l.sku ? ` (${l.name.slice(0, 40)})` : ""}${l.components ? ` [${l.components}]` : ""}${l.warehouse ? ` @ ${l.warehouse}` : ""}`).join("\n");
    const systemMadeLines = z.created_by === "Arsalan" || z.created_by === "Ramshad";
    const act = r.source === "exchange (3 Oct script)" ? "CN created + applied (exchange, 3 Oct script)"
      : r.source === "touched by Arsalan on team CN" ? "Team's CN applied to an invoice by the system"
      : r.source === "payout refund" ? (r.reused ? "Refund recorded on team's existing CN" : "CN created + refunded (payout refund)")
      : r.source.startsWith("adjust: exchanged") ? "CN created + applied (exchange)"
      : `CN created (${r.source.split(": ")[1]})${z.applied.length ? " + applied" : ""}`;
    const checks: string[] = [];
    if (systemMadeLines && /exchang/.test(act) && (z.lines ?? []).some((l: any) => FULLSET.test(l.name))) checks.push("EXCHANGE returned a FULL SET to stock — confirm the customer returned the whole set, not one piece");
    else if (systemMadeLines && (z.lines ?? []).some((l: any) => FULLSET.test(l.name))) checks.push("full set returned to stock — confirm received");
    if (z.balance > 0.01) checks.push(`AED ${z.balance} still open on the CN`);
    if (ars > 1) checks.push(`system refunded ${ars}x, team deleted ${dels}`);
    if (r.reused && z.refunds[0] && z.refunds[0].slice(0, 10) < "2026-09-20") checks.push("refund dated to the bank date, before it was posted");
    out.push([act, org, z.number, z.date, z.status, z.total, z.balance, r.order, z.customer, z.reference, systemMadeLines ? lines : `(lines made by ${z.created_by}) ${lines}`, z.created_by, r.aed, z.refunds.join("; "),
      z.applied.map((a: string) => a.replace(" undefined", "")).join("; "), ars, team, checks.join("; "), h.join("\n")]);
  }
  for (const o of out) {
    const row = ws.addRow(o);
    row.getCell(11).alignment = { wrapText: true, vertical: "top" };
    row.getCell(19).alignment = { wrapText: true, vertical: "top" };
    if (o[17]) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4E5" } }; });
  }
  const ws2 = wb.addWorksheet("Not posted", { views: [{ state: "frozen", ySplit: 1 }] });
  ws2.columns = [["Date", 11], ["Source", 14], ["Order", 12], ["AED", 10], ["Why no credit note", 90]].map(([header, width]) => ({ header: header as string, width: width as number }));
  for (const r of allr) if (r.source === "payout refund" && !String(r.cn_id ?? "").trim()) ws2.addRow([r.at.slice(0, 10), r.source, r.order, r.aed, r.error || "zero amount — skipped"]);
  for (const w of [ws, ws2]) w.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1B3D" } }; });
  await wb.xlsx.writeFile(outPath);
  const count = new Map<string, number>(); for (const o of out) count.set(String(o[0]), (count.get(String(o[0])) ?? 0) + 1);
  console.log(outPath, out.length, count);
  for (const o of out) if (String(o[17]).includes("FULL SET")) console.log(" ", o[2], o[7], "|", o[17]);
  console.log("flagged", out.filter((o) => o[17]).length);
})();
