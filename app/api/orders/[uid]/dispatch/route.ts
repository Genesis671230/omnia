// app/api/orders/[uid]/dispatch/route.ts
import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

export async function POST(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  await OrdersRepository.setFulfillmentStage(uid, "shipped", "hamza");
  return NextResponse.json({ ok: true });
}