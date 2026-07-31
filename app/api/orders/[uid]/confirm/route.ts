// app/api/orders/[uid]/confirm/route.ts
import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";
import { randomUUID } from "crypto";  
import { withAudit } from "@/lib/orders/audit-wrapper";


export async function POST(_req: Request, { params }: { params: { uid: string } }) {
  const {uid} = await params;
  const order = await OrdersRepository.getByUid(uid);
  console.log(uid,"readu asdasbdjas  jabsdjas")
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  // const uid = randomUUID()

  const prev = order.fulfillment_stage; 

  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

  const isCod = order.gateway === "COD";
  const isPaid = ["paid", "authorized","pending"].includes(order.financial_status);
  if (!isCod && !isPaid) return NextResponse.json({ ok: false, error: `unpaid: ${order.financial_status}` }, { status: 409 });

  await OrdersRepository.setFulfillmentStage(uid, "confirmed", "hamza");
  return NextResponse.json({ ok: true });


  // try {
  //   const { ok } = await withAudit(uid, "hamza", "order.confirmed", "confirmed", async (order) => {
  //     const isCod = order.gateway === "COD";
  //     const isPaid = ["paid", "authorized"].includes(order.financial_status);
  //     if (!isCod && !isPaid) return { ok: false, error: `unpaid: ${order.financial_status}` };
  //     return { ok: true, payload: {} };
  //   });
  //   return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
  // } catch (e) {
  //   return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  // }
}