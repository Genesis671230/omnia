import { NextResponse } from "next/server";
import { board } from "@/lib/sales-orders/so-close.service";
import { sheetIdFromInput } from "@/lib/sales-orders/packing-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/sales-orders?month=YYYY-MM[&sheet=<id or url>]
//   Packing sheet × Zoho sales orders × store orders for the month. Read only:
//   one Sheets call + the month's sales-order list per Zoho org.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month (YYYY-MM) is required" }, { status: 400 });
  const sheet = sp.get("sheet");
  try {
    return NextResponse.json(await board(month, sheet ? sheetIdFromInput(sheet) : undefined));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
