

"use client";

import { useEffect, useState } from "react";
import {
  ChevronRight, Loader2, Package, RotateCcw, ShieldCheck, Truck, AlertTriangle, Download,
  BadgeCheck, CheckCircle2, AlertCircle, ExternalLink,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { aed2, fmtOriginal, type LineItem, type OrderDetail, type ReconLine, type ReconTxn } from "./types";
import type { InvoiceStatus } from "@/app/api/reconcile/line/[id]/invoices/route";
import type { SettlementRecord } from "@/lib/repositories/settlements.repository";

/* Per-order proof, and the products behind each order.
 *
 * The reader is a bookkeeper, not an engineer: this leads with one plain
 * sentence answering "can I trust this number", keeps the table as supporting
 * detail, and only then lets a row be opened down to the products. Two reasons
 * a figure can move are named separately rather than merged —
 *   rate drift: our estimate vs the rate the bank actually used. Not a charge.
 *   FX fee:     what the gateway genuinely deducted. A real cost.
 * Conflating them is what makes a correct statement look wrong.
 *
 * Payment recording used to live behind a separate dialog (record-payments-
 * dialog.tsx) that re-fetched /invoices, /settlements, and /account-config
 * every time it opened. That's folded in here now: one Promise.all alongside
 * the existing invoice-status effect, row checkboxes for multi-select, and a
 * per-row "Record" button — no dialog, no second round of API calls.
 */

type OrdersResponse = { orders: OrderDetail[]; missing: string[] };

type PaymentRowStatus =
  | { status: "ready" }
  | { status: "posted"; paymentId: string }
  | { status: "failed"; error: string; needsManualReview: boolean }
  | { status: "review"; reason: string }
  | { status: "paid_external"; invoiceId: string; invoiceStatus: "paid" | "partially_paid" }
  | { status: "overdue"; invoiceId: string }
  | { status: "not_in_zoho" };

type ZohoAccount = { account_id: string; account_name: string; account_type: string; is_active: boolean };
type PublishResult = { settlementId: string; ok: boolean; error?: string; paymentId?: string; needsManualReview?: boolean };

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

/* ── Small status pill, shared by the table rows ────────────────────────── */

function PaymentRowPill({ s }: { s: PaymentRowStatus }) {
  const map = {
    ready:          { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "unpaid" },
    posted:         { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "posted" },
    failed:         { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "failed" },
    review:         { cls: "bg-[#FBF0DB] text-[#946E1F]", text: "needs review" },
    paid_external:  { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "paid" },      // Zoho says paid, not by us
    overdue:        { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "overdue" },
    not_in_zoho:    { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "no invoice" },
  } as const;

  const cfg = map[s.status];
  const title =
    s.status === "posted"        ? `payment ${s.paymentId}` :
    s.status === "failed"        ? s.error :
    s.status === "review"        ? s.reason :
    s.status === "paid_external" ? `Zoho invoice ${s.invoiceId} — ${s.invoiceStatus}` :
    s.status === "overdue"       ? `Zoho invoice ${s.invoiceId} — past due` :
    s.status === "not_in_zoho"   ? "No matching Zoho invoice — run a sync" :
    undefined;

  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cfg.cls}`}>
      {s.status === "posted" && <ExternalLink size={9} />}
      {cfg.text}
    </span>
  );
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

function ProofRow({
  t, order, missing, open, onToggle, zoho, originalCurrency,
  canSelect, selected, onSelectToggle, onRecordOne, posting,canRecordAnything
}: {
  t: ReconTxn;
  order: OrderDetail | undefined;
  missing: boolean;
  open: boolean;
  onToggle: () => void;
  zoho?: PaymentRowStatus;
  canRecordAnything:boolean;
  /** Non-null only for cross-currency payouts (Tabby/Tamara SAR & KWD) —
   *  renders the order's own source-file amount alongside the AED figure. */
  originalCurrency?: string | null;
  /** Whether this row has a settlement record and is in a postable state. */
  canSelect: boolean;
  selected: boolean;
  onSelectToggle: () => void;
  onRecordOne: () => void;
  posting: boolean;
}) {
  const colCount = (originalCurrency ? 6 : 5) + (canSelect ? 1 : 0);
  return (
    <>
      <tr
        className={`border-t border-[#EAE3D6] transition-colors hover:bg-[#FBF3E6] ${
          open ? "bg-[#FBF3E6]" : ""
        } ${t.isRefund ? "text-[#8A8175]" : "text-[#1F1B16]"}`}
      >
       {canRecordAnything && (
          <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
            {canSelect && (
              <Checkbox checked={selected} onCheckedChange={() => onSelectToggle()} disabled={posting} />
            )}
          </td>
        )}
        <td className="px-3 py-2 cursor-pointer" onClick={onToggle}>
          <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]">
            <ChevronRight
              size={13}
              className="text-[#8A8175] transition-transform"
              style={{ transform: open ? "rotate(90deg)" : "none" }}
            />
            #{t.ref}
          </span>
        </td>
        {originalCurrency && (
          <td className="px-3 py-2 text-right font-mono tabular-nums text-[#8A8175] cursor-pointer" onClick={onToggle}>
            {t.netOriginal != null ? fmtOriginal(t.netOriginal, originalCurrency) : "—"}
          </td>
        )}
        <td className="px-3 py-2 text-right font-mono tabular-nums cursor-pointer" onClick={onToggle}>{aed2(t.grossShare)}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums cursor-pointer" onClick={onToggle}>{aed2(t.feeShare)}</td>
        <td className="px-3 py-2 text-right font-mono font-medium tabular-nums cursor-pointer" onClick={onToggle}>{aed2(t.netShare)}</td>
        <td className="px-3 py-2 text-right">
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {t.isRefund && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F3EFE7] px-2 py-0.5 text-[11px] font-medium text-[#8A8175]">
                <RotateCcw size={10} /> refund
              </span>
            )}
            {zoho && <PaymentRowPill s={zoho} />}
            {canSelect && (
              <button
                onClick={(e) => { e.stopPropagation(); onRecordOne(); }}
                disabled={posting}
                title="Record this order's payment in Zoho"
                className="inline-flex items-center gap-1 rounded-full border border-[#D6CCBA] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#1F1B16] transition-colors hover:border-[#B08343] hover:text-[#6F5325] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BadgeCheck size={10} /> Record
              </button>
            )}
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={colCount} className="border-t border-[#EAE3D6] bg-[#FBF8F1] px-4 py-3">
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
  const [useInvoiceBalanceAsAmount, setUseInvoiceBalanceAsAmount] = useState(false);
  const [writeOffFee, setWriteOffFee] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrdersResponse | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [zohoByRef, setZohoByRef] = useState<Map<string, PaymentRowStatus>>(new Map());

  // Payment-recording setup — fetched once, alongside invoice status, not
  // re-fetched every time a dialog would have opened.
  const [settlements, setSettlements] = useState<SettlementRecord[] | null>(null);
  const [accounts, setAccounts] = useState<ZohoAccount[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [useCustomRef, setUseCustomRef] = useState(false);
  const [customRef, setCustomRef] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [loadingPaymentSetup, setLoadingPaymentSetup] = useState(false);

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

  // Invoice status (keyed by order_number) + settlement records + the Zoho
  // deposit-account config, all in one pass, once the settlement is
  // confirmed — this replaces the separate dialog's three fetches.
  useEffect(() => {
    if (!r.confirmedBy) return;
    let alive = true;
    setLoadingPaymentSetup(true);
    Promise.all([
      fetch(`/api/reconcile/line/${encodeURIComponent(r.id)}/invoices`).then((x) => x.json()),
      fetch(`/api/reconcile/line/${encodeURIComponent(r.id)}/settlements`).then((x) => x.json()),
      fetch("/api/integrations/zoho/account-config").then((x) => x.json()),
    ])
      .then(([invoicesJson, settlementsJson, configJson]: [
        { statuses?: Record<string, InvoiceStatus> },
        { settlements?: SettlementRecord[] },
        { bankAccounts?: ZohoAccount[]; effective?: { bankAccountId?: string } },
      ]) => {
        if (!alive) return;

        const statuses = invoicesJson.statuses ?? {};
        setZohoByRef((prev) => {
          const next = new Map(prev);
          for (const [ref, iv] of Object.entries(statuses)) {
            const current = next.get(ref);
            if (current?.status === "posted" || current?.status === "failed") continue;

            if (iv.status === "paid" || iv.status === "partially_paid") {
              next.set(ref, { status: "paid_external", invoiceId: iv.invoiceId, invoiceStatus: iv.status });
            } else if (iv.status === "overdue") {
              next.set(ref, { status: "overdue", invoiceId: iv.invoiceId });
            } else {
              next.set(ref, { status: "ready" });
            }
          }
          return next;
        });

        setSettlements(settlementsJson.settlements ?? []);
        setAccounts(configJson.bankAccounts ?? []);
        const def = configJson.effective?.bankAccountId ?? "";
        setDefaultAccountId(def);
        setAccountId(def);
      })
      .catch(() => {})
      .finally(() => alive && setLoadingPaymentSetup(false));
    return () => { alive = false; };
  }, [r.id, r.confirmedBy]);

  const orderByNumber = new Map((orders?.orders ?? []).map((o) => [o.order_number, o]));
  const missingSet = new Set(orders?.missing ?? []);
  const settlementByRef = new Map((settlements ?? []).map((s) => [s.order_number, s]));

  // A row can be recorded if it has a settlement record and its current
  // status is either untouched or overdue (not already posted/paid/failed).
  const postableRefs = txns
    .filter((t) => !t.isRefund && settlementByRef.has(t.ref))
    .filter((t) => {
      const st = zohoByRef.get(t.ref)?.status;
      return st === undefined || st === "ready" || st === "overdue";
    })
    .map((t) => t.ref);

  const toggleSelect = (ref: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === postableRefs.length ? new Set() : new Set(postableRefs)));
  };

  const recordPayments = async (refs: string[]) => {
    if (refs.length === 0 || !accountId) return;
    setPosting(true);
    setPublishError(null);
    try {
      const settlementIds = refs
        .map((ref) => settlementByRef.get(ref)?.id)
        .filter((id): id is string => !!id);
  
      const res = await fetch("/api/settlements/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankLineId: r.id,
          accountId,
          referenceNumberOverride: useCustomRef && customRef.trim() ? customRef.trim() : undefined,
          settlementIds,
          writeOffResidualAsFee: writeOffFee,
        }),
      });
      const json = (await res.json()) as { results?: PublishResult[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const settlementIdToRef = new Map((settlements ?? []).map((s) => [s.id, s.order_number]));
      setZohoByRef((prev) => {
        const next = new Map(prev);
        for (const result of json.results ?? []) {
          const ref = settlementIdToRef.get(result.settlementId);
          if (!ref) continue;
          if (!result.ok && result.error === "Already published" && next.get(ref)?.status === "posted") {
            // Harmless, expected result of resubmitting a partially-posted
            // payout — don't clobber a row that already shows "posted".
            continue;
          }
          next.set(
            ref,
            result.ok
              ? { status: "posted", paymentId: result.paymentId! }
              : { status: "failed", error: result.error ?? "Unknown error", needsManualReview: !!result.needsManualReview },
          );
        }
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        refs.forEach((ref) => next.delete(ref));
        return next;
      });
    } catch (e) {
      setPublishError((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

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

  const canRecordAnything = !!r.confirmedBy && postableRefs.length > 0;
  const selectedCount = selected.size;

  function derivePaymentMode(gateway: string): "Cash on Delivery" | "Credit Card" {
    const g = (gateway ?? "").toUpperCase().replace(/[\s_-]+/g, "");
    return g === "COD" || g === "ONTRACK" || g === "CASHONDELIVERY" ? "Cash on Delivery" : "Credit Card";
  }
  const canPublish =
  !posting &&
  accountId &&                    // account picked
  r.date &&                        // bank credit date exists
  postableRefs.length > 0;
  return (
    <div className="mb-3.5 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3.5">
      {/* <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6F5325]">
          <ShieldCheck size={13} className="text-[#B08343]" /> {r.provider} proof
        </span>
        <span className="text-[11px] text-[#8A8175]">{sourceLabel}</span>

      </div> */}
        <div className="ml-auto flex justify-end flex-wrap items-center gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-white px-2.5 py-1 text-[12px] font-medium text-[#1F1B16] transition-colors hover:border-[#B08343] hover:text-[#6F5325]"
          >
            <Download size={12} /> Export CSV
          </button>
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

      {/* Payment recording bar — only for confirmed settlements, only when
          there's something left to post. No dialog: account + reference
          controls sit right here, using data already loaded above. */}
      {r.confirmedBy && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-[#EAE3D6] bg-white px-3 py-2">
          {loadingPaymentSetup ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#8A8175]">
              <Loader2 size={12} className="animate-spin" /> Loading payment setup…
            </span>
          ) : !canRecordAnything ? (
            <span className="text-[12px] text-[#8A8175]">No orders left to record — all posted or paid.</span>
          ) : (
            <>
              {/* <span className="text-[12px] font-medium text-[#1F1B16]">
                {selectedCount > 0 ? `${selectedCount} selected` : `${postableRefs.length} ready to record`}
              </span> */}
                          {selectedCount > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-[#FBF3E6] px-2.5 py-1 text-[11.5px] text-[#6F5325]">
                <span>Will post:</span>
                <span className="font-medium">
                  {r.date ? new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no date"}
                </span>
                <span>"·"</span>
                <span className="font-medium">{derivePaymentMode(r.provider)}</span>
                <span>·</span>
                <span className="font-medium">
                  {accounts.find((a) => a.account_id === accountId)?.account_name ?? "no account"}
                </span>
                {writeOffFee && (
                  <>
                    <span>·</span>
                    <span className="font-medium text-[#946E1F]">gap posted as gateway fee, invoice closes Paid</span>
                  </>
                )}
              </div>
            )}

              {accounts.length === 0 ? (
                <span className="text-[12px] text-[#A6472F]">No deposit account configured in Zoho Settings.</span>
              ) : (
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="h-8 w-52 border-[#D6CCBA] text-[12px]">
                    <SelectValue placeholder="Select an account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.account_id} value={a.account_id}>
                        {a.account_name}
                        {a.account_id === defaultAccountId ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <label className="flex items-center gap-1.5 text-[12px] text-[#1F1B16]">
                <Checkbox checked={useCustomRef} onCheckedChange={(v) => setUseCustomRef(v === true)} />
                Custom reference
              </label>
              {useCustomRef && (
                <Input
                  value={customRef}
                  onChange={(e) => setCustomRef(e.target.value)}
                  placeholder="e.g. Batch 42"
                  className="h-8 w-36 border-[#D6CCBA] text-[12px]"
                />
              )}
              

              {/* <label
                className="flex items-center gap-1.5 text-[12px] text-[#1F1B16]"
                title="If the settlement amount is a few AED short of the invoice total (the gateway's fee), post that gap as an expense so the invoice closes to Paid instead of sitting on a small residual."
              >
                <Checkbox checked={writeOffFee} onCheckedChange={(v) => setWriteOffFee(v === true)} />
                Write off gateway fee to close invoice
              </label> */}
              <button
                onClick={() => recordPayments(selectedCount > 0 ? [...selected] : postableRefs)}
                disabled={posting || accounts.length === 0 || !accountId}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#6F5325] px-3 py-1.5 text-[12px] font-medium text-[#FBF8F1] hover:bg-[#5A4320] disabled:cursor-not-allowed disabled:bg-[#B8B0A0]"
              >
                {posting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Record {selectedCount > 0 ? selectedCount : postableRefs.length} payment
                {(selectedCount > 0 ? selectedCount : postableRefs.length) === 1 ? "" : "s"}
              </button>
              <label
              className="flex items-center gap-1.5 text-[12px] text-[#1F1B16]"
              title="Posts the invoice's full amount as received into the selected Deposit To account and closes the invoice. Use this when the gateway fee will be booked separately (e.g. journaled out of the clearing account)."
            >
              <Checkbox
                checked={useInvoiceBalanceAsAmount}
                onCheckedChange={(v) => setUseInvoiceBalanceAsAmount(v === true)}
              />
              Post full invoice amount (fee handled separately)
            </label>

              {selectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-[#FBF3E6] px-2.5 py-1 text-[11.5px] text-[#6F5325]">
              <span>Will post:</span>
              <span className="font-medium">
                {r.date ? new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no date"}
              </span>
              <span>·</span>
              <span className="font-medium">{derivePaymentMode(r.provider)}</span>
              <span>·</span>
              <span className="font-medium">
                {accounts.find((a) => a.account_id === accountId)?.account_name ?? "no account"}
              </span>
            </div>
          )}
            </>
          )}
        </div>
      )}

      {publishError && (
        <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> {publishError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[#EAE3D6] bg-white">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#FBF8F1]">
              {canRecordAnything && (
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    checked={postableRefs.length > 0 && selected.size === postableRefs.length}
                    onCheckedChange={toggleSelectAll}
                    disabled={posting}
                  />
                </th>
              )}
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
                canSelect={canRecordAnything && postableRefs.includes(t.ref)}
                selected={selected.has(t.ref)}
                onSelectToggle={() => toggleSelect(t.ref)}
                onRecordOne={() => recordPayments([t.ref])}
                posting={posting}
                canRecordAnything={canRecordAnything}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#D6CCBA] bg-[#FBF8F1]">
              <td className="px-3 py-2 font-medium text-[#6F5325]" colSpan={canRecordAnything ? 2 : 1}>Net settled</td>
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