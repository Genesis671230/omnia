// One-time repair: orders taken in a currency lib/fx.ts had no rate for
// (OMR, BHD, QAR on the WooCommerce store) were stored with their *_aed
// amounts equal to the foreign amount — converted at 1.0. An OMR 99.09 order
// counted as AED 99.09 when Telr actually paid out AED 927.61 for it.
//
// Only rows that are provably unconverted are touched: gross_aed equal to
// gross_original. Every AED column is rescaled by the same rate, including
// each line item's total_aed. WooCommerce order sync is off (WOO_ORDER_SYNC),
// so nothing will ever re-normalise these rows on its own.
//
// Run:  npx tsx --env-file=.env --env-file=.env.local scripts/repair-unconverted-currency.ts           (dry run)
//       npx tsx --env-file=.env --env-file=.env.local scripts/repair-unconverted-currency.ts --apply   (writes)
import { supabase, selectAllPages } from "@/lib/supabase";
import { FX_TO_AED } from "@/lib/fx";

const apply = process.argv.includes("--apply");
const CURRENCIES = ["OMR", "BHD", "QAR"];
const r2 = (n: number) => +n.toFixed(2);

type Row = {
  uid: string; order_number: string; order_date: string | null; currency: string;
  gross_original: number; gross_aed: number; subtotal_aed: number | null; shipping_aed: number | null;
  tax_aed: number | null; discount_aed: number | null; line_items: { total_aed?: number }[] | null;
};

(async () => {
  const rows = await selectAllPages<Row>(
    (from, to) =>
      supabase
        .from("orders")
        .select("uid, order_number, order_date, currency, gross_original, gross_aed, subtotal_aed, shipping_aed, tax_aed, discount_aed, line_items")
        .in("currency", CURRENCIES)
        .range(from, to),
    "orders select",
  );
  const todo = rows.filter((r) => Math.abs(Number(r.gross_aed) - Number(r.gross_original)) < 0.01 && Number(r.gross_original) > 0);

  const byCur = new Map<string, { n: number; before: number; after: number }>();
  for (const r of todo) {
    const rate = FX_TO_AED[r.currency];
    const a = byCur.get(r.currency) ?? { n: 0, before: 0, after: 0 };
    a.n++; a.before += Number(r.gross_aed); a.after += Number(r.gross_original) * rate;
    byCur.set(r.currency, a);
  }
  console.log(`${rows.length} OMR/BHD/QAR orders on file, ${todo.length} still unconverted`);
  for (const [c, a] of byCur) {
    console.log(`  ${c}  ${String(a.n).padStart(4)} orders  rate ${FX_TO_AED[c]}  AED ${a.before.toFixed(2).padStart(11)} → ${a.after.toFixed(2).padStart(11)}  (+${(a.after - a.before).toFixed(2)})`);
  }
  for (const r of todo.slice(0, 5)) {
    console.log(`    ${r.order_number} ${r.order_date?.slice(0, 10)} ${r.currency} ${r.gross_original} → AED ${r2(Number(r.gross_original) * FX_TO_AED[r.currency])}`);
  }

  if (!apply) { console.log("\nDRY RUN — nothing written. Re-run with --apply to write."); return; }

  let done = 0;
  for (const r of todo) {
    const rate = FX_TO_AED[r.currency];
    const scale = (v: number | null) => (v == null ? v : r2(Number(v) * rate));
    const { error } = await supabase
      .from("orders")
      .update({
        gross_aed: r2(Number(r.gross_original) * rate),
        subtotal_aed: scale(r.subtotal_aed),
        shipping_aed: scale(r.shipping_aed),
        tax_aed: scale(r.tax_aed),
        discount_aed: scale(r.discount_aed),
        line_items: (r.line_items ?? []).map((li) => ({ ...li, total_aed: scale(li.total_aed ?? 0) })),
      })
      .eq("uid", r.uid)
      .eq("gross_aed", r.gross_aed); // unchanged since we read it
    if (error) throw new Error(`update ${r.uid} failed: ${error.message}`);
    done++;
  }
  console.log(`\nWrote ${done} rows.`);
})().catch((e) => { console.error(e); process.exit(1); });
