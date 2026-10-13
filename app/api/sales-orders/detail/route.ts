import { NextResponse } from "next/server";
import { detail } from "@/lib/sales-orders/so-close.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/sales-orders/detail?month=YYYY-MM&order=OS4256[&sheet=]
//   Everything the editor needs: the sales order, the dry-run plan, FIFO batch
//   picks and every supplier batch with stock, Zoho taxes and warehouses.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? "";
  const order = sp.get("order") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month) || !order) return NextResponse.json({ error: "month and order are required" }, { status: 400 });
  try {
    return NextResponse.json(await detail(month, order, sp.get("sheet") || undefined));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
