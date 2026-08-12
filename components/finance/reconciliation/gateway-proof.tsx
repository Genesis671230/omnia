"use client";

import { useEffect, useState } from "react";
import {
  ChevronRight, Loader2, Package, RotateCcw, ShieldCheck, Truck, AlertTriangle, Download,
} from "lucide-react";
import { aed2, type LineItem, type OrderDetail, type ReconLine, type ReconTxn } from "./types";
import { RecordPaymentsBar, PaymentRowPill, type PaymentRowStatus } from "./record-payments-dialog";
/* Per-order proof, and the products behind each order.
 *
 * The reader is a bookkeeper, not an engineer: this leads with one plain
 * sentence answering "can I trust this number", keeps the table as supporting
 * detail, and only then lets a row be opened down to the products. Two reasons
 * a figure can move are named separately rather than merged —
 *   rate drift: our estimate vs the rate the bank actually used. Not a charge.
 *   FX fee:     what the gateway genuinely deducted. A real cost.
 * Conflating them is what makes a correct statement look wrong.
 */

type OrdersResponse = { orders: OrderDetail[]; missing: string[] };

function itemName(li: LineItem) {
  return li.title || li.name || li.sku || "Item";
}
function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}
/** Live rows carry qty + total_aed but no unit price, so unit is derived.
 *  Older rows use the quantity/total aliases. */
function itemFigures(li: LineItem) {
  const qty = num(li.qty ?? li.quantity) || 1;
  const total = num(li.total_aed ?? li.total) || num(li.price) * qty;
  return { qty, total, unit: qty > 0 ? total / qty : total };
}

/* ── The products behind one order ──────────────────────────────────────── */

