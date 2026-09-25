// Founder-approved (2026-09-25): fill "payment received" details on dispatch-sheet rows
// whose money is proven in the bank. Input = fill-decisions.json (CERTAIN rows).
//   npx tsx --env-file=.env.local scripts/_fill-dispatch-payments.ts <fill-decisions.json> <out-log.json> [--live]
// Safety: columns found by header text; each row re-read live; the Order # at that row
// must still be this order (else searched once by Order #, must be unique); only BLANK
// cells are written; a row where Actual Payment Status is already filled is skipped.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { supabase } from "@/lib/supabase";
import { readAllValues, updateCells } from "@/lib/integrations/google-sheets";

const LIVE = process.argv.includes("--live");
const fmtAmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

(async () => {
  const { res } = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const certain = (res as any[]).filter((r) => r.cls === "CERTAIN");
  const { data: m } = await supabase.from("payment_sheet_months").select("spreadsheet_id").eq("month_key", "2026-09").single();
  const sheetId = m!.spreadsheet_id as string;
  const log: any[] = [];

  for (const tab of ["Local orders", "SMSA Orders"]) {
    const realTab = tab === "Local orders" ? " Local orders" : "SMSA Orders";
    const rows = await readAllValues(realTab, sheetId);
    const h = rows[0].map(norm);
    const col = (name: string) => { const i = h.indexOf(norm(name)); if (i < 0) throw new Error(`${realTab}: column "${name}" not found`); return i; };
    const isLocal = tab === "Local orders";
    const C = {
      order: col("Order #"), aps: col("Actual Payment Status"), prc: col(isLocal ? "Payment Received on" : "Payment Received Date"),
      tot: col("Total Amount"), fee: col("Fee Deducted"), after: col("Amount After Deduction"), pct: col(isLocal ? "% Charged" : "Fee%"),
    };
    const updates: { row: number; col: number; value: string }[] = [];
    for (const r of certain.filter((x) => x.tab === tab)) {
      let idx = r.rowNum - 1;
      if (norm(rows[idx]?.[C.order]) !== norm(r.order)) {
        const hits = rows.map((x, i) => (norm(x[C.order]) === norm(r.order) ? i : -1)).filter((i) => i > 0);
        if (hits.length !== 1) { log.push({ tab, order: r.order, result: "skipped: row moved and not unique" }); continue; }
        idx = hits[0];
      }
      const row = rows[idx];
      if (String(row[C.aps] ?? "").trim()) { log.push({ tab, order: r.order, row: idx + 1, result: `skipped: already "${row[C.aps]}"` }); continue; }
      const s = r.s;
      const want: [number, string][] = [
        [C.aps, "Payment Received "],
        [C.prc, `Payment Received on ${fmtDate(s.bankDate)} (${fmtAmt(s.bankAmount)})`],
      ];
      if (s.gross != null) {
        want.push([C.tot, s.gross.toFixed(2)], [C.fee, s.fee.toFixed(2)], [C.after, s.net.toFixed(2)]);
        if (s.gross) want.push([C.pct, `${(s.fee / s.gross * 100).toFixed(2)}%`]);
      }
      const written: Record<string, string> = {};
      for (const [c, v] of want) {
        if (String(row[c] ?? "").trim()) continue; // never overwrite
        updates.push({ row: idx + 1, col: c, value: v });
        written[rows[0][c]] = v;
      }
      log.push({ tab, order: r.order, row: idx + 1, result: "filled", written });
    }
    console.log(realTab, "rows to fill", log.filter((l) => l.tab === tab && l.result === "filled").length, "cells", updates.length);
    if (LIVE && updates.length) {
      for (let i = 0; i < updates.length; i += 400) await updateCells(`'${realTab}'`, updates.slice(i, i + 400), sheetId);
      // read back
      const after = await readAllValues(realTab, sheetId);
      const bad = updates.filter((u) => String(after[u.row - 1]?.[u.col] ?? "").trim() === "");
      console.log(realTab, "read back: blank after write =", bad.length);
    }
  }
  writeFileSync(process.argv[3], JSON.stringify({ live: LIVE, at: new Date().toISOString(), log }, null, 1));
  const c: Record<string, number> = {}; log.forEach((l) => { const k = l.result.split(":")[0]; c[k] = (c[k] ?? 0) + 1; });
  console.log(LIVE ? "LIVE" : "DRY", c); log.filter((l) => l.result !== "filled").forEach((l) => console.log(" ", l.tab, l.order, l.result));
})();
