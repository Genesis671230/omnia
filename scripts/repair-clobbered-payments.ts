// One-time repair: bring existing orders in line with the store payment policy
// in lib/orders/store-payment-policy.ts.
//
// Background. The WhatsApp storefront creates an order only after staff have
// taken the payment on a Stripe / Tabby / Tamara / Telr link in the chat, so
// Shopify reports `pending` on those orders permanently — 293 of 296 in a
// recent 30-day window. Everything that counts paid orders (Gross Sales, the
// CFO digest) therefore read the WhatsApp store as roughly zero revenue.
//
// Two separate faults produced that:
//
//   1. The normalizer stored Shopify's meaningless `pending` verbatim.
//   2. For the orders this app HAD confirmed through Stripe, the 2-minute order
//      sync then overwrote the confirmed `paid` with that same `pending` — and
//      because the confirmer dedups on uid in webhook_inbox, it never fired
//      again. 212 orders worth AED 351,403 were stuck that way.
//
// Both are fixed going forward (lib/orders/store-payment-policy.ts and the
// guard in lib/orders-clobber-guard.ts). This script repairs the history the
// sync will never revisit — the scheduler only re-fetches a 3-day window.
//
// Reversals are never touched: refunded, partially refunded, voided and
// cancelled are real facts the store does know, and re-marking them paid would
// count returned money as revenue.
//
// COD follows the same carve-out as the live policy — the cash arrives with the
// courier, so it is not revenue at order-creation time. Set
// ORDERS_WA_COUNT_COD_AS_PAID=true to include it.
//
// Run:  npx tsx scripts/repair-clobbered-payments.ts           (dry run)
//       npx tsx scripts/repair-clobbered-payments.ts --apply   (writes)
import "dotenv/config";
import { supabase } from "@/lib/supabase";
import {
  PREPAID_AT_CREATION_STORES,
  resolveFinancialStatus,
} from "@/lib/orders/store-payment-policy";

type Row = {
  uid: string;
  store_id: string;
  order_number: string;
  order_date: string | null;
  financial_status: string | null;
  gateway: string | null;
  gross_aed: number | null;
};

async function readAll(store: string): Promise<Row[]> {
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("orders")
      .select("uid, store_id, order_number, order_date, financial_status, gateway, gross_aed")
      .eq("store_id", store)
      .order("order_date", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`orders read failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");

  for (const store of PREPAID_AT_CREATION_STORES) {
    const rows = await readAll(store);
    console.log(`\n=== ${store}: ${rows.length} orders on file ===`);

    const toRepair = rows.filter((r) => {
      const resolved = resolveFinancialStatus({
        storeId: r.store_id,
        reportedStatus: r.financial_status,
        gateway: r.gateway,
      });
      return resolved !== (r.financial_status || "").trim().toLowerCase();
    });

    const byGateway = new Map<string, { n: number; aed: number }>();
    let total = 0;
    for (const r of toRepair) {
      const gw = r.gateway || "(none)";
      const agg = byGateway.get(gw) ?? { n: 0, aed: 0 };
      agg.n += 1;
      agg.aed += Number(r.gross_aed || 0);
      byGateway.set(gw, agg);
      total += Number(r.gross_aed || 0);
    }

    const untouched = rows.length - toRepair.length;
    console.log(`already correct, left alone: ${untouched}`);
    console.log(`TO REPAIR: ${toRepair.length} orders, AED ${total.toFixed(2)}`);
    for (const [gw, agg] of [...byGateway].sort((a, b) => b[1].aed - a[1].aed)) {
      console.log(`  ${gw.padEnd(14)} ${String(agg.n).padStart(5)} orders  AED ${agg.aed.toFixed(2)}`);
    }

    const oldest = toRepair[toRepair.length - 1]?.order_date;
    const newest = toRepair[0]?.order_date;
    if (toRepair.length > 0) console.log(`  date range: ${oldest} .. ${newest}`);

    if (toRepair.length === 0) continue;

    if (!apply) {
      console.log("  sample:");
      for (const r of toRepair.slice(0, 8)) {
        console.log(`    ${r.order_number} ${r.order_date} "${r.financial_status}" -> "paid"  (${r.gateway}, AED ${r.gross_aed})`);
      }
      continue;
    }

    let written = 0;
    for (let i = 0; i < toRepair.length; i += 200) {
      const chunk = toRepair.slice(i, i + 200).map((o) => o.uid);
      const { error } = await supabase
        .from("orders")
        .update({ financial_status: "paid" })
        .in("uid", chunk);
      if (error) throw new Error(`repair write failed: ${error.message}`);
      written += chunk.length;
      console.log(`  repaired ${written}/${toRepair.length}`);
    }
    console.log(`  done: ${written} ${store} orders now read as paid.`);
  }

  if (!apply) console.log("\nDRY RUN — nothing written. Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