function OrderProducts({ order, missing }: { order: OrderDetail | undefined; missing: boolean }) {
  if (missing || !order) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-[#F9ECE7] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#A6472F]">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          This order is on the payout file but not in the synced orders, so there are no products to show.
          Run a sync — the credit can&apos;t be called settled until every order it pays for is accounted for.
        </span>
      </div>
    );
  }

  const items = order.line_items ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {[
          ["Customer", order.customer_name || "—"],
          ["Where", [order.city, order.country].filter(Boolean).join(", ") || "—"],
          ["Store", order.store_id || "—"],
          ["Order total", aed2(num(order.gross_aed))],
        ].map(([k, v]) => (
          <div key={k as string} className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-[#8A8175]">{k}</div>
            <div className="truncate text-[13px] font-medium text-[#1F1B16]">{v}</div>
          </div>
        ))}
      </div>

      {order.awb_number && (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F1F3] px-2.5 py-1 text-[11.5px] font-medium text-[#2E6B7A]">
          <Truck size={12} /> AWB {order.awb_number}
          {order.courier ? ` · ${order.courier}` : ""}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-[12.5px] text-[#8A8175]">
          No product lines were captured for this order at sync time.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((li, i) => {
            const { qty, total, unit } = itemFigures(li);
            return (
              <div key={i} className="flex gap-3 rounded-lg border border-[#EAE3D6] bg-white p-2.5">
                {li.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={li.image_url}
                    alt=""
                    loading="lazy"
                    className="h-14 w-14 flex-shrink-0 rounded-md border border-[#EAE3D6] object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-[#D6CCBA] text-[#D6CCBA]">
                    <Package size={18} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-[#1F1B16]">{itemName(li)}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-[#8A8175]">{li.sku || "no SKU"}</p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 text-[11.5px]">
                    <span className="text-[#8A8175]">
                      {qty} × <span className="tabular-nums">{unit ? aed2(unit) : "—"}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-[#1F1B16]">{total ? aed2(total) : "—"}</span>
                    {typeof li.stock === "number" && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${
                          li.stock > 0 ? "bg-[#F0F5EF] text-[#4B7A54]" : "bg-[#F9ECE7] text-[#A6472F]"
                        }`}
                      >
                        {li.stock > 0 ? `${li.stock} in stock` : "out of stock"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── One row of the proof table, expandable to its products ─────────────── */

function ProofRow({ t, order, missing, open, onToggle, zoho }: {
  t: ReconTxn;
  order: OrderDetail | undefined;
  missing: boolean;
  open: boolean;
  onToggle: () => void;
  zoho?: PaymentRowStatus;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-t border-[#EAE3D6] transition-colors hover:bg-[#FBF3E6] ${
          open ? "bg-[#FBF3E6]" : ""
        } ${t.isRefund ? "text-[#8A8175]" : "text-[#1F1B16]"}`}
      >
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]">
            <ChevronRight
              size={13}
              className="text-[#8A8175] transition-transform"
              style={{ transform: open ? "rotate(90deg)" : "none" }}
            />
            #{t.ref}
          </span>
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums">{aed2(t.grossShare)}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums">{aed2(t.feeShare)}</td>
        <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">{aed2(t.netShare)}</td>
        <td className="px-3 py-2 text-right">
          <span className="inline-flex flex-wrap items-center justify-end gap-1">
            {t.isRefund && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F3EFE7] px-2 py-0.5 text-[11px] font-medium text-[#8A8175]">
                <RotateCcw size={10} /> refund
              </span>
            )}
            {zoho && <PaymentRowPill s={zoho} />}
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="border-t border-[#EAE3D6] bg-[#FBF8F1] px-4 py-3">
            <OrderProducts order={order} missing={missing} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── The proof panel ────────────────────────────────────────────────────── */

export function GatewayProof({ r, live }: {
  r: ReconLine;
  /** Stripe rows pass their live API transactions; everyone else uses the
   *  engine's rescaled shares from the uploaded file. */
  live?: { transactions: ReconTxn[]; net: number; sourceLabel: string } | null;
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrdersResponse | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [zohoByRef, setZohoByRef] = useState<Map<string, PaymentRowStatus>>(new Map());
  const txns = live?.transactions ?? r.transactions;
  const net = live?.net ?? r.payout?.net ?? 0;
  const sourceLabel = live?.sourceLabel ?? `from ${r.payout?.source ?? r.payout?.id ?? "payout file"}`;

  const sum = +txns.reduce((s, t) => s + t.netShare, 0).toFixed(2);
  const foots = Math.abs(sum - net) < 0.01;
  const refunds = txns.filter((t) => t.isRefund).length;

  // One request for the whole credit, the first time any order is opened —
  // not one per click.
  useEffect(() => {
    if (!openRow || orders || loadingOrders) return;
    setLoadingOrders(true);
    fetch(`/api/reconcile/line/${encodeURIComponent(r.id)}/orders`)
      .then((x) => x.json())
      .then((d: OrdersResponse & { error?: string }) => {
        if (d.error) throw new Error(d.error);
        setOrders(d);
      })
      .catch(() => setOrders({ orders: [], missing: txns.map((t) => t.ref) }))
      .finally(() => setLoadingOrders(false));
  }, [openRow, orders, loadingOrders, r.id, txns]);

  const orderByNumber = new Map((orders?.orders ?? []).map((o) => [o.order_number, o]));
  const missingSet = new Set(orders?.missing ?? []);

  const exportCsv = () => {
    const head = [
      `Bank reference,${r.reference}`,
      `Date,${r.date ?? ""}`,
      `Gateway,${r.provider}`,
      `Payout,${r.payout?.id ?? ""}`,
      `Net settled,${net}`,
      "",
      "Order,Gross AED,Fee AED,Net AED,Refund",
    ];
    const body = txns.map((t) => `${t.ref},${t.grossShare},${t.feeShare},${t.netShare},${t.isRefund ? "yes" : "no"}`);
    const blob = new Blob([[...head, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recon-${r.provider}-${r.reference || r.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-3.5 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6F5325]">
    <ShieldCheck size={13} className="text-[#B08343]" /> {r.provider} proof
  </span>
  <span className="text-[11px] text-[#8A8175]">{sourceLabel}</span>

  <div className="ml-auto flex flex-wrap items-center gap-2">
    <button
      onClick={exportCsv}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-white px-2.5 py-1 text-[12px] font-medium text-[#1F1B16] transition-colors hover:border-[#B08343] hover:text-[#6F5325]"
    >
      <Download size={12} /> Export CSV
    </button>
    <RecordPaymentsBar
      line={r}
      onResult={setZohoByRef}
    />
  </div>
</div>

      <p className="mb-2 text-[13px] leading-relaxed text-[#1F1B16]">
        {foots ? (
          <>
            All <b>{txns.length}</b> order{txns.length === 1 ? "" : "s"} in this payout add up to the{" "}
            <b className="tabular-nums">{aed2(net)}</b> the bank credited.
          </>
        ) : (
          <>
            These orders add up to <b className="tabular-nums">{aed2(sum)}</b>, but the bank credited{" "}
            <b className="tabular-nums">{aed2(net)}</b> — a <b className="tabular-nums">{aed2(Math.abs(sum - net))}</b>{" "}
            gap worth checking before this is treated as proven.
          </>
        )}
        {refunds > 0 && <> {refunds} refund{refunds === 1 ? " is" : "s are"} included and subtracted.</>}
      </p>

      {r.payout?.currency && (
        <p className="mb-2.5 text-[13px] leading-relaxed text-[#1F1B16]">
          Paid in <b>{r.payout.currency}</b>, converted at <b>{r.payout.fxRate ?? "—"} AED</b>
          {r.payout.fxSource === "bank"
            ? " (the rate the bank actually used)"
            : " (our estimate — the bank did not quote one)"}
          .
          {r.fxFeeAed != null && r.fxFeeAed > 0 && (
            <> {r.provider} kept <b className="tabular-nums">{aed2(r.fxFeeAed)}</b> in fees on the way.</>
          )}
          {r.rateDriftAed != null && Math.abs(r.rateDriftAed) >= 0.01 && (
            <> Our earlier estimate was off by <b className="tabular-nums">{aed2(Math.abs(r.rateDriftAed))}</b>; the
              figures below use the bank&apos;s real rate, so nobody charged you that difference.</>
          )}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-[#EAE3D6] bg-white">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#FBF8F1]">
              <th className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Order</th>
              <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Gross</th>
              <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Fee</th>
              <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Net</th>
              <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]" />
            </tr>
          </thead>
          <tbody>
          {txns.map((t, i) => (
  <ProofRow
    key={t.ref + i}
    t={t}
    order={orderByNumber.get(t.ref)}
    missing={orders != null && missingSet.has(t.ref)}
    open={openRow === t.ref + i}
    onToggle={() => setOpenRow(openRow === t.ref + i ? null : t.ref + i)}
    zoho={zohoByRef.get(t.ref)}
  />
))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#D6CCBA] bg-[#FBF8F1]">
              <td className="px-3 py-2 font-medium text-[#6F5325]">Net settled</td>
              <td colSpan={2} />
              <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-[#6F5325]">{aed2(net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[#8A8175]">
        {loadingOrders ? (
          <><Loader2 size={12} className="animate-spin" /> Loading products…</>
        ) : (
          <><Package size={12} /> Click any order to see the products it paid for.</>
        )}
      </p>
    </div>
  );
}
