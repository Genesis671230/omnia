import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

// GET /api/orders/:uid — single order with line_items included (the list
// route at /api/orders strips line_items to keep the ledger payload light
// across 3700+ orders). Used by the order ledger's row-expansion view.
export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ order });
}
