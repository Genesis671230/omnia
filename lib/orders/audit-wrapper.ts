import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";

// Wrap a mutation so the "read prev state → mutate → advance stage → log"
// pattern is one call. Use in every mutation route so nothing is missed.
export async function withAudit<T>(
  uid: string, actor: string, eventKind: string, targetStage: string | null,
  mutation: (order: any, prev: string) => Promise<{ ok: boolean; payload?: any; error?: string }>,
): Promise<{ ok: boolean; prev: string; result: any }> {
  const order = await OrdersRepository.getByUid(uid);
  if (!order) throw new Error("order not found");
  const prev = order.fulfillment_stage || "new";

  const result = await mutation(order, prev);

  if (result.ok && targetStage) {
    await OrdersRepository.setFulfillmentStage(uid, targetStage, actor);
  }

  await OrderEventsRepository.log(
    uid, actor, result.ok ? eventKind : `${eventKind}.failed`,
    prev, result.ok ? targetStage : prev,
    result.payload || (result.error ? { error: result.error } : {}),
  );

  return { ok: result.ok, prev, result: result.payload ?? result };
}