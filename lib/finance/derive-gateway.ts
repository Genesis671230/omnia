import type { SettlementRecord } from "@/lib/repositories/settlements.repository";

type OrderLite = {
  order_number: string;
  payment_gateway_names?: string[] | null;
  gateway?: string | null;
};

export function deriveGateway(
  orderNumber: string | null,
  settlement: SettlementRecord | undefined,
  order: OrderLite | undefined,
): { gateway: string; source: "settlement" | "order" | "cod" | "unknown" } {
  if (settlement?.gateway) return { gateway: settlement.gateway, source: "settlement" };
  if (!orderNumber || !order) return { gateway: "Unknown", source: "unknown" };

  const names = order.payment_gateway_names ?? [];
  if (names.some((n) => /^(cod|ontrack)$/i.test(n))) return { gateway: "COD", source: "cod" };

  const primary = order.gateway || names[0];
  return primary
    ? { gateway: primary, source: "order" }
    : { gateway: "Unknown", source: "unknown" };
}