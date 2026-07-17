import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";

// Ops workflow stages, one-directional in the UI — a founder can still jump
// stages (e.g. skip "packed" for a same-day local drop-off), so this is a
// display-order list, not a state machine with disallowed transitions.
export const FULFILLMENT_STAGES = ["processing", "packed", "shipped", "delivered"] as const;
export type FulfillmentStage = (typeof FULFILLMENT_STAGES)[number];

// PATCH /api/orders/:uid/status — advance (or correct) an order's internal
// pack-and-ship stage. Distinct from fulfillment_status, which is synced
// read-only from Shopify/Woo and does not reflect the founder's own process.
export async function PATCH(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const { stage } = await request.json().catch(() => ({ stage: undefined }));

  if (!FULFILLMENT_STAGES.includes(stage)) {
    return NextResponse.json({ error: `stage must be one of: ${FULFILLMENT_STAGES.join(", ")}` }, { status: 400 });
  }

  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const updatedBy = session?.username ?? "unknown";

  try {
    const updated = await OrdersRepository.setFulfillmentStage(uid, stage, updatedBy);
    return NextResponse.json({ ok: true, order: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
