import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { boxLabel, boxSkuFor, normalizeScan } from "@/lib/scan/scan-code";
import { packagingBarcodes } from "@/lib/uae-pack/uae-pack.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Plain table columns; the client re-reads the hit through /api/orders for the finance fields.
const COLS = "uid, store_id, order_number, order_date, customer_name, city, country, currency, gross_original, gross_aed, fulfillment_stage, awb_number, tracking_number";

// GET ?code=<scanned text> → what the scanner pointed at:
//   { kind: "box", sku, label }         a packaging box (SET101 …, or a mapped barcode)
//   { kind: "order", order }            an order — by number (#OS4441 / OS4441), AWB / tracking, or Shopify id
//   { kind: "many", orders }            a bare number that fits several orders
//   { kind: "none", code }
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("code") ?? "";
  const code = normalizeScan(raw);
  if (!code) return NextResponse.json({ kind: "none", code });
  const sku = boxSkuFor(raw, await packagingBarcodes());
  if (sku) return NextResponse.json({ kind: "box", sku, label: boxLabel(sku) });

  const safe = code.replace(/[^A-Z0-9_-]/g, "");
  if (!safe) return NextResponse.json({ kind: "none", code });
  const tries = [
    supabase.from("orders").select(COLS).ilike("order_number", safe).limit(2),
    supabase.from("orders").select(COLS).or(`awb_number.eq.${safe},tracking_number.eq.${safe}`).limit(2),
    ...(/^\d{10,}$/.test(safe) ? [supabase.from("orders").select(COLS).like("uid", `%${safe}`).limit(2)] : []),
    // A bare order number without its store prefix ("4441" → OS4441 / WA4441).
    ...(/^\d{3,9}$/.test(safe) ? [supabase.from("orders").select(COLS).ilike("order_number", `%${safe}`).order("order_date", { ascending: false }).limit(5)] : []),
  ];
  for (const q of tries) {
    const { data, error } = await q;
    if (error) return NextResponse.json({ kind: "none", code, error: error.message }, { status: 500 });
    const hits = (data ?? []).filter((o) => !/^\d+$/.test(safe) || String(o.order_number).toUpperCase().replace(/^[A-Z#]+/, "") === safe || o.awb_number === safe || o.tracking_number === safe || String(o.uid).endsWith(`_${safe}`));
    if (hits.length === 1) return NextResponse.json({ kind: "order", order: hits[0] });
    if (hits.length > 1) return NextResponse.json({ kind: "many", code, orders: hits });
  }
  return NextResponse.json({ kind: "none", code });
}
