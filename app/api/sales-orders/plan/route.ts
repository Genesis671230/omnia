import { NextResponse } from "next/server";
import { plan, targetsFor, type AmountOptions } from "@/lib/sales-orders/so-close.service";
import { sheetIdFromInput } from "@/lib/sales-orders/packing-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/sales-orders/plan { month, orders: string[], sheet?, options?: { [order]: { rateOverride?, matchOrderTotal? } } }
//   Dry run: what each draft needs (tax fix, packaging lines), stock and
//   amount checks. Nothing is written to Zoho.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { month?: string; orders?: string[]; sheet?: string; options?: Record<string, AmountOptions> };
  if (!body.month || !/^\d{4}-\d{2}$/.test(body.month) || !Array.isArray(body.orders) || !body.orders.length) {
    return NextResponse.json({ error: "month and orders[] are required" }, { status: 400 });
  }
  if (body.orders.length > 60) return NextResponse.json({ error: "Check at most 60 orders at a time" }, { status: 400 });
  try {
    const { targets, missing } = await targetsFor(body.month, body.orders, body.sheet ? sheetIdFromInput(body.sheet) : undefined, body.options ?? {});
    return NextResponse.json({ plans: await plan(targets), missing });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
