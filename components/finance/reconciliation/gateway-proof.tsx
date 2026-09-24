"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight, Loader2, Package, RotateCcw, Truck, AlertTriangle, Download,
  BadgeCheck, CheckCircle2, AlertCircle, Eye, RefreshCw, Link2, Unlink, Search, Undo2, Gavel,
} from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { aed2, fmtOriginal, type LineItem, type OrderDetail, type ReconLine, type ReconTxn } from "./types";
import type { InvoiceStatus } from "@/app/api/reconcile/line/[id]/invoices/route";
import type { SettlementRecord } from "@/lib/repositories/settlements.repository";
import type { PostingOptions } from "@/lib/integrations/zoho-settlement-posting";
import type { OrderPublishResult, WirePublishResult } from "@/lib/finance/publish-settlements";
import type { RefundResult } from "@/lib/finance/publish-refunds";
import { ForceOrderPanel } from "./force-order-panel";
import { DeliveryChargesPanel } from "./delivery-charges-panel";
import {
  bankScaleFor,
  isCrossBorderCurrency,
  planOrderPosting,
  planWireResidual,
  suggestPostingAccounts,
  vatInclusiveSplit,
} from "@/lib/finance/settlement-posting";

/* Per-order proof, the products behind each order, and booking the payout
 * into Zoho.
 *
 * The reader is a bookkeeper, not an engineer: this leads with one plain
 * sentence answering "can I trust this number", keeps the table as supporting
 * detail, and only then lets a row be opened down to the products. Two reasons
 * a figure can move are named separately rather than merged —
 *   rate drift: our estimate vs the rate the bank actually used. Not a charge.
 *   FX fee:     what the gateway genuinely deducted. A real cost.
 *
 * Booking (lib/finance/publish-settlements.ts), per order:
 *   1. customer payment for the invoice's full balance → Deposit To (clearing)
 *   2. gateway fee expense paid from clearing — AED payouts VAT-inclusive
 *      (Tabby fee includes VAT: fee ÷ 105 × 5; Tamara charges VAT on top:
 *      Total Fees × 5%), SAR/KWD payouts without VAT
 *   3. invoice − fee − AED received → Exchange Gain or Loss
 * "Preview" runs the same thing read-only against Zoho first.
 */

type OrdersResponse = { orders: OrderDetail[]; missing: string[] };

type RowStatus =
  | { kind: "booked"; title?: string }
  | { kind: "not_closed"; title?: string }
  | { kind: "no_settlement"; title?: string }
  | { kind: "planned"; title?: string }
  | { kind: "fee_pending"; title?: string }
  | { kind: "unpaid"; title?: string }
  | { kind: "overdue"; title?: string }
  | { kind: "stale"; title?: string }
  | { kind: "paid"; title?: string }
  | { kind: "paid_external"; title?: string }
  | { kind: "review"; title?: string }
  | { kind: "failed"; title?: string }
  | { kind: "busy"; title?: string }
  | { kind: "no_invoice"; title?: string }
  /** The settlement records could not be read. Says nothing about the order —
   *  deliberately distinct from `no_settlement`, which is a claim about data. */
  | { kind: "load_failed"; title?: string };

const PILL: Record<RowStatus["kind"], { cls: string; text: string }> = {
  booked:        { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "booked" },
  not_closed:    { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "not closed in Zoho" },
  no_settlement: { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "no settlement record" },
  planned:       { cls: "bg-[#E8F1F3] text-[#2E6B7A]", text: "preview ok" },
  fee_pending:   { cls: "bg-[#FBF0DB] text-[#946E1F]", text: "fee pending" },
  unpaid:        { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "unpaid" },
  overdue:       { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "overdue in Zoho" },
  stale:         { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "not re-checked" },
  paid:          { cls: "bg-[#F0F5EF] text-[#4B7A54]", text: "paid" },
  paid_external: { cls: "bg-[#F3EFE7] text-[#6F5325]", text: "paid by hand" },
  review:        { cls: "bg-[#FBF0DB] text-[#946E1F]", text: "needs review" },
  failed:        { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "failed" },
  busy:          { cls: "bg-[#FBF0DB] text-[#946E1F]", text: "in progress" },
  no_invoice:    { cls: "bg-[#F9ECE7] text-[#A6472F]", text: "no invoice" },
  load_failed:   { cls: "bg-[#F3EFE7] text-[#8A8175]", text: "couldn't check" },
};

const bare = (ref: string) => ref.replace(/^#/, "").replace(/^(WA|UAE|KSA|WOO|SA)/i, "");
const isRealId = (v: string | null | undefined) =>
  !!v && !v.startsWith("CLAIMED:") && !v.startsWith("PENDING:");

/** Every Zoho document this order needs already exists. */
function fullyBooked(s: SettlementRecord): boolean {
  if (s.fee_aed == null || !isRealId(s.zoho_payment_id)) return false;
  const feeDone = Number(s.fee_aed) < 0.01 || isRealId(s.zoho_fee_expense_id);
  const fxDone = Math.abs(Number(s.fx_difference_aed ?? 0)) < 0.01 || isRealId(s.zoho_fx_journal_id);
  return feeDone && fxDone;
}

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

export function readPrefs(key: string): Partial<Record<string, string>> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}
export function writePrefs(key: string, value: Record<string, string>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window / blocked storage — the defaults still work */
  }
}

/* ── Small status pill, shared by the table rows ────────────────────────── */

