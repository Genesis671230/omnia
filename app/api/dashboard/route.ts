import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

export const maxDuration = 60;

// GET /api/dashboard?days=30&store=UAE — founder dashboard aggregates.
// Orders-side numbers (revenue, trend, gateways, top products) come from the
// synced order book; cash-side numbers (payouts received, settled, awaiting)
// come from the bank statement + reconciliation, never from store claims.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const storeFilter = (url.searchParams.get("store") || "All").toUpperCase();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();

  // Fetch double the window in one query; rows before fromIso form the
  // previous period so the hero cards can show honest deltas.
  const prevFromIso = new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000).toISOString();

  const storeParam = storeFilter === "ALL" ? null : storeFilter;
  const [twoWindows, orderCounts, spotlightOrder, bankLinesRes, reconRes, payoutsRes, payoutsWithRefs] = await Promise.all([
    OrdersRepository.listInWindow({ from: prevFromIso, store: storeParam }),
    OrdersRepository.getOrderCounts({ store: storeParam }),
    OrdersRepository.getMostRecent({ store: storeParam }),
    supabase
      .from("bank_lines")
      .select("id, statement_date, description, reference, amount, direction, gateway_guess, confidence, kind")
      .order("statement_date", { ascending: false })
      .limit(1000),
    supabase.from("recon_lines").select("bank_line_id, match_status, confirmed_by"),
    supabase.from("payouts").select("id, gateway, net_amount, source, payout_date"),
    PayoutsRepository.listWithRefs(),
  ]);
  if (bankLinesRes.error) throw new Error(bankLinesRes.error.message);

  const bankLines = bankLinesRes.data ?? [];
  const reconByBankLine = new Map(
    (reconRes.data ?? []).map((r) => [r.bank_line_id, r]),
  );

  // ── orders side (window + optional store filter) ─────────────────────────
  const cancelled = new Set(["voided", "refunded", "cancelled"]);
  const validRows = twoWindows.filter((o) => !cancelled.has(o.financial_status));
  const inWindowFiltered = validRows.filter((o) => (o.order_date ?? "") >= fromIso);
  const prevWindow = validRows.filter((o) => (o.order_date ?? "") < fromIso);

  const revenue = inWindowFiltered.reduce((s, o) => s + Number(o.gross_aed || 0), 0);
  const prevRevenue = prevWindow.reduce((s, o) => s + Number(o.gross_aed || 0), 0);

  // daily trend, stacked by store
  const trendMap = new Map<string, Record<string, number>>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    trendMap.set(d, {});
  }
  for (const o of inWindowFiltered) {
    const d = (o.order_date as string).slice(0, 10);
    const bucket = trendMap.get(d);
    if (!bucket) continue;
    bucket[o.store_id] = (bucket[o.store_id] || 0) + Number(o.gross_aed || 0);
  }
  const trend = [...trendMap.entries()].map(([date, byStore]) => ({
    date,
    byStore,
    total: +Object.values(byStore).reduce((s, v) => s + v, 0).toFixed(2),
  }));

  // per-store + per-gateway splits
  const storeAgg = new Map<string, { revenue: number; orders: number }>();
  const gatewayAgg = new Map<string, { revenue: number; orders: number }>();
  for (const o of inWindowFiltered) {
    const s = storeAgg.get(o.store_id) || { revenue: 0, orders: 0 };
    s.revenue += Number(o.gross_aed || 0); s.orders += 1;
    storeAgg.set(o.store_id, s);
    const g = gatewayAgg.get(o.gateway || "Unclassified") || { revenue: 0, orders: 0 };
    g.revenue += Number(o.gross_aed || 0); g.orders += 1;
    gatewayAgg.set(o.gateway || "Unclassified", g);
  }

  // top products from line items
  const productAgg = new Map<string, { title: string; sku: string; qty: number; revenue: number; orders: number; stores: Set<string>; image_url: string }>();
  for (const o of inWindowFiltered) {
    for (const li of o.line_items ?? []) {
      const key = li.sku || li.title;
      const p = productAgg.get(key) || { title: li.title, sku: li.sku, qty: 0, revenue: 0, orders: 0, stores: new Set<string>(), image_url: "" };
      p.qty += Number(li.qty || 0);
      p.revenue += Number(li.total_aed || 0);
      p.orders += 1;
      p.stores.add(o.store_id);
      if (!p.image_url && li.image_url) p.image_url = li.image_url;
      productAgg.set(key, p);
    }
  }
  const topProducts = [...productAgg.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((p) => ({ ...p, revenue: +p.revenue.toFixed(2), stores: [...p.stores] }));

  // ── cash side (bank truth; not store-filterable) ─────────────────────────
  const credits = bankLines.filter((b) => b.direction === "credit");
  const debits = bankLines.filter((b) => b.direction === "debit");

  const stateOf = (id: string) => (reconByBankLine.get(id)?.match_status as string) || "AWAITING_PAYOUT";
  const settledCredits = credits.filter((c) => stateOf(c.id) === "SETTLED");
  const exceptionCredits = credits.filter((c) => ["PAYOUT_VARIANCE", "ORDERS_UNRESOLVED"].includes(stateOf(c.id)));
  const awaitingCredits = credits.filter((c) => stateOf(c.id) === "AWAITING_PAYOUT");

  const payoutsByProvider = new Map<string, { total: number; count: number; lastDate: string | null }>();
  for (const c of credits) {
    const provider = c.gateway_guess || "Unclassified";
    const p = payoutsByProvider.get(provider) || { total: 0, count: 0, lastDate: null };
    p.total += Number(c.amount);
    p.count += 1;
    if (!p.lastDate || (c.statement_date && c.statement_date > p.lastDate)) p.lastDate = c.statement_date;
    payoutsByProvider.set(provider, p);
  }

  // ── spotlight: the single most recent order, full chain detail ───────────
  const refsSeen = new Set<string>();
  for (const p of payoutsWithRefs) {
    for (const ref of p.order_refs) {
      refsSeen.add(ref);
      refsSeen.add(ref.replace(/^(WA|UAE|KSA|WOO)/i, ""));
    }
  }
  const spotlight = spotlightOrder
    ? (() => {
        const settled = spotlightOrder.payout_status === "settled";
        const inPayoutFile = settled || refsSeen.has(spotlightOrder.order_number);
        const financeStatus =
          spotlightOrder.gateway === "COD"
            ? "COD_PENDING"
            : settled
              ? "SETTLED"
              : inPayoutFile
                ? "AWAITING_BANK"
                : "MISSING_PAYOUT";
        const inStock = spotlightOrder.line_items?.every((li) => li.stock == null || li.stock > 0) ?? true;
        const hasStockData = spotlightOrder.line_items?.some((li) => li.stock != null) ?? false;
        const etaDays = spotlightOrder.country?.toUpperCase() === "AE" ? 2 : 4;
        const eta = new Date(Date.now() + etaDays * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        const firstName = spotlightOrder.customer_name.split(" ")[0] || "there";
        const draftMessage =
          `Hi ${firstName}, thank you for your order #${spotlightOrder.order_number} from Omnia! ` +
          `${spotlightOrder.courier ? `It's on its way with ${spotlightOrder.courier}` : "We're preparing it for shipment"} ` +
          `and should reach you by ${eta}.` +
          (spotlightOrder.tracking_url ? ` Track it here: ${spotlightOrder.tracking_url}` : "");

        return {
          uid: spotlightOrder.uid,
          order_number: spotlightOrder.order_number,
          store_id: spotlightOrder.store_id,
          order_date: spotlightOrder.order_date,
          gross_aed: Number(spotlightOrder.gross_aed || 0),
          gateway: spotlightOrder.gateway,
          finance_status: financeStatus,
          fulfillment_status: spotlightOrder.fulfillment_status,
          inventory: hasStockData ? (inStock ? "in_stock" : "out_of_stock") : "unknown",
          courier: spotlightOrder.courier || null,
          tracking_number: spotlightOrder.tracking_number || null,
          tracking_url: spotlightOrder.tracking_url || null,
          eta_date: eta,
          customer: {
            name: spotlightOrder.customer_name,
            email: spotlightOrder.customer_email,
            phone: spotlightOrder.customer_phone,
            city: spotlightOrder.city,
            country: spotlightOrder.country,
          },
          line_items: (spotlightOrder.line_items ?? []).slice(0, 5),
          draft_message: draftMessage,
        };
      })()
    : null;

  return NextResponse.json({
    window: { days, from: fromIso.slice(0, 10), store: storeFilter },
    kpis: {
      revenue: +revenue.toFixed(2),
      orders: inWindowFiltered.length,
      aov: inWindowFiltered.length ? +(revenue / inWindowFiltered.length).toFixed(2) : 0,
      bankCredits: +credits.reduce((s, c) => s + Number(c.amount), 0).toFixed(2),
      bankDebits: +debits.reduce((s, c) => s + Number(c.amount), 0).toFixed(2),
      settled: +settledCredits.reduce((s, c) => s + Number(c.amount), 0).toFixed(2),
      awaitingPayout: +awaitingCredits.reduce((s, c) => s + Number(c.amount), 0).toFixed(2),
      exceptions: exceptionCredits.length,
      codPendingAed: orderCounts.codPendingAed,
      codPendingCount: orderCounts.codPendingCount,
      settledOrders: orderCounts.settledOrders,
      totalOrders: orderCounts.totalOrders,
    },
    previous: {
      revenue: +prevRevenue.toFixed(2),
      orders: prevWindow.length,
      aov: prevWindow.length ? +(prevRevenue / prevWindow.length).toFixed(2) : 0,
    },
    trend,
    stores: [...storeAgg.entries()]
      .map(([store, v]) => ({ store, revenue: +v.revenue.toFixed(2), orders: v.orders }))
      .sort((a, b) => b.revenue - a.revenue),
    gateways: [...gatewayAgg.entries()]
      .map(([gateway, v]) => ({
        gateway,
        revenue: +v.revenue.toFixed(2),
        orders: v.orders,
        share: revenue ? +(v.revenue / revenue * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    payouts: {
      byProvider: [...payoutsByProvider.entries()]
        .map(([provider, v]) => ({ provider, total: +v.total.toFixed(2), count: v.count, lastDate: v.lastDate }))
        .sort((a, b) => b.total - a.total),
      recent: credits.slice(0, 12).map((c) => ({
        id: c.id,
        date: c.statement_date,
        provider: c.gateway_guess || "Unclassified",
        amount: Number(c.amount),
        reference: c.reference,
        state: stateOf(c.id),
        confirmed: Boolean(reconByBankLine.get(c.id)?.confirmed_by),
      })),
      uploadedBatches: (payoutsRes.data ?? []).length,
    },
    topProducts,
    spotlight,
    recentOrders: inWindowFiltered.slice(0, 8).map((o) => ({
      uid: o.uid, store_id: o.store_id, order_number: o.order_number,
      order_date: o.order_date, customer_name: o.customer_name,
      gross_aed: Number(o.gross_aed || 0), gateway: o.gateway,
      payout_status: o.payout_status, financial_status: o.financial_status,
    })),
    documents: {
      bankStatement: bankLines.length > 0,
      lastStatementDate: bankLines[0]?.statement_date ?? null,
    },
  });
}
