// Dump a month's dispatch sheet (Local orders + SMSA Orders + Summary) to JSON.
// The sheet id comes from payment_sheet_months (one spreadsheet per month) —
// never from GOOGLE_SHEETS_SPREADSHEET_ID, which pins a single older month.
//   MONTH_KEY=2026-09 npx tsx --env-file=.env.local scripts/_dispatch-dump.ts <out/month-sheet.json>
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { supabase } from "@/lib/supabase";
import { listTabNames, readAllValues } from "@/lib/integrations/google-sheets";
(async () => {
  const key = process.env.MONTH_KEY ?? new Date().toISOString().slice(0, 7);
  const { data, error } = await supabase.from("payment_sheet_months").select("spreadsheet_id,label").eq("month_key", key).single();
  if (error || !data) throw new Error(`No dispatch sheet registered for ${key} in payment_sheet_months`);
  const tabs = await listTabNames(data.spreadsheet_id);
  const out: Record<string, string[][]> = {};
  for (const t of tabs) out[t] = await readAllValues(t, data.spreadsheet_id).catch(() => []);
  writeFileSync(process.argv[2], JSON.stringify(out));
  console.log(data.label, Object.entries(out).map(([t, v]) => `${t.trim()}: ${v.length}`).join(" | "));
})();
