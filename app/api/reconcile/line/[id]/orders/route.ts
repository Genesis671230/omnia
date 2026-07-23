import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

export const maxDuration = 60;

// GET /api/reconcile/line/:id/orders
//
// Every order behind one bank credit, with line_items, in a single request.
// Fetched lazily the first time a row's proof table opens, so each subsequent
// product click is instant.
//
// The refs come from runReconciliation() rather than from the request, so what
// is returned is exactly what the UI is displaying — a caller cannot ask this
// endpoint about orders that aren't on the credit.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const line = (await runReconciliation()).find((l) => l.id === id);
    if (!line) {
      return NextResponse.json({ error: `No reconciliation line ${id}` }, { status: 404 });
    }

    // Union of every ref the row can show: settled, refunded, unresolved, and
    // anything appearing only in the per-order proof table.
    const refs = [
      ...new Set([
        ...line.resolvedOrders,
        ...line.refundedOrders,
        ...line.unresolvedRefs,
        ...line.transactions.map((t) => t.ref),
      ]),
    ].filter(Boolean);

    const orders = await OrdersRepository.getDetailsByOrderNumbers(refs);
    const found = new Set(orders.map((o) => String((o as { order_number: string }).order_number)));

    return NextResponse.json({
      bankLineId: id,
      orders,
      // Named explicitly so the UI can say "not in synced orders — run a sync"
      // against the specific order, instead of rendering an empty panel that
      // looks like a loading failure.
      missing: refs.filter((r) => !found.has(r)),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