function StatusPill({ s }: { s: RowStatus }) {
  const cfg = PILL[s.kind];
  return (
    <span title={s.title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cfg.cls}`}>
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

/* ── Linking a payout line to its real order ────────────────────────────── */

type LinkSuggestion = {
  orderNumber: string; store: string; customer: string; phone: string; amount: number;
  date: string | null; gateway: string; alreadySettled: boolean; reasons: string[];
};

/** A line whose reference isn't an order number (Tamara payment links often
 *  carry the customer's phone). Suggests orders by phone and amount; any order
 *  can be searched or typed. Linking re-runs matching, so the line becomes a
 *  normal order row — confirmable and bookable. */
function LinkOrderPanel({ payoutId, t, onChanged }: { payoutId: string; t: ReconTxn; onChanged?: () => void | Promise<void> }) {
  const linked = t.orderNumber && t.orderNumber !== t.ref && t.orderNumber !== bare(t.ref) ? t.orderNumber : null;
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [data, setData] = useState<{ amount: number; suggestions: LinkSuggestion[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (query = "") => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ payoutId, ref: t.ref, ...(query ? { q: query } : {}) });
      const res = await fetch(`/api/reconcile/ref-links?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (!linked) void load(); }, [payoutId, t.ref, linked]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (orderNumber: string) => {
    if (!orderNumber.trim()) return;
    setBusy(orderNumber);
    try {
      const res = await fetch("/api/reconcile/ref-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId, ref: t.ref, orderNumber: orderNumber.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(`Line ${t.ref} linked to order #${json.orderNumber}`);
      await onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    setBusy("unlink");
    try {
      const res = await fetch("/api/reconcile/ref-links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId, ref: t.ref }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(`Line ${t.ref} unlinked`);
      await onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (linked) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#D5E3D2] bg-[#F5FAF4] px-3 py-2 text-[12.5px] text-[#1F1B16]">
        <Link2 size={13} className="text-[#4B7A54]" />
        Line <b className="font-mono">{t.ref}</b> is linked to order <b className="font-mono">#{linked}</b>.
        <button
          onClick={unlink}
          disabled={busy === "unlink"}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-0.5 text-[11.5px] text-[#A6472F] hover:border-[#A6472F] disabled:opacity-50"
        >
          {busy === "unlink" ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />} Unlink
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-[#EBD3C9] bg-[#FDF6F3] px-3 py-2.5 text-[12.5px]">
      <p className="leading-relaxed text-[#6F5325]">
        <b className="font-mono text-[#1F1B16]">{t.ref}</b> isn&apos;t an order number
        {data ? <> (AED {Math.abs(data.amount).toFixed(2)})</> : null}. Link it to the real order — it then books like any other order.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(q); }}
            placeholder="Search order #, customer or phone"
            className="h-8 w-60 border-[#D6CCBA] bg-white text-[12px]"
          />
          <button onClick={() => load(q)} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 text-[12px] hover:border-[#B08343]">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Search
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void link(typed); }}
            placeholder="or type order #"
            className="h-8 w-32 border-[#D6CCBA] bg-white text-[12px]"
          />
          <button
            onClick={() => link(typed)}
            disabled={!typed.trim() || !!busy}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-[#6F5325] px-2.5 text-[12px] font-medium text-[#FBF8F1] hover:bg-[#5A4320] disabled:bg-[#B8B0A0]"
          >
            <Link2 size={12} /> Link
          </button>
        </div>
      </div>
      {loading && !data ? (
        <span className="inline-flex items-center gap-1.5 text-[#8A8175]"><Loader2 size={12} className="animate-spin" /> Finding likely orders…</span>
      ) : data && data.suggestions.length === 0 ? (
        <p className="text-[#8A8175]">No order with this phone or amount — search or type the order number.</p>
      ) : data ? (
        <ul className="divide-y divide-[#EBD3C9] rounded-md border border-[#EBD3C9] bg-white">
          {data.suggestions.map((o) => (
            <li key={o.orderNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5">
              <span className="font-mono font-medium text-[#1F1B16]">#{o.orderNumber}</span>
              <span className="text-[#6F5325]">{o.customer || "—"}</span>
              <span className="font-mono text-[11px] text-[#8A8175]">{o.phone}</span>
              <span className="tabular-nums text-[#1F1B16]">{aed2(o.amount)}</span>
              {o.date && <span className="text-[#8A8175]">{new Date(o.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
              <span className="text-[11px] text-[#8A8175]">{o.store} · {o.gateway}</span>
              {o.reasons.filter((x) => x !== "search").map((x) => (
                <span key={x} className="rounded-full bg-[#E8F1F3] px-1.5 py-0.5 text-[10.5px] text-[#2E6B7A]">{x}</span>
              ))}
              {o.alreadySettled && <span className="rounded-full bg-[#FBF0DB] px-1.5 py-0.5 text-[10.5px] text-[#946E1F]" title="This order is already settled by another payout">already settled</span>}
              <button
                onClick={() => link(o.orderNumber)}
                disabled={!!busy}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-0.5 text-[11.5px] font-medium hover:border-[#B08343] disabled:opacity-50"
              >
                {busy === o.orderNumber ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />} Link
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── Refunds netted out of the payout ──────────────────────────────────── */

type RefundRow = {
  ref: string; orderNumber: string | null; amount: number; booked: boolean;
  /** net − gross: + fee handed back, − extra charge. */
  charge: number; refundBooked: boolean; chargeBooked: boolean; chargeLegacy: boolean; chargeId: string | null;
  creditNoteId: string | null; creditNoteReused: boolean; refundId: string | null; error: string | null;
};

type LiveCN = {
  id: string; number: string; date: string; status: string; total: number; balance: number;
  refunds: { id: string; date: string; amount: number; mode: string; reference: string; description: string }[];
  staleRefundCleared?: boolean;
};

type AccountOpt = { id: string; name: string };

/** Each refund the gateway took back out of this payout becomes a credit note
 *  for the FULL refunded amount against the order's invoice (or reuses an open
 *  one already raised for that customer), closed by ONE refund of the full
 *  amount out of clearing. When the gateway handed its fee back, a journal
 *  under the same reference debits clearing and credits gateway charges — so
 *  clearing shows the net refund under one reference. An extra charge on a
 *  refund is expensed out of clearing.
 *  "Check credit notes" (and the booking bar's Re-check invoices) reads every
 *  credit note live from Zoho; any one still open can be closed by hand with
 *  full control of accounts, amounts and descriptions. */
function RefundsPanel({
  r, depositAccountId, depositName, reloadKey, feeAccountId, feeName, vatTaxId, inputVatAccountId, refreshSignal, accounts,
}: {
  r: ReconLine; depositAccountId: string; depositName: string; reloadKey: string;
  feeAccountId: string; feeName: string; vatTaxId: string; inputVatAccountId: string | null;
  /** Bumped by the booking bar's "Re-check invoices". */
  refreshSignal: number;
  /** Every account a credit note can be refunded from. */
  accounts: AccountOpt[];
}) {
  const [rows, setRows] = useState<RefundRow[] | null>(null);
  const [results, setResults] = useState<{ dryRun: boolean; results: RefundResult[] } | null>(null);
  const [busy, setBusy] = useState<"preview" | "post" | "live" | "restructure" | null>(null);
  const [restructuring, setRestructuring] = useState<string | null>(null);
  const [restructurePlan, setRestructurePlan] = useState<{
    creditNote: { number: string; total: number; open: number };
    delete: { id: string; reference: string; amount: number }[];
    refund: { amount: number; reference: string; from: string } | null;
    journal: { amount: number; vat: number; vatBasis: "original_fee" | "payout" | "none"; charges: number; reference: string; debit: string; credit: string; vatAccount: string | null } | null;
    netRefund: number;
    journalVatFix: { id: string; amount: number; vat: number; charges: number; vatBasis: string } | null;
  } | null>(null);
  const [live, setLive] = useState<Record<string, LiveCN | { error: string } | null> | null>(null);
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const prefKey = `omnia.refunds.feeRefundAccount.${r.provider}`;
  const [feeRefundAccountId, setFeeRefundAccountId] = useState("");

  useEffect(() => {
    const saved = readPrefs(prefKey).accountId;
    setFeeRefundAccountId(saved && accounts.some((a) => a.id === saved) ? saved : feeAccountId);
    // accounts is rebuilt by the parent on every render; its length is what changes.
  }, [prefKey, feeAccountId, accounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    try {
      const res = await fetch(`/api/settlements/refunds?bankLineId=${encodeURIComponent(r.id)}`);
      const json = await res.json();
      if (res.ok) setRows(json.refunds ?? []);
    } catch { /* the table still shows the refund lines */ }
  };
  const loadLive = async (quiet = false) => {
    setBusy("live");
    try {
      const res = await fetch(`/api/settlements/refunds/credit-notes?bankLineId=${encodeURIComponent(r.id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setLive(json.creditNotes ?? {});
      setLiveAt(json.checkedAt ?? null);
      const stale = Object.values(json.creditNotes ?? {}).filter((c) => c && "staleRefundCleared" in (c as object) && (c as LiveCN).staleRefundCleared).length;
      if (stale) toast.error(`${stale} refund(s) we had recorded were deleted in Zoho — they show as open again.`);
      else if (!quiet) toast.success("Credit notes read from Zoho.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => { void load(); }, [r.id, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (refreshSignal > 0) void loadLive(true); }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows || rows.length === 0) return null;
  const resultFor = (ref: string) => results?.results.find((x) => x.ref === ref);
  const liveFor = (ref: string): LiveCN | null => {
    const c = live?.[ref];
    return c && "id" in c ? c : null;
  };
  // Booked per our table AND (when read) no money left open on the credit note.
  const isDone = (x: RefundRow) => x.booked && !((liveFor(x.ref)?.balance ?? 0) > 0.009);
  const pending = rows.filter((x) => !isDone(x));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "";

  const restructure = async (x: RefundRow, dryRun: boolean) => {
    if (!depositAccountId) { toast.error("Pick the Deposit To account first."); return; }
    setBusy("restructure");
    try {
      const res = await fetch("/api/settlements/refunds/restructure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: r.id, ref: x.ref, depositAccountId, chargesAccountId: feeRefundAccountId, inputVatAccountId, vatTaxId, dryRun }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (dryRun) {
        setRestructuring(x.ref);
        setRestructurePlan(j.plan);
      } else {
        setRestructuring(null);
        setRestructurePlan(null);
        toast.success(`${j.plan.creditNote.number} rebooked: one full refund${j.plan.journal ? " + returned fee journal" : ""}.`);
        if (j.note) toast.error(j.note);
        await loadLive(true);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!depositAccountId) { toast.error("Pick the Deposit To account first."); return; }
    if (pending.some((x) => x.charge < -0.009 && !x.chargeBooked) && !feeAccountId) {
      toast.error("Pick the Gateway charges account first — extra refund charges book there."); return;
    }
    if (pending.some((x) => x.charge > 0.009 && !x.chargeBooked) && !feeRefundAccountId) {
      toast.error("Pick the account the returned fee is credited to."); return;
    }
    writePrefs(prefKey, { accountId: feeRefundAccountId });
    setBusy(dryRun ? "preview" : "post");
    try {
      const res = await fetch("/api/settlements/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankLineId: r.id, depositAccountId, feeAccountId, feeRefundAccountId, vatTaxId, inputVatAccountId,
          dryRun, refs: pending.map((x) => x.ref),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResults(json);
      const bad = (json.results as RefundResult[]).filter((x) => !x.ok).length;
      if (dryRun) toast.message(`Refund preview: ${json.results.length - bad} ready, ${bad} need attention — nothing posted.`);
      else if (bad === 0) toast.success("Refunds booked: credit notes refunded, fee parts and charges booked.");
      else toast.error(`${bad} refund(s) not booked — see the list.`);
      if (!dryRun) await loadLive(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2.5 rounded-lg border border-[#EAE3D6] bg-white px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <Undo2 size={13} className="text-[#6F5325]" />
        <span className="font-medium text-[#1F1B16]">Refunds on this payout</span>
        <span className="text-[#8A8175]">
          one full refund from {depositName || "the deposit account"} closes the credit note · returned fee: Dr {depositName || "clearing"} / Cr {accountName(feeRefundAccountId) || "gateway charges"}, same reference · extra charges to {feeName || "gateway charges"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => loadLive()}
            disabled={!!busy}
            title="Read every refund's credit note from Zoho now: total, refunds against it, open balance"
            className="inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[11.5px] hover:border-[#B08343] disabled:opacity-50"
          >
            {busy === "live" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} {live ? "Re-check credit notes" : "Check credit notes in Zoho"}
          </button>
          {r.confirmedBy && pending.length > 0 && (
            <>
              <button
                onClick={() => run(true)}
                disabled={!!busy || !depositAccountId}
                className="inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[11.5px] hover:border-[#B08343] disabled:opacity-50"
              >
                {busy === "preview" ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} Preview
              </button>
              <button
                onClick={() => run(false)}
                disabled={!!busy || !depositAccountId}
                className="inline-flex items-center gap-1 rounded-md bg-[#6F5325] px-2.5 py-1 text-[11.5px] font-medium text-[#FBF8F1] hover:bg-[#5A4320] disabled:bg-[#B8B0A0]"
              >
                {busy === "post" ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                Book {pending.length} refund{pending.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </span>
      </div>
      {r.confirmedBy && rows.some((x) => x.charge > 0.009) && (
        <div className="mt-2 max-w-sm">
          <AccountSelect
            label="Returned fee credited to" hint="Dr clearing / Cr this account"
            value={feeRefundAccountId} onChange={(v) => { setFeeRefundAccountId(v); writePrefs(prefKey, { accountId: v }); }}
            placeholder="Select account…" options={accounts}
          />
        </div>
      )}
      {!r.confirmedBy && <p className="mt-1 text-[11.5px] text-[#8A8175]">Confirm the settlement to book refunds.</p>}
      {liveAt && <p className="mt-1 text-[11px] text-[#8A8175]">Credit notes as Zoho had them at {new Date(liveAt).toLocaleTimeString()}.</p>}
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((x) => {
          const res = resultFor(x.ref);
          const cn = liveFor(x.ref);
          const cnErr = live?.[x.ref] && !cn ? (live[x.ref] as { error: string }).error : null;
          const open = cn ? cn.balance : null;
          return (
            <li key={x.ref} className="rounded-md border border-transparent px-1 py-0.5 hover:border-[#EAE3D6]">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <span className="font-mono text-[#1F1B16]">#{x.ref}</span>
                {x.orderNumber && x.orderNumber !== x.ref && <span className="text-[#8A8175]">→ #{x.orderNumber}</span>}
                {x.amount >= 0.01 ? (
                  <span className="tabular-nums text-[#A6472F]" title="The full amount refunded to the customer — the credit note">refund −{aed2(x.amount)}</span>
                ) : (
                  <span className="text-[11px] text-[#8A8175]">charge only · no credit note</span>
                )}
                {Math.abs(x.charge) >= 0.01 && (
                  <span
                    className={`tabular-nums text-[11.5px] ${x.charge > 0 ? "text-[#4B7A54]" : "text-[#A6472F]"}`}
                    title={x.charge > 0
                      ? "The gateway handed its fee back: Dr clearing / Cr gateway charges, same reference as the refund"
                      : "The gateway charged extra on this refund: expensed out of clearing"}
                  >
                    {x.charge > 0 ? `fee returned ${aed2(x.charge)} · net refund ${aed2(x.amount - x.charge)}` : `charge −${aed2(-x.charge)}`}
                    {x.chargeLegacy ? " · inside the credit note (booked earlier)" : x.chargeBooked ? " · booked" : ""}
                  </span>
                )}
                {isDone(x) ? (
                  <StatusPill s={{ kind: "booked", title: [x.creditNoteId ? `credit note ${x.creditNoteId}${x.creditNoteReused ? " (existing, reused)" : ""} · refund ${x.refundId}` : "", x.chargeId ? `charge ${x.chargeId}` : ""].filter(Boolean).join(" · ") }} />
                ) : open != null && open > 0.009 ? (
                  <StatusPill s={{ kind: "not_closed", title: `Credit note ${cn!.number} still has AED ${open.toFixed(2)} open in Zoho` }} />
                ) : res ? (
                  <StatusPill s={{ kind: res.status === "unlinked" ? "no_settlement" : res.status }} />
                ) : !x.orderNumber && x.amount >= 0.01 ? (
                  <StatusPill s={{ kind: "no_settlement", title: "Link this refund line to its order first" }} />
                ) : x.error ? (
                  <StatusPill s={{ kind: "review", title: x.error }} />
                ) : (
                  <StatusPill s={{ kind: "unpaid", title: "Not booked yet" }} />
                )}
                {r.confirmedBy && cn && x.amount >= 0.01 && restructuring !== x.ref &&
                  (cn.refunds.length > 1 || (cn.refunds.length === 1 && Math.abs(cn.refunds[0].amount - x.amount) >= 0.01 && cn.balance < 0.01) || x.charge > 0.009) && (
                  <button
                    onClick={() => void restructure(x, true)}
                    title="Check this refund's entries against the house model — one full refund, plus the returned fee as Dr clearing / Cr gateway charges (and Input VAT when the fee carried VAT), same reference — and fix what differs"
                    className="inline-flex items-center gap-1 rounded-full border border-[#B08343] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#6F5325] hover:bg-[#FBF3E6]"
                  >
                    <RefreshCw size={10} /> Check / fix entries
                  </button>
                )}
                {r.confirmedBy && cn && open != null && open > 0.009 && closing !== x.ref && (
                  <button
                    onClick={() => setClosing(x.ref)}
                    className="inline-flex items-center gap-1 rounded-full border border-[#A6472F] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#A6472F] hover:bg-[#F9ECE7]"
                  >
                    <Gavel size={10} /> Close credit note
                  </button>
                )}
              </div>
              {cn && (
                <div className="mt-0.5 pl-4 text-[11.5px] text-[#6F6457]">
                  <span className="font-mono">{cn.number}</span> · {cn.date} · {cn.status} · total <b className="tabular-nums">{aed2(cn.total)}</b>
                  {" "}· refunded <b className="tabular-nums">{aed2(cn.total - cn.balance)}</b>
                  {" "}· open <b className={`tabular-nums ${cn.balance > 0.009 ? "text-[#A6472F]" : "text-[#4B7A54]"}`}>{aed2(cn.balance)}</b>
                  {cn.refunds.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {cn.refunds.map((f) => (
                        <li key={f.id} className="text-[11px] text-[#8A8175]">
                          ↳ {f.date} · <span className="tabular-nums">{aed2(f.amount)}</span> · {f.mode || "refund"}
                          {f.reference ? <> · <span className="font-mono">{f.reference}</span></> : null}
                          {f.description ? <> · {f.description}</> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {cnErr && <div className="pl-4 text-[11px] text-[#A6472F]">Couldn&apos;t read the credit note: {cnErr}</div>}
              {x.booked && x.creditNoteReused && !cn && <div className="pl-4 text-[11px] text-[#8A8175]">used an existing open credit note</div>}
              {(res?.message || (!res && !isDone(x) && x.error)) && (
                <div className="pl-4 text-[11.5px] text-[#6F5325]">{res?.message ?? x.error}</div>
              )}
              {restructuring === x.ref && restructurePlan && (
                <div className="mt-1.5 ml-4 rounded-lg border border-[#D6CCBA] bg-[#FBF8F1] p-2.5 text-[12px] text-[#1F1B16]">
                  <div className="font-semibold">Restructure {restructurePlan.creditNote.number} (total {aed2(restructurePlan.creditNote.total)})</div>
                  <ul className="mt-1 space-y-0.5 text-[11.5px] text-[#6F6457]">
                    {restructurePlan.delete.map((d) => (
                      <li key={d.id}>Delete refund {aed2(d.amount)} · <span className="font-mono">{d.reference}</span></li>
                    ))}
                    {restructurePlan.refund && (
                      <li>Refund the credit note in full: <b>{aed2(restructurePlan.refund.amount)}</b> from {accountName(restructurePlan.refund.from) || depositName} · <span className="font-mono">{restructurePlan.refund.reference}</span></li>
                    )}
                    {restructurePlan.journal && (
                      <li>
                        Journal, same reference: Dr {accountName(restructurePlan.journal.debit) || depositName} <b>{aed2(restructurePlan.journal.amount)}</b>
                        {" "}/ Cr {accountName(restructurePlan.journal.credit)} <b>{aed2(restructurePlan.journal.charges)}</b>
                        {restructurePlan.journal.vat > 0 ? (
                          <> / Cr Input VAT <b>{aed2(restructurePlan.journal.vat)}</b>
                            <span className="text-[#8A8175]"> ({restructurePlan.journal.vatBasis === "original_fee" ? "this order's fee was booked with VAT" : "AED payout, VAT-inclusive fee"})</span></>
                        ) : <span className="text-[#8A8175]"> · no VAT on this order&apos;s fee</span>}
                      </li>
                    )}
                    {restructurePlan.journalVatFix && (
                      <li>
                        Correct the returned-fee journal in place (same reference): Cr {accountName(feeRefundAccountId) || "gateway charges"} <b>{aed2(restructurePlan.journalVatFix.charges)}</b>
                        {" "}+ Cr Input VAT <b>{aed2(restructurePlan.journalVatFix.vat)}</b> instead of {aed2(restructurePlan.journalVatFix.amount)} to charges
                        <span className="text-[#8A8175]"> ({restructurePlan.journalVatFix.vatBasis === "original_fee" ? "this order's fee was booked with VAT" : "AED payout, VAT-inclusive fee"})</span>
                      </li>
                    )}
                    {!restructurePlan.refund && !restructurePlan.journal && !restructurePlan.journalVatFix && restructurePlan.delete.length === 0 && (
                      <li className="text-[#4B7A54]">Already booked correctly — nothing to change.</li>
                    )}
                    <li>Net refund out of {depositName || "clearing"}: <b>{aed2(restructurePlan.netRefund)}</b></li>
                  </ul>
                  <div className="mt-2 flex justify-end gap-2">
                    <button onClick={() => { setRestructuring(null); setRestructurePlan(null); }} disabled={busy === "restructure"}
                      className="rounded-md border border-[#D6CCBA] bg-white px-2.5 py-1 text-[11.5px]">Cancel</button>
                    <button onClick={() => void restructure(x, false)}
                      disabled={busy === "restructure" || (!restructurePlan.refund && !restructurePlan.journal && !restructurePlan.journalVatFix && restructurePlan.delete.length === 0)}
                      className="inline-flex items-center gap-1 rounded-md bg-[#A6472F] px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-50">
                      {busy === "restructure" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Yes, rebook in Zoho
                    </button>
                  </div>
                </div>
              )}
              {closing === x.ref && cn && (
                <CloseCreditNotePanel
                  r={r} row={x} cn={cn} accounts={accounts}
                  depositAccountId={depositAccountId} feeRefundAccountId={feeRefundAccountId}
                  onCancel={() => setClosing(null)}
                  onClosed={async () => { setClosing(null); await loadLive(true); }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Close one credit note by hand: any number of refund parts, each with its
 *  own account, amount and description. Pre-filled with ONE refund of what
 *  Zoho says is still open, from the clearing account. */
function CloseCreditNotePanel({ r, row, cn, accounts, depositAccountId, feeRefundAccountId, onCancel, onClosed }: {
  r: ReconLine; row: RefundRow; cn: LiveCN; accounts: AccountOpt[];
  depositAccountId: string; feeRefundAccountId: string;
  onCancel: () => void; onClosed: () => Promise<void> | void;
}) {
  const order = row.orderNumber ?? row.ref;
  const [date, setDate] = useState((r.date ?? new Date().toISOString()).slice(0, 10));
  const [parts, setParts] = useState<{ accountId: string; amount: string; description: string }[]>(() => {
    // One full refund of what is open, from clearing — the house model. Add
    // parts only when this credit note genuinely needs another account.
    void feeRefundAccountId;
    return [{ accountId: depositAccountId, amount: cn.balance.toFixed(2), description: `${r.provider} refund for order ${order}` }];
  });
  const [busy, setBusy] = useState(false);
  const total = +parts.reduce((s, p) => s + (Number(p.amount) || 0), 0).toFixed(2);
  const left = +(cn.balance - total).toFixed(2);
  const problem =
    parts.some((p) => !p.accountId) ? "Pick an account for every part" :
    parts.some((p) => !(Number(p.amount) > 0)) ? "Every part needs an amount" :
    left < -0.009 ? `That refunds AED ${Math.abs(left).toFixed(2)} more than is open` :
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ? "Pick the date" : null;
  const set = (i: number, patch: Partial<(typeof parts)[number]>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = async () => {
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const res = await fetch("/api/settlements/refunds/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: r.id, ref: row.ref, date, parts: parts.map((p) => ({ ...p, amount: Number(p.amount) })) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const after = j.creditNote as LiveCN;
      toast.success(after.balance < 0.01 ? `${after.number} closed in Zoho.` : `${after.number}: AED ${after.balance.toFixed(2)} still open.`);
      await onClosed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 ml-4 rounded-lg border border-[#D6CCBA] bg-[#FBF8F1] p-2.5 text-[12px]">
      <div className="mb-1.5 font-semibold text-[#1F1B16]">
        Close {cn.number} · AED {cn.balance.toFixed(2)} open
      </div>
      <div className="space-y-1.5">
        {parts.map((p, i) => (
          <div key={i} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(180px,1.2fr)_110px_minmax(180px,2fr)_auto] sm:items-end">
            <AccountSelect label={`Part ${i + 1} · refunded from`} value={p.accountId} onChange={(v) => set(i, { accountId: v })} placeholder="Select account…" options={accounts} />
            <label className="text-[11px] text-[#6F6457]">
              Amount
              <input value={p.amount} inputMode="decimal" onChange={(e) => set(i, { amount: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#D6CCBA] bg-white px-2 py-1.5 text-right font-mono text-[12px]" />
            </label>
            <label className="text-[11px] text-[#6F6457]">
              Description
              <input value={p.description} maxLength={500} onChange={(e) => set(i, { description: e.target.value })}
                className="mt-1 w-full rounded-md border border-[#D6CCBA] bg-white px-2 py-1.5 text-[12px]" />
            </label>
            <button onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} className="pb-1.5 text-[11px] text-[#8A8175] underline">remove</button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <button
          onClick={() => setParts((ps) => [...ps, { accountId: "", amount: Math.max(0, left).toFixed(2), description: `${r.provider} refund · order ${order}` }])}
          className="rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[11.5px]"
        >
          + Add part
        </button>
        <label className="text-[11px] text-[#6F6457]">
          Refund date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-1.5 rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]" />
        </label>
        <span className="text-[11.5px] text-[#6F5325]">
          Refunding <b className="tabular-nums">{aed2(total)}</b> · leaves <b className={`tabular-nums ${Math.abs(left) < 0.01 ? "text-[#4B7A54]" : "text-[#A6472F]"}`}>{aed2(Math.max(left, 0))}</b> open
        </span>
        <span className="ml-auto flex items-center gap-2">
          {problem && <span className="text-[11.5px] text-[#A6472F]">{problem}</span>}
          <button onClick={onCancel} disabled={busy} className="rounded-md border border-[#D6CCBA] bg-white px-2.5 py-1 text-[11.5px]">Cancel</button>
          <button onClick={submit} disabled={busy || !!problem}
            className="inline-flex items-center gap-1 rounded-md bg-[#A6472F] px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Gavel size={11} />} Post {parts.length} refund{parts.length === 1 ? "" : "s"} in Zoho
          </button>
        </span>
      </div>
    </div>
  );
}

/* ── One row of the proof table, expandable to its products ─────────────── */

function ProofRow({
  t, order, missing, open, onToggle, status, originalCurrency, showSelectColumn,
  canSelect, selected, onSelectToggle, onRecordOne, busy, crossBorder, splitFigure, feeFigure,
  invoiceAmount, colCount, linkPanel, forcePanel, onForce, invoiceNote,
}: {
  /** "2 Zoho invoices · 1 open" when the order number carries several. */
  invoiceNote?: string;
  /** Inline "force book this order" panel; shown instead of the products while set. */
  forcePanel?: React.ReactNode;
  /** Offered on rows held for review: pick the invoice(s) and amounts by hand. */
  onForce?: () => void;
  /** Link-to-order control, for lines not matched to an order (or linked by hand). */
  linkPanel?: React.ReactNode;
  t: ReconTxn;
  order: OrderDetail | undefined;
  missing: boolean;
  open: boolean;
  onToggle: () => void;
  status?: RowStatus;
  /** Non-null only for cross-currency payouts (Tabby/Tamara SAR & KWD) —
   *  renders the order's own source-file amount alongside the AED figure. */
  originalCurrency?: string | null;
  showSelectColumn: boolean;
  canSelect: boolean;
  selected: boolean;
  onSelectToggle: () => void;
  onRecordOne: () => void;
  busy: boolean;
  crossBorder: boolean;
  /** VAT inside the fee (AED payouts) or the FX difference (cross-border). */
  splitFigure: number | null;
  /** The whole deduction booked to gateway charges. On a cross-border Tamara
   *  payout that is the fee PLUS the VAT it charged on top: there is no UAE
   *  input VAT to reclaim on a SAR/KWD payout, so the two are booked as one
   *  charge and must be shown as one here too. */
  feeFigure: number;
  /** The Zoho invoice balance this order's payment closes; null until read. */
  invoiceAmount: number | null;
  colCount: number;
}) {
  return (
    <>
      <tr
        className={`border-t border-[#EAE3D6] transition-colors hover:bg-[#FBF3E6] ${
          open ? "bg-[#FBF3E6]" : ""
        } ${t.isRefund ? "text-[#8A8175]" : "text-[#1F1B16]"}`}
      >
        {showSelectColumn && (
          <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
            {canSelect && <Checkbox checked={selected} onCheckedChange={() => onSelectToggle()} disabled={busy} />}
          </td>
        )}
        <td className="cursor-pointer px-3 py-2" onClick={onToggle}>
          <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]">
            <ChevronRight
              size={13}
              className="text-[#8A8175] transition-transform"
              style={{ transform: open ? "rotate(90deg)" : "none" }}
            />
            #{t.ref}
            {t.orderNumber && t.orderNumber !== t.ref && t.orderNumber !== bare(t.ref) && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[#F0F5EF] px-1.5 py-0.5 text-[10.5px] text-[#4B7A54]" title="Linked by hand">
                <Link2 size={9} /> #{t.orderNumber}
              </span>
            )}
          </span>
        </td>
        {originalCurrency && (
          <td className="cursor-pointer px-3 py-2 text-right font-mono tabular-nums text-[#8A8175]" onClick={onToggle}>
            {t.netOriginal != null ? fmtOriginal(t.netOriginal, originalCurrency) : "—"}
          </td>
        )}
        <td className="cursor-pointer px-3 py-2 text-right font-mono tabular-nums" onClick={onToggle}>{aed2(t.grossShare)}</td>
        <td
          className="cursor-pointer px-3 py-2 text-right font-mono tabular-nums text-[#6F5325]"
          onClick={onToggle}
          title={
            invoiceAmount == null
              ? "Zoho invoice not read yet — the exchange difference needs it"
              : `Exchange difference = ${aed2(invoiceAmount)} − fee − net received`
          }
        >
          {t.isRefund ? "—" : invoiceAmount == null ? "…" : aed2(invoiceAmount)}
        </td>
        <td
          className="cursor-pointer px-3 py-2 text-right font-mono tabular-nums"
          onClick={onToggle}
          title={
            crossBorder && (t.vatShare ?? 0) > 0
              ? `Fee ${aed2(t.feeShare)} + VAT ${aed2(t.vatShare ?? 0)} charged on top, booked together as one gateway charge`
              : "Booked to gateway charges"
          }
        >
          {aed2(feeFigure)}
        </td>
        <td
          className={`cursor-pointer px-3 py-2 text-right font-mono tabular-nums ${
            crossBorder && splitFigure != null && splitFigure < 0 ? "text-[#4B7A54]" : "text-[#8A8175]"
          }`}
          onClick={onToggle}
          title={crossBorder ? "Invoice − fee − AED received at the bank's rate. Positive = loss." : "VAT on the gateway fee, claimed as input VAT"}
        >
          {t.isRefund || splitFigure == null ? "—" : aed2(splitFigure)}
        </td>
        <td className="cursor-pointer px-3 py-2 text-right font-mono font-medium tabular-nums" onClick={onToggle}>{aed2(t.netShare)}</td>
        <td className="px-3 py-2 text-right">
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {t.isRefund && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F3EFE7] px-2 py-0.5 text-[11px] font-medium text-[#8A8175]">
                <RotateCcw size={10} /> refund
              </span>
            )}
            {status && <StatusPill s={status} />}
            {invoiceNote && (
              <span className="rounded-full bg-[#F9ECE7] px-1.5 py-0.5 text-[10.5px] font-medium text-[#A6472F]">{invoiceNote}</span>
            )}
            {onForce && !forcePanel && (
              <button
                onClick={(e) => { e.stopPropagation(); onForce(); }}
                title="Pick which Zoho invoice(s) this payment closes, and how much, then book"
                className="inline-flex items-center gap-1 rounded-full border border-[#A6472F] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#A6472F] hover:bg-[#F9ECE7]"
              >
                <Gavel size={10} /> Force book
              </button>
            )}
            {linkPanel && !t.orderNumber && !open && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(); }}
                className="inline-flex items-center gap-1 rounded-full border border-[#B08343] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#6F5325] hover:bg-[#FBF3E6]"
              >
                <Link2 size={10} /> Link order
              </button>
            )}
            {canSelect && (
              <button
                onClick={(e) => { e.stopPropagation(); onRecordOne(); }}
                disabled={busy}
                title="Book this order in Zoho: payment, fee, and any FX difference"
                className="inline-flex items-center gap-1 rounded-full border border-[#D6CCBA] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#1F1B16] transition-colors hover:border-[#B08343] hover:text-[#6F5325] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BadgeCheck size={10} /> Record
              </button>
            )}
          </span>
        </td>
      </tr>
      {forcePanel && (
        <tr>
          <td colSpan={colCount} className="border-t border-[#EAE3D6] bg-[#FBF8F1] px-4 py-3">{forcePanel}</td>
        </tr>
      )}
      {open && !forcePanel && (
        <tr>
          <td colSpan={colCount} className="border-t border-[#EAE3D6] bg-[#FBF8F1] px-4 py-3">
            {linkPanel}
            {(!linkPanel || t.orderNumber) && <OrderProducts order={order} missing={missing} />}
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Account picker ─────────────────────────────────────────────────────── */

export function AccountSelect({ label, hint, value, onChange, options, placeholder, allowNone }: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  placeholder: string;
  allowNone?: string;
}) {
  const NONE = "__none__";
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">
        {label}
        {hint && <span className="ml-1 font-normal normal-case tracking-normal text-[#B8B0A0]">{hint}</span>}
      </span>
      <Select value={value || (allowNone ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
        <SelectTrigger className={`h-8 w-full border-[#D6CCBA] text-[12px] ${!value && !allowNone ? "text-[#A6472F]" : ""}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>{allowNone}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/** fetch + parse, but fail with a sentence a bookkeeper can act on.
 *
 *  Calling `.json()` on whatever comes back turns every transport failure into
 *  `Unexpected token '<', "<!DOCTYPE "...` — the login page, a 404, or a server
 *  error page being parsed as data. That message says nothing about what went
 *  wrong, and the empty state it leaves behind is indistinguishable from real
 *  data, which is how a confirmed payout ends up claiming its orders have no
 *  settlement records. Read the status first, and say what actually happened. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // HTML back from a JSON endpoint: the session died (middleware answers
    // /api/* with 401 JSON now, so this is a proxy/CDN interstitial), the
    // route is missing, or the server crashed before it could answer.
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Your session expired. Sign in again and reopen this payout."
        : `The server returned ${res.status || "no"} ${res.statusText || "response"} instead of data. Nothing was changed — retry, and if it repeats the server needs a restart.`,
    );
  }
  if (!res.ok) {
    const err = (parsed as { error?: string }).error;
    throw new Error(err || `Request failed (HTTP ${res.status}).`);
  }
  return parsed as T;
}

/* ── The proof panel ────────────────────────────────────────────────────── */

export function GatewayProof({ r, live, onChanged }: {
  r: ReconLine;
  /** Reload reconciliation after a change made here (e.g. linking a line). */
  onChanged?: () => void | Promise<void>;
  /** Stripe rows pass their live API transactions; everyone else uses the
   *  engine's rescaled shares from the uploaded file. */
  live?: { transactions: ReconTxn[]; net: number; sourceLabel: string } | null;
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [forcingRef, setForcingRef] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrdersResponse | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [invoiceByRef, setInvoiceByRef] = useState<Record<string, InvoiceStatus>>({});
  const [settlements, setSettlements] = useState<SettlementRecord[] | null>(null);
  /** The settlements request failed. Distinct from `settlements === []`, which
   *  is a real answer. Without this the panel reports a dead request as
   *  "no settlement record" against orders that are settled and booked. */
  const [settlementsFailed, setSettlementsFailed] = useState(false);
  const [claimedElsewhere, setClaimedElsewhere] = useState<Record<string, { payoutId: string | null; gateway: string; published: boolean }>>({});
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [invoiceMeta, setInvoiceMeta] = useState<{ fetched: number; cached: number } | null>(null);
  const [refreshingInvoices, setRefreshingInvoices] = useState(false);
  /** Invoice status has been read from Zoho at least once in this panel. */
  const [invoicesChecked, setInvoicesChecked] = useState(false);
  // Bumped on every "Re-check invoices" — the refunds panel re-reads its
  // credit notes from Zoho at the same time.
  const [refundCheck, setRefundCheck] = useState(0);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [options, setOptions] = useState<PostingOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [depositAccountId, setDepositAccountId] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");
  const [vatTaxId, setVatTaxId] = useState("");
  const [differenceAccountId, setDifferenceAccountId] = useState("");
  const [useCustomRef, setUseCustomRef] = useState(false);
  const [customRef, setCustomRef] = useState("");
  const [bookExternal, setBookExternal] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "post" | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ dryRun: boolean; results: OrderPublishResult[]; wire?: WirePublishResult } | null>(null);

  const txns = live?.transactions ?? r.transactions;
  // Which order each line resolved to — the ref itself, or a manual link.
  const orderOf = (t: ReconTxn) => t.orderNumber ?? t.ref;
  // Changes when a line gets linked/unlinked, so settlement records reload.
  const matchedKey = `${r.resolvedOrders.join(",")}|${r.refundedOrders.join(",")}`;
  const net = live?.net ?? r.payout?.net ?? 0;

  const currency = r.payout?.currency ?? null;
  const crossBorder = isCrossBorderCurrency(currency);
  // The engine already restated every share at the bank's own quoted rate, so
  // scaling them again by the bank's flat wire charge would smear one charge
  // across every order and inflate each order's exchange difference.
  const sharesAtBankRate = r.payout?.fxSource === "bank";
  const bankScale = bankScaleFor({
    crossBorder, bankAmount: r.bankAmount, payoutNet: r.payout?.net ?? 0, sharesAtBankRate,
  });
  const wireResidual = planWireResidual({
    crossBorder, bankAmount: r.bankAmount, payoutNet: r.payout?.net ?? 0, sharesAtBankRate,
  });
  const prefsKey = `omnia.gatewayPosting.${r.provider}.${currency ?? "AED"}`;

  const sum = +txns.reduce((s, t) => s + t.netShare, 0).toFixed(2);
  const foots = Math.abs(sum - net) < 0.01;
  const refunds = txns.filter((t) => t.isRefund).length;
  const netOriginalTotal = txns.reduce((s, t) => s + (t.netOriginal ?? 0), 0);
  // Tamara itemises VAT on top of its fee; Tabby's fee already includes it.
  const vatOnTop = txns.some((t) => (t.vatShare ?? 0) > 0);
  // Two different numbers, never to be conflated:
  //   quotedRate     — the rate the bank itself printed in the narration. THE
  //                    conversion rate; it is what values the payout in AED.
  //   arrivedPerUnit — bank credit ÷ the same original-currency net. Lower
  //                    than the quoted rate whenever the bank kept a charge,
  //                    so it is an outcome, not a rate anyone applied.
  // Showing arrivedPerUnit as "the rate the bank applied" contradicted the
  // narration printed right above it (0.955161 vs the quoted 0.958918) and
  // hid a real bank charge inside an invented rate.
  const quotedRate = crossBorder && r.payout?.fxSource === "bank" ? r.payout.fxRate : null;
  const arrivedPerUnit = crossBorder && netOriginalTotal > 0 ? r.bankAmount / netOriginalTotal : null;
  // Positive = the bank kept this much between quoting and crediting.
  const bankKeptAed = crossBorder ? +((r.payout?.net ?? 0) - r.bankAmount).toFixed(2) : 0;

  // One request for the whole credit, the first time any order is opened —
  // not one per click.
  useEffect(() => {
    if (!openRow || orders || loadingOrders) return;
    setLoadingOrders(true);
    getJson<OrdersResponse & { error?: string }>(`/api/reconcile/line/${encodeURIComponent(r.id)}/orders`)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setOrders(d);
      })
      // A failed request is not evidence that every order is missing. Marking
      // them all `missing` here is what put "not found" next to orders that
      // are sitting in the database, so report the failure instead.
      .catch((e) => {
        setOrders({ orders: [], missing: [] });
        setSetupError(`Couldn't load the orders on this payout: ${(e as Error).message}`);
      })
      .finally(() => setLoadingOrders(false));
  }, [openRow, orders, loadingOrders, r.id, txns]);

  // Settlement records + invoice status + account options, once, when the
  // credit is confirmed. Each fails on its own so one slow Zoho call can't
  // hide the whole booking bar.
  useEffect(() => {
    if (!r.confirmedBy) return;
    let alive = true;
    setLoadingSetup(true);
    setSetupError(null);
    setSettlementsFailed(false);

    const settlementsP = getJson<{ settlements?: SettlementRecord[]; claimedElsewhere?: Record<string, { payoutId: string | null; gateway: string; published: boolean }> }>(
      `/api/reconcile/line/${encodeURIComponent(r.id)}/settlements`,
    )
      .then((d) => {
        if (!alive) return;
        setSettlements(d.settlements ?? []);
        setClaimedElsewhere(d.claimedElsewhere ?? {});
      })
      // Leave `settlements` null on failure. Null means "we don't know yet";
      // [] means "we asked and there are none". statusFor() relies on the
      // difference, so never collapse one into the other here.
      .catch((e) => {
        if (!alive) return;
        setSettlementsFailed(true);
        setSetupError(`Couldn't load settlement records: ${(e as Error).message}`);
      });

    const optionsP = fetch("/api/settlements/posting-options")
      .then(async (x) => {
        const d = await x.json();
        if (!x.ok) throw new Error(d.error || `HTTP ${x.status}`);
        return d as PostingOptions;
      })
      .then((d) => {
        if (!alive) return;
        setOptions(d);
        const suggested = suggestPostingAccounts({ provider: r.provider, currency }, d);
        const saved = readPrefs(prefsKey);
        const valid = (id: string | undefined, list: { account_id?: string; tax_id?: string }[]) =>
          id !== undefined && (id === "" || list.some((o) => (o.account_id ?? o.tax_id) === id));
        setDepositAccountId(valid(saved.depositAccountId, d.depositAccounts) ? saved.depositAccountId! : suggested.depositAccountId);
        setFeeAccountId(valid(saved.feeAccountId, d.feeAccounts) ? saved.feeAccountId! : suggested.feeAccountId);
        setDifferenceAccountId(valid(saved.differenceAccountId, d.differenceAccounts) ? saved.differenceAccountId! : suggested.differenceAccountId);
        setVatTaxId(!crossBorder && valid(saved.vatTaxId, d.taxes) ? saved.vatTaxId! : suggested.vatTaxId);
      })
      .catch((e) => alive && setOptionsError((e as Error).message));

    // Invoice status is NOT fetched here. It is one customer_name_startswith
    // search per order against a ~5,000/day org cap — an 18-order payout cost
    // 18-36 Zoho requests every single time this panel mounted, including
    // every time someone navigated back to it. It is a button now.
    //
    // Deliberately a trigger rather than a cache: a manager can reopen a paid
    // invoice in Zoho, so a stored status can be wrong in a way that matters.
    // Not asking is safe; answering from a stale snapshot is not.
    Promise.allSettled([settlementsP, optionsP]).finally(() => alive && setLoadingSetup(false));
    return () => { alive = false; };
  }, [r.id, r.confirmedBy, r.provider, currency, crossBorder, prefsKey, matchedKey]);

  const orderByNumber = new Map((orders?.orders ?? []).map((o) => [o.order_number, o]));
  useEffect(() => { setOrders(null); }, [matchedKey]);
  // A different set of matched orders means the statuses on screen answer a
  // question nobody asked. Clear rather than show them against new rows.
  useEffect(() => { setInvoiceByRef({}); setInvoiceMeta(null); setInvoicesChecked(false); }, [matchedKey]);
  const missingSet = new Set(orders?.missing ?? []);

  const settlementFor = useMemo(() => {
    const map = new Map<string, SettlementRecord>();
    for (const s of settlements ?? []) {
      map.set(s.order_number, s);
      if (!map.has(bare(s.order_number))) map.set(bare(s.order_number), s);
    }
    return (ref: string) => map.get(ref) ?? map.get(bare(ref));
  }, [settlements]);

  const resultByRef = useMemo(() => {
    const map = new Map<string, OrderPublishResult>();
    for (const res of lastRun?.results ?? []) map.set(res.orderNumber, res);
    return map;
  }, [lastRun]);

  const invoiceFor = (ref: string) => invoiceByRef[ref] ?? invoiceByRef[bare(ref)];
  /** Our table says booked, but Zoho still shows the invoice with a balance —
   *  e.g. the payment was deleted in Zoho afterwards. Never trust the table
   *  over Zoho for "closed". */
  /** Every invoice under this order number that still has money owing, from
   *  the last live "Re-check invoices". An order can carry two invoices and
   *  have only one closed (804671). */
  const openInvoicesFor = (ref: string) => {
    const iv = invoiceFor(ref);
    if (!iv || iv.status === "not_found" || ("cached" in iv && iv.cached)) return [];
    return (iv.invoices ?? []).filter((x) => x.balance > 0.01 && !["void", "draft"].includes(x.status.toLowerCase()));
  };
  const invoiceNoteFor = (ref: string): string | undefined => {
    const iv = invoiceFor(ref);
    if (!iv || iv.status === "not_found" || !iv.invoices || iv.invoices.length < 2) return undefined;
    const open = openInvoicesFor(ref).length;
    return `${iv.invoices.length} Zoho invoices · ${open ? `${open} open` : "all closed"}`;
  };
  const openInZoho = (ref: string) => {
    const iv = invoiceFor(ref);
    // A snapshot is what Zoho said last time, not now — it must never be the
    // reason we call an invoice closed or open. Only a live read decides.
    if (!iv || iv.status === "not_found" || ("cached" in iv && iv.cached)) return false;
    return (iv.status !== "paid" && Number(iv.balance) > 0.01) || openInvoicesFor(ref).length > 0;
  };

  const statusFor = (t: ReconTxn): RowStatus | undefined => {
    const s = settlementFor(orderOf(t));
    const res = s ? resultByRef.get(s.order_number) : undefined;
    if (res && !(res.ok && res.status === "planned" && s && fullyBooked(s) && !openInZoho(t.ref))) {
      const kind = res.status === "planned" ? "planned" : res.status;
      return { kind, title: res.message };
    }
    if (!s && !t.isRefund) {
      // We never read the records, so we know nothing about this order. Saying
      // "no settlement record" here would be inventing a finance fact out of a
      // network error — the row stays honest and the banner carries the reason.
      // Only applies once the credit is confirmed: before that the records
      // genuinely don't exist yet, and `no_settlement` is the true answer.
      if (r.confirmedBy && (settlementsFailed || settlements === null)) {
        return {
          kind: "load_failed",
          title: "Couldn't read this payout's settlement records, so this order's status is unknown. Nothing has changed — retry above.",
        };
      }
      const elsewhere = t.orderNumber ? claimedElsewhere[t.orderNumber] : undefined;
      if (elsewhere) {
        return {
          kind: "no_settlement",
          title: `Order #${t.orderNumber} is already settled by another payout (${elsewhere.gateway}${elsewhere.payoutId ? ` · ${elsewhere.payoutId}` : ""})` +
            (elsewhere.published ? ", and booked in Zoho from there." : " — not booked yet. Check which payout really paid it before booking."),
        };
      }
      return t.orderNumber
        ? { kind: "no_settlement", title: `Order #${t.orderNumber} has no settlement record yet — reload the page.` }
        : { kind: "no_settlement", title: "Not matched to any order — open the row and use Link order." };
    }
    const ambiguous = (() => {
      const iv = invoiceFor(t.ref);
      return iv && iv.status !== "not_found" ? iv.ambiguous : undefined;
    })();
    if (s) {
      if (fullyBooked(s) && openInZoho(t.ref)) {
        const open = openInvoicesFor(t.ref);
        const list = open.map((x) => `${x.invoiceNumber} ${x.status} AED ${x.balance.toFixed(2)} open`).join(", ");
        return {
          kind: "not_closed",
          title: `Our records say booked (payment ${s.zoho_payment_id}), but Zoho still has money owing${list ? `: ${list}` : ""}. Use Force book to close ${open.length > 1 ? "them" : "it"}.`,
        };
      }
      if (fullyBooked(s)) return { kind: "booked", title: `payment ${s.zoho_payment_id}` };
      if (s.zoho_post_error) return { kind: "review", title: s.zoho_post_error };
      if (s.zoho_payment_id?.startsWith("EXTERNAL:")) return { kind: "paid_external", title: "Invoice was marked paid in Zoho outside this app" };
      if (isRealId(s.zoho_payment_id)) return { kind: "fee_pending", title: "Payment recorded; fee / FX not booked yet" };
    }
    const iv = invoiceFor(t.ref);
    if (!iv) return undefined;
    if (iv.status === "not_found") return { kind: "no_invoice", title: "No matching Zoho invoice — run a sync" };
    if (ambiguous) return { kind: "review", title: ambiguous };
    if ("cached" in iv && iv.cached) {
      return {
        kind: "stale",
        title: `Zoho didn't answer for this order — showing what it said on ${String(iv.checkedAt ?? "").slice(0, 10)}. Press "Re-check invoices".`,
      };
    }
    if (iv.status === "paid") return { kind: "paid", title: "Zoho invoice is already paid" };
    if (iv.status === "overdue") {
      return { kind: "overdue", title: `Zoho invoice ${iv.invoiceNumber ?? ""} is overdue with AED ${Number(iv.balance).toFixed(2)} outstanding — if it was paid and later reopened, it needs booking again.` };
    }
    return { kind: "unpaid", title: `Zoho invoice ${iv.status}` };
  };

  // An order stays selectable until Zoho itself shows it closed: while it has
  // a settlement record and any Zoho document is missing, or its invoice is
  // still open whatever our table says. Failed and review orders included —
  // the server re-checks everything before writing, so re-selecting is safe.
  const postableRefs = txns
    .filter((t) => !t.isRefund)
    .filter((t) => {
      const s = settlementFor(orderOf(t));
      return !!s && (!fullyBooked(s) || openInZoho(t.ref));
    })
    .map((t) => t.ref);
  const postableSet = new Set(postableRefs);

  /** The Zoho invoice amount this order's payment closes. `total` picks WHICH
   *  invoice (pickInvoiceForOrder); the balance is what gets paid — except on
   *  an invoice already closed, where the balance is 0 and the total is what
   *  was paid. Falls back to the snapshot stored when the order was booked, so
   *  this needs no Zoho call. Null only when nothing has ever read it. */
  const invoiceAmountFor = (t: ReconTxn): number | null => {
    const iv = invoiceByRef[t.ref] ?? invoiceByRef[bare(t.ref)];
    if (iv && iv.status !== "not_found") {
      if (iv.status !== "paid") return Number(iv.balance);
      if (iv.total != null) return Number(iv.total);
    }
    const s = settlementFor(orderOf(t));
    if (s?.zoho_invoice_balance != null) {
      const bal = Number(s.zoho_invoice_balance);
      if (bal > 0.01) return bal;
      if (s.zoho_invoice_total != null) return Number(s.zoho_invoice_total);
    }
    return null;
  };

  // Client-side estimate with the same math the server books with; replaced
  // by the server's exact plan once a preview or post has run.
  const planFor = (t: ReconTxn) => {
    const s = settlementFor(orderOf(t));
    const res = s ? resultByRef.get(s.order_number) : undefined;
    if (res?.plan) return res.plan;
    if (s?.fee_aed != null) {
      const fee = Number(s.fee_aed);
      const vat = Number(s.fee_vat_aed ?? 0);
      return { fee, feeVat: vat, difference: Number(s.fx_difference_aed ?? 0), paymentAmount: null as number | null, netReceived: +(t.netShare * bankScale).toFixed(2) };
    }
    // The difference is only ever invoice − fee − net received, so it exists
    // only once we know the real Zoho invoice. Falling back to the payout's
    // own gross made the row appear to reconcile to zero against itself.
    const balance = invoiceAmountFor(t);
    const p = planOrderPosting({
      invoiceBalance: balance ?? t.grossShare * bankScale,
      grossAed: t.grossShare, feeAed: t.feeShare, feeVatAed: t.vatShare, netAed: t.netShare,
      // A SAR order on an AED payout is an exchange difference, not a
      // mismatch. Without this the preview shows "needs review" on rows the
      // server would book, which is how the Telr payout looked wrong.
      bankScale, crossBorder, orderCurrency: s?.order_currency ?? null,
      feeVatInclusive: !!vatTaxId,
    });
    return { ...p, paymentAmount: balance, difference: balance == null ? null : p.difference };
  };

  /** What actually leaves clearing as a gateway charge for this order. A
   *  cross-border Tamara payout itemises VAT on top of its fee, but no UAE
   *  input VAT is reclaimable on a SAR/KWD settlement, so planOrderPosting
   *  books fee + VAT as one charge — show the same single figure. */
  const feeFigureFor = (t: ReconTxn): number =>
    crossBorder ? +(t.feeShare + (t.vatShare ?? 0)).toFixed(2) : t.feeShare;

  const splitFigureFor = (t: ReconTxn): number | null => {
    if (t.isRefund) return null;
    if (!crossBorder) {
      if (!vatTaxId) return 0;
      return t.vatShare ? t.vatShare : vatInclusiveSplit(Math.abs(t.feeShare)).vat;
    }
    const d = planFor(t).difference;
    return d == null ? null : d;
  };

  const scopeRefs = selected.size > 0 ? [...selected] : postableRefs;
  const totals = scopeRefs.reduce(
    (acc, ref) => {
      const t = txns.find((x) => x.ref === ref);
      if (!t) return acc;
      const p = planFor(t);
      acc.fee += p.fee;
      acc.vat += p.feeVat;
      acc.received += p.netReceived;
      if (p.paymentAmount != null) acc.invoices += p.paymentAmount;
      else acc.unknownInvoices += 1;
      if (p.difference != null) acc.difference += p.difference;
      return acc;
    },
    { invoices: 0, unknownInvoices: 0, fee: 0, vat: 0, difference: 0, received: 0 },
  );

  const toggleSelect = (ref: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === postableRefs.length ? new Set() : new Set(postableRefs)));
  };

  const nameOf = (list: { account_id: string; account_name: string }[] | undefined, id: string) =>
    list?.find((a) => a.account_id === id)?.account_name ?? "";
  const depositName = nameOf(options?.depositAccounts, depositAccountId);
  const feeName = nameOf(options?.feeAccounts, feeAccountId);
  const differenceName = nameOf(options?.differenceAccounts, differenceAccountId);
  const vatName = options?.taxes.find((x) => x.tax_id === vatTaxId)?.tax_name ?? "";

  const missingSetup =
    !depositAccountId ? "Pick the Deposit To account" :
    !feeAccountId ? "Pick the gateway charges account" :
    crossBorder && !differenceAccountId ? "Pick the exchange gain / loss account" :
    null;

  const run = async (refs: string[], dryRun: boolean) => {
    if (refs.length === 0) return;
    if (missingSetup) {
      toast.error(`${missingSetup} first.`);
      return;
    }
    const settlementIds = refs
      .map((ref) => {
        const t = txns.find((x) => x.ref === ref);
        return (t ? settlementFor(orderOf(t)) : settlementFor(ref))?.id;
      })
      .filter((id): id is string => !!id);
    if (settlementIds.length === 0) {
      toast.error("None of these orders has a settlement record yet — re-run reconciliation.");
      return;
    }
    writePrefs(prefsKey, { depositAccountId, feeAccountId, vatTaxId, differenceAccountId });
    setBusy(dryRun ? "preview" : "post");
    setRunError(null);
    try {
      const res = await fetch("/api/settlements/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankLineId: r.id,
          settlementIds,
          depositAccountId,
          feeAccountId,
          vatTaxId: crossBorder ? "" : vatTaxId,
          differenceAccountId,
          referenceNumberOverride: useCustomRef && customRef.trim() ? customRef.trim() : undefined,
          bookFeesOnExternallyPaid: bookExternal,
          dryRun,
        }),
      });
      const json = (await res.json()) as { results?: OrderPublishResult[]; wire?: WirePublishResult; settlements?: SettlementRecord[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const results = json.results ?? [];
      if (json.settlements) setSettlements(json.settlements);
      setLastRun({ dryRun, results, wire: json.wire });

      const good = results.filter((x) => x.ok).length;
      const bad = results.length - good;
      if (dryRun) {
        toast.message(`Preview: ${good} ready, ${bad} need attention — nothing was posted.`);
      } else if (bad === 0) {
        toast.success(`Booked ${good} order${good === 1 ? "" : "s"} in Zoho.`);
      } else {
        toast.error(`${good} booked, ${bad} not — see the list below the table.`);
      }
      if (!dryRun) {
        setSelected((prev) => {
          const next = new Set(prev);
          refs.forEach((ref) => next.delete(ref));
          return next;
        });
      }
    } catch (e) {
      setRunError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refreshInvoices = async () => {
    setRefreshingInvoices(true);
    try {
      const res = await fetch(`/api/reconcile/line/${encodeURIComponent(r.id)}/invoices?refresh=1`);
      const d = (await res.json()) as { statuses?: Record<string, InvoiceStatus>; fetched?: number; error?: string };
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setInvoiceByRef(d.statuses ?? {});
      setInvoiceMeta({ fetched: d.fetched ?? 0, cached: 0 });
      setInvoicesChecked(true);
      setRefundCheck((n) => n + 1);
      toast.success(`Read ${d.fetched ?? 0} invoice${d.fetched === 1 ? "" : "s"} from Zoho.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshingInvoices(false);
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
      `Bank credited,${r.bankAmount}`,
      "",
      // Fee is the whole deduction booked to gateway charges — on a
      // cross-border Tamara payout that includes the VAT charged on top.
      "Order,Gross AED,Fee AED,Net AED,Refund",
    ];
    const body = txns.map((t) => `${t.ref},${t.grossShare},${feeFigureFor(t)},${t.netShare},${t.isRefund ? "yes" : "no"}`);
    const blob = new Blob([[...head, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recon-${r.provider}-${r.reference || r.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showSelectColumn = !!r.confirmedBy && postableRefs.length > 0;
  const colCount = 7 + (currency ? 1 : 0) + (showSelectColumn ? 1 : 0);
  const selectedCount = selected.size;
  const scopeCount = selectedCount > 0 ? selectedCount : postableRefs.length;
  const problems = (lastRun?.results ?? []).filter((x) => !x.ok);
  // Everything that still needs a person, persisted across reloads (not just
  // the last run): failed, review, not closed in Zoho, no invoice, no record.
  const ATTENTION = new Set<RowStatus["kind"]>(["failed", "review", "not_closed", "no_invoice", "no_settlement", "busy", "fee_pending", "overdue", "stale"]);
  const attention = r.confirmedBy
    ? txns
        .filter((t) => !t.isRefund)
        .map((t) => ({ t, st: statusFor(t) }))
        .filter((x): x is { t: ReconTxn; st: RowStatus } => !!x.st && ATTENTION.has(x.st.kind))
    : [];
  const attentionSelectable = attention.filter((x) => postableSet.has(x.t.ref)).map((x) => x.t.ref);
  const th = "px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]";

  return (
    <div className="mb-3.5 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3.5">
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
            <b className="tabular-nums">{aed2(net)}</b> {crossBorder && Math.abs(r.bankAmount - net) >= 0.01 ? "the payout file shows" : "the bank credited"}.
          </>
        ) : (
          <>
            These orders add up to <b className="tabular-nums">{aed2(sum)}</b>, but the payout file totals{" "}
            <b className="tabular-nums">{aed2(net)}</b> — a <b className="tabular-nums">{aed2(Math.abs(sum - net))}</b>{" "}
            gap inside the file itself, worth checking before this is treated as proven.
          </>
        )}
        {refunds > 0 && <> {refunds} refund{refunds === 1 ? " is" : "s are"} included and subtracted.</>}
      </p>

      {currency && (
        <p className="mb-2.5 text-[13px] leading-relaxed text-[#1F1B16]">
          Paid in <b>{currency}</b>
          {quotedRate ? (
            <>, converted at the <b>{quotedRate.toFixed(6)} AED</b> per {currency} the bank quoted in this
              narration{netOriginalTotal > 0 && <> — which values the payout&apos;s {fmtOriginal(netOriginalTotal, currency)} at{" "}
                <b className="tabular-nums">{aed2(r.payout?.net ?? 0)}</b></>}</>
          ) : (
            <>, converted at <b>{r.payout?.fxRate ?? "—"} AED</b> per {currency} (our estimate — the bank did not
              quote one)</>
          )}
          .
          {Math.abs(bankKeptAed) >= 0.01 && (
            bankKeptAed > 0 ? (
              <> Only <b className="tabular-nums">{aed2(r.bankAmount)}</b> landed, so the bank kept{" "}
                <b className="tabular-nums">{aed2(bankKeptAed)}</b> on the way in — a wire charge, not a different
                rate{arrivedPerUnit ? <> (it works out at {arrivedPerUnit.toFixed(6)} AED per {currency} on the money
                  that actually arrived)</> : null}. Each order below keeps the figures the payout file states at the
                quoted rate, so its exchange difference is the real gap against its own invoice; the{" "}
                <b className="tabular-nums">{aed2(bankKeptAed)}</b> the bank kept books <b>once</b>, against this
                credit, to exchange gain or loss.</>
            ) : (
              <> The bank credited <b className="tabular-nums">{aed2(r.bankAmount)}</b> —{" "}
                <b className="tabular-nums">{aed2(Math.abs(bankKeptAed))}</b> more than the quoted rate implies;
                booking rescales each order to what landed and books the surplus as an exchange gain.</>
            )
          )}
          {r.fxFeeAed != null && r.fxFeeAed > 0 && (
            <> {r.provider} kept <b className="tabular-nums">{aed2(r.fxFeeAed)}</b> in fees before that
              {vatOnTop ? ", VAT included" : ""} — booked to gateway charges.</>
          )}
        </p>
      )}

      {/* Booking bar — confirmed credits only. */}
      {r.confirmedBy && (
        <div className="mb-2.5 space-y-2.5 rounded-lg border border-[#EAE3D6] bg-white px-3 py-2.5">
          {loadingSetup && !options ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#8A8175]">
              <Loader2 size={12} className="animate-spin" /> Loading Zoho accounts and invoices…
            </span>
          ) : optionsError ? (
            <div className="flex items-start gap-2 text-[12px] text-[#A6472F]">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              Couldn&apos;t load Zoho accounts: {optionsError}
            </div>
          ) : settlements && settlements.length === 0 ? (
            <span className="text-[12px] text-[#A6472F]">
              No settlement records exist for this credit yet — reload the reconciliation page after the payout upload so they&apos;re created.
            </span>
          ) : (
            <>
              <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${crossBorder ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
                <AccountSelect
                  label="Deposit to"
                  hint="invoice closes in full"
                  value={depositAccountId}
                  onChange={setDepositAccountId}
                  placeholder="Select clearing account…"
                  options={(options?.depositAccounts ?? []).map((a) => ({ id: a.account_id, name: a.account_name }))}
                />
                <AccountSelect
                  label="Gateway charges"
                  hint="fee expense"
                  value={feeAccountId}
                  onChange={setFeeAccountId}
                  placeholder="Select expense account…"
                  options={(options?.feeAccounts ?? []).map((a) => ({ id: a.account_id, name: a.account_name }))}
                />
                {!crossBorder && (
                  <AccountSelect
                    label="VAT on fee"
                    hint={vatOnTop ? "fee × 5%, on top" : "fee ÷ 105 × 5"}
                    value={vatTaxId}
                    onChange={setVatTaxId}
                    placeholder="Select tax…"
                    allowNone="No VAT on this fee"
                    options={(options?.taxes ?? [])
                      .filter((t) => t.tax_percentage > 0)
                      .map((t) => ({ id: t.tax_id, name: `${t.tax_name} (${t.tax_percentage}%)` }))}
                  />
                )}
                <AccountSelect
                  label={crossBorder ? "Exchange gain / loss" : "Rounding diff"}
                  hint={crossBorder ? "at bank's rate" : "gaps ≤ AED 1 or 0.25%"}
                  value={differenceAccountId}
                  onChange={setDifferenceAccountId}
                  placeholder="Select account…"
                  options={(options?.differenceAccounts ?? []).map((a) => ({ id: a.account_id, name: a.account_name }))}
                />
              </div>

              <p className="text-[12px] leading-relaxed text-[#6F5325]">
                {crossBorder ? (
                  <>Each invoice is closed for its full AED amount into <b>{depositName || "the deposit account"}</b>.{" "}
                    {vatOnTop ? (
                      <>The {r.provider} fee <b>and the VAT it charged on top</b> go to{" "}
                        <b>{feeName || "gateway charges"}</b> as a single charge — a {currency} payout carries no
                        reclaimable UAE input VAT.</>
                    ) : (
                      <>The {r.provider} fee goes to <b>{feeName || "gateway charges"}</b> with <b>no VAT</b> ({currency} payout).</>
                    )}{" "}
                    Each order&apos;s <b>invoice balance − fee − net received</b> goes to{" "}
                    <b>{differenceName || "exchange gain / loss"}</b>
                    {wireResidual.needed && (
                      <>, and the <b className="tabular-nums">{aed2(Math.abs(wireResidual.amount))}</b> the bank kept on
                        the wire posts there once for the whole credit — which is what leaves{" "}
                        <b>{depositName || "the clearing account"}</b> at zero</>
                    )}.</>
                ) : (
                  <>Each invoice is closed for its full amount into <b>{depositName || "the deposit account"}</b>. The {r.provider} fee
                    is paid from there to <b>{feeName || "gateway charges"}</b>
                    {vatTaxId
                      ? vatOnTop
                        ? <> together with the VAT {r.provider} charged on top (<b>{vatName}</b>): VAT = Total Fees × 5% is claimed as input VAT.</>
                        : <> as VAT-inclusive (<b>{vatName}</b>): VAT = fee ÷ 105 × 5 is claimed as input VAT.</>
                      : <> with no VAT.</>}</>
                )}
                {r.forceBook && wireResidual.needed && (
                  <> The <b className="tabular-nums">{aed2(Math.abs(wireResidual.amount))}</b> gap on this credit was force-booked:
                    it posts once to <b>{r.forceBook.accountName || "the account chosen"}</b>, whatever is picked above.</>
                )}
              </p>

              {(r.payout?.deliveryCharges?.length ?? 0) > 0 && (
                <DeliveryChargesPanel
                  r={r}
                  expenseAccounts={options?.feeAccounts ?? []}
                  depositAccountId={depositAccountId}
                  vatTaxId={crossBorder ? "" : vatTaxId}
                  vatName={vatName}
                  referenceOverride={useCustomRef && customRef.trim() ? customRef.trim() : undefined}
                />
              )}

              {scopeCount > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[#FBF3E6] px-2.5 py-1.5 text-[11.5px] text-[#6F5325]">
                  <span className="font-semibold">{selectedCount > 0 ? `${selectedCount} selected` : `${postableRefs.length} to book`}</span>
                  <span>Invoices <b className="tabular-nums">{totals.unknownInvoices === scopeCount ? "from Zoho" : aed2(totals.invoices)}</b>
                    {totals.unknownInvoices > 0 && totals.unknownInvoices < scopeCount && <> + {totals.unknownInvoices} unknown</>}</span>
                  <span>Fees <b className="tabular-nums">{aed2(totals.fee)}</b>
                    {!crossBorder && vatTaxId && <> (VAT <b className="tabular-nums">{aed2(totals.vat)}</b>)</>}</span>
                  {crossBorder && (
                    <span>FX {totals.difference >= 0 ? "loss" : "gain"} <b className="tabular-nums">{aed2(Math.abs(totals.difference))}</b>
                      {totals.unknownInvoices > 0 && " (est.)"}</span>
                  )}
                  <span>Received <b className="tabular-nums">{aed2(totals.received)}</b></span>
                  <span>
                    on {r.date ? new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no date"}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="flex items-center gap-1.5 text-[12px] text-[#1F1B16]">
                  <Checkbox checked={useCustomRef} onCheckedChange={(v) => setUseCustomRef(v === true)} />
                  Custom reference
                </label>
                {useCustomRef && (
                  <Input
                    value={customRef}
                    onChange={(e) => setCustomRef(e.target.value)}
                    placeholder={r.reference || "e.g. Batch 42"}
                    className="h-8 w-40 border-[#D6CCBA] text-[12px]"
                  />
                )}
                <button
                  onClick={refreshInvoices}
                  disabled={refreshingInvoices || !!busy}
                  title={
                    invoiceMeta?.cached
                      ? `${invoiceMeta.cached} invoice(s) couldn't be read from Zoho and are showing their last known figures. Try again.`
                      : invoicesChecked
                        ? "Read every invoice from Zoho again — use this after changing an invoice in Zoho"
                        : "Reads each order's invoice status live from Zoho. One search per order against a ~5,000/day cap, so it runs when you ask rather than every time this panel opens."
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[11.5px] font-medium text-[#6F5325] hover:border-[#B08343] disabled:opacity-50"
                >
                  {refreshingInvoices ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  {invoicesChecked ? "Re-check invoices" : "Check invoices in Zoho"}
                  {invoiceMeta && invoiceMeta.cached > 0 && (
                    <span className="text-[#A6472F]">({invoiceMeta.cached} not live)</span>
                  )}
                </button>
                <label
                  className="flex items-center gap-1.5 text-[12px] text-[#1F1B16]"
                  title="Invoices someone already marked paid by hand are skipped by default, because their fee may have been booked by hand too. Tick only if those fees were never booked."
                >
                  <Checkbox checked={bookExternal} onCheckedChange={(v) => setBookExternal(v === true)} />
                  Also book fees on invoices already paid by hand
                </label>

                <div className="ml-auto flex items-center gap-2">
                  {/* "Nothing left to book" and "we couldn't read what's
                      booked" both leave postableRefs empty, and only one of
                      them is good news. Never show the all-clear on a failed
                      read — it is the sentence that would stop someone
                      checking a payout that was never actually booked. */}
                  {settlementsFailed || settlements === null ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#A6472F]">
                      Settlement records couldn&apos;t be read — booking status unknown.
                    </span>
                  ) : postableRefs.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#4B7A54]">
                      <CheckCircle2 size={13} /> Every order on this payout is booked.
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => run(selectedCount > 0 ? [...selected] : postableRefs, true)}
                        disabled={!!busy || !!missingSetup}
                        title={missingSetup ?? "Check every order against Zoho without posting anything"}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-white px-3 py-1.5 text-[12px] font-medium text-[#1F1B16] hover:border-[#B08343] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === "preview" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                        Preview
                      </button>
                      <button
                        onClick={() => run(selectedCount > 0 ? [...selected] : postableRefs, false)}
                        disabled={!!busy || !!missingSetup}
                        title={missingSetup ?? undefined}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#6F5325] px-3 py-1.5 text-[12px] font-medium text-[#FBF8F1] hover:bg-[#5A4320] disabled:cursor-not-allowed disabled:bg-[#B8B0A0]"
                      >
                        {busy === "post" ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        {busy === "post" ? `Booking ${scopeCount}…` : `Record ${scopeCount} order${scopeCount === 1 ? "" : "s"}`}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {missingSetup && postableRefs.length > 0 && (
                <p className="text-[11.5px] text-[#A6472F]">{missingSetup} to continue.</p>
              )}
              {setupError && <p className="text-[11.5px] text-[#A6472F]">{setupError}</p>}
            </>
          )}
        </div>
      )}

      {runError && (
        <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> {runError}
        </div>
      )}

      {attention.length > 0 && (
        <div className="mb-2.5 rounded-lg border border-[#EBD3C9] bg-[#FDF6F3] px-3 py-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-2 font-medium text-[#1F1B16]">
            <AlertTriangle size={13} className="text-[#A6472F]" />
            {attention.length} order{attention.length === 1 ? "" : "s"} need attention
            {attentionSelectable.length > 0 && (
              <button
                onClick={() => setSelected(new Set(attentionSelectable))}
                disabled={!!busy}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-0.5 text-[11.5px] font-normal hover:border-[#B08343] disabled:opacity-50"
              >
                Select these {attentionSelectable.length}
              </button>
            )}
          </div>
          <ul className="mt-1.5 space-y-1">
            {attention.map(({ t, st },i) => (
              <li key={i} className="flex items-start gap-2 leading-snug">
                {postableSet.has(t.ref) ? (
                  <Checkbox className="mt-0.5" checked={selected.has(t.ref)} onCheckedChange={() => toggleSelect(t.ref)} disabled={!!busy} />
                ) : (
                  <span className="inline-block w-4" />
                )}
                <span className="font-mono text-[#1F1B16]">#{t.ref}</span>
                <StatusPill s={st} />
                <span className="text-[#6F5325]">{st.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastRun && (
        <div className={`mb-2.5 rounded-lg border px-3 py-2 text-[12px] ${problems.length ? "border-[#EBD3C9] bg-[#FDF6F3]" : "border-[#D5E3D2] bg-[#F5FAF4]"}`}>
          <div className="flex flex-wrap items-center gap-2 font-medium text-[#1F1B16]">
            {lastRun.dryRun ? <Eye size={13} /> : <CheckCircle2 size={13} className="text-[#4B7A54]" />}
            {lastRun.dryRun ? "Preview — nothing was posted." : "Booking finished."}
            <span className="font-normal text-[#6F5325]">
              {lastRun.results.filter((x) => x.ok).length} {lastRun.dryRun ? "ready" : "done"}
              {problems.length > 0 && <> · {problems.length} need attention (listed above)</>}
              {lastRun.wire && lastRun.wire.status !== "not_needed" && (
                <> · bank&apos;s wire {lastRun.wire.amount > 0 ? "charge" : "gain"}{" "}
                  <b className="tabular-nums">{aed2(Math.abs(lastRun.wire.amount))}</b>{" "}
                  {lastRun.wire.status === "found_existing"
                    ? "already booked"
                    : lastRun.wire.status === "planned"
                      ? "would post"
                      : lastRun.wire.ok
                        ? "booked to exchange gain / loss"
                        : `not booked — ${lastRun.wire.message ?? "failed"}`}</>
              )}
            </span>
            {problems.some((p) => p.status === "failed" || p.status === "busy") && !lastRun.dryRun && (
              <button
                onClick={() => run(problems.filter((p) => p.status === "failed" || p.status === "busy").map((p) => p.orderNumber), false)}
                disabled={!!busy}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-0.5 text-[11.5px] hover:border-[#B08343] disabled:opacity-50"
              >
                <RefreshCw size={11} /> Retry failed
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[#EAE3D6] bg-white">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#FBF8F1]">
              {showSelectColumn && (
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    checked={postableRefs.length > 0 && selected.size === postableRefs.length}
                    onCheckedChange={toggleSelectAll}
                    disabled={!!busy}
                  />
                </th>
              )}
              <th className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Order</th>
              {currency && <th className={th}>{currency}</th>}
              <th className={th}>Gross</th>
              <th className={th} title="What the Zoho invoice still owes — the amount the payment closes">Zoho invoice</th>
              <th className={th}>{crossBorder && vatOnTop ? "Fee + VAT" : "Fee"}</th>
              <th className={th}>{crossBorder ? "FX diff" : vatOnTop ? "VAT on fee" : "VAT in fee"}</th>
              <th className={th}>Net</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {txns.map((t, i) => (
              <ProofRow
                key={t.ref + i}
                t={t}
                order={orderByNumber.get(orderOf(t))}
                missing={orders != null && missingSet.has(orderOf(t))}
                linkPanel={
                  r.payout && !live && (!t.orderNumber || (t.orderNumber !== t.ref && t.orderNumber !== bare(t.ref)))
                    ? <LinkOrderPanel payoutId={r.payout.id} t={t} onChanged={onChanged} />
                    : undefined
                }
                open={openRow === t.ref + i}
                onToggle={() => setOpenRow(openRow === t.ref + i ? null : t.ref + i)}
                status={r.confirmedBy ? statusFor(t) : undefined}
                originalCurrency={currency}
                showSelectColumn={showSelectColumn}
                canSelect={showSelectColumn && postableSet.has(t.ref)}
                selected={selected.has(t.ref)}
                onSelectToggle={() => toggleSelect(t.ref)}
                onRecordOne={() => run([t.ref], false)}
                invoiceNote={r.confirmedBy ? invoiceNoteFor(t.ref) : undefined}
                onForce={(() => {
                  if (!r.confirmedBy || !settlementFor(orderOf(t)) || t.isRefund) return undefined;
                  const k = statusFor(t)?.kind;
                  const forceable = k === "review" || k === "not_closed" || openInvoicesFor(t.ref).length > 0;
                  return forceable ? () => setForcingRef(t.ref) : undefined;
                })()}
                forcePanel={forcingRef === t.ref && settlementFor(orderOf(t)) ? (() => {
                  const plan = planFor(t);
                  return (
                    <ForceOrderPanel
                      settlementId={settlementFor(orderOf(t))!.id}
                      orderNumber={orderOf(t)}
                      gatewayGross={+(t.grossShare * bankScale).toFixed(2)}
                      fee={plan.fee}
                      netReceived={plan.netReceived}
                      differenceName={nameOf(options?.differenceAccounts, differenceAccountId)}
                      depositOptions={(options?.depositAccounts ?? []).map((a) => ({ id: a.account_id, name: a.account_name }))}
                      defaultDepositAccountId={depositAccountId}
                      defaultDate={(r.date ?? "").slice(0, 10)}
                      onCancel={() => setForcingRef(null)}
                      onBooked={async () => { setForcingRef(null); await run([t.ref], false); }}
                    />
                  );
                })() : undefined}
                busy={!!busy || !!missingSetup}
                crossBorder={crossBorder}
                splitFigure={splitFigureFor(t)}
                feeFigure={feeFigureFor(t)}
                invoiceAmount={invoiceAmountFor(t)}
                colCount={colCount}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#D6CCBA] bg-[#FBF8F1]">
              <td className="px-3 py-2 font-medium text-[#6F5325]" colSpan={(showSelectColumn ? 2 : 1) + (currency ? 1 : 0)}>Net settled</td>
              <td colSpan={4} />
              <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-[#6F5325]">{aed2(net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {r.payout && !live && (
        <RefundsPanel
          r={r}
          depositAccountId={depositAccountId}
          depositName={nameOf(options?.depositAccounts, depositAccountId)}
          reloadKey={matchedKey}
          feeAccountId={feeAccountId}
          feeName={nameOf(options?.feeAccounts, feeAccountId)}
          vatTaxId={crossBorder ? "" : vatTaxId}
          inputVatAccountId={options?.inputVatAccountId ?? null}
          refreshSignal={refundCheck}
          accounts={(() => {
            const m = new Map<string, { id: string; name: string }>();
            for (const a of [...(options?.depositAccounts ?? []), ...(options?.feeAccounts ?? []), ...(options?.differenceAccounts ?? [])]) {
              if (!m.has(a.account_id)) m.set(a.account_id, { id: a.account_id, name: `${a.account_name} · ${a.account_type.replace(/_/g, " ")}` });
            }
            return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
          })()}
        />
      )}

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
