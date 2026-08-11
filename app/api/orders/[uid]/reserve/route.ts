// app/api/orders/[uid]/reserve/route.ts
import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { InventoryReservationsRepository } from "@/lib/repositories/inventory-reservations.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const body = await req.json().catch(() => ({}));
  const wh = body?.warehouse_id;
  if (!wh) return NextResponse.json({ error: "warehouse_id required" }, { status: 400 });

  const order = await OrdersRepository.getByUid(uid);
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  const actor = "hamza";
  const prev = order.fulfillment_stage || "new";

  const result = await InventoryReservationsRepository.reserve(uid, wh, actor);
console.log(result)
  if (result.ok) {
    await OrderEventsRepository.log(uid, actor, "reservation.created", prev, "reserved", {
      warehouse_id: result.warehouse_id,
      warehouse_name: result.warehouse_name,
      reservations: result.reservations,
    });
  } else {
    // Log the failure too — Fouad needs to know when a reserve was attempted
    // and refused, not just when it succeeded.
    await OrderEventsRepository.log(uid, actor, "reservation.failed", prev, prev, {
      warehouse_id: wh,
      error: result.error,
      failures: result.failures,
    });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}