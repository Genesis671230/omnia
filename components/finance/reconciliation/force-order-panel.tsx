"use client";

/* Force-book ONE order: list every Zoho invoice under its order number, tick
 * the one(s) to close, set the amount for each, and choose Deposit To, date,
 * reference and description. Books ONE customer payment across the ticked
 * invoices straight away. Built for the live cases:
 *   - two invoices for one order number (a re-issue, or a top-up charge),
 *   - an invoice balance that doesn't match the gateway amount,
 *   - an order "booked" whose payment was later deleted in Zoho (804671).
 * Fee / FX are not re-booked; if they never were, the booking bar's Record
 * finishes them right after. */

import { useEffect, useMemo, useState } from "react";
import { Gavel, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { aed2 } from "./types";

type Invoice = {
  invoiceId: string; invoiceNumber: string; date: string; status: string;
  total: number; balance: number; customerId: string; customerName: string;
};

export function ForceOrderPanel({
  settlementId, orderNumber, gatewayGross, fee, netReceived, differenceName, onBooked, onCancel,
  depositOptions, defaultDepositAccountId, defaultDate,
}: {
  depositOptions: { id: string; name: string }[];
  defaultDepositAccountId: string;
  defaultDate: string;
  settlementId: string;
  orderNumber: string;
  /** What the gateway says the customer paid for this order, AED. */
  gatewayGross: number;
  fee: number;
  netReceived: number;
  differenceName: string;
  /** Saved — run the normal Record for this order. */
  onBooked: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({}); // invoiceId → amount text
  const [note, setNote] = useState("");
  const [depositAccountId, setDepositAccountId] = useState(defaultDepositAccountId);
  const [date, setDate] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [existingPayment, setExistingPayment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/settlements/${settlementId}/force`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j as {
          invoices: Invoice[]; current: { invoice_id: string; amount: number }[] | null; note: string;
          forcePaymentId: string | null; settlementDate: string | null; bankReference: string; gateway: string;
        };
      })
      .then((j) => {
        setInvoices(j.invoices);
        setExistingPayment(j.forcePaymentId);
        setNote(j.note || `${j.gateway} settlement · order ${orderNumber} · gateway paid ${aed2(gatewayGross)} · booked by hand`);
        if (j.settlementDate) setDate(j.settlementDate);
        setReference(`${j.bankReference || orderNumber}/${orderNumber}/F`.slice(0, 100));
        if (j.current?.length) {
          setPicked(Object.fromEntries(j.current.map((a) => [a.invoice_id, String(a.amount)])));
        } else {
          // Default: the open invoice closest to the gateway amount, capped at its balance.
          const open = j.invoices.filter((i) => i.balance > 0.01 && !["void", "draft"].includes(i.status.toLowerCase()));
          const best = [...open].sort((a, b) => Math.abs(a.balance - gatewayGross) - Math.abs(b.balance - gatewayGross))[0];
          if (best) setPicked({ [best.invoiceId]: Math.min(best.balance, gatewayGross).toFixed(2) });
        }
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [settlementId, orderNumber, gatewayGross]);

  const applied = useMemo(
    () => Math.round(Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100,
    [picked],
  );
  const difference = Math.round((applied - fee - netReceived) * 100) / 100;

  const problem = (() => {
    if (!invoices) return "Loading…";
    const ids = Object.keys(picked);
    if (ids.length === 0) return "Tick at least one invoice";
    for (const id of ids) {
      const inv = invoices.find((i) => i.invoiceId === id)!;
      const amt = Number(picked[id]);
      if (!(amt > 0)) return `Enter an amount for ${inv.invoiceNumber}`;
      if (amt > inv.balance + 0.01) return `${inv.invoiceNumber} has only ${aed2(inv.balance)} open`;
    }
    if (new Set(ids.map((id) => invoices.find((i) => i.invoiceId === id)!.customerId)).size > 1) {
      return "Ticked invoices belong to different Zoho customers";
    }
    if (!depositAccountId) return "Pick the Deposit To account";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Pick the payment date";
    if (!note.trim()) return "Write a description";
    return null;
  })();

  const toggle = (inv: Invoice) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[inv.invoiceId] != null) delete next[inv.invoiceId];
      else next[inv.invoiceId] = Math.min(inv.balance, Math.max(0, gatewayGross - applied)).toFixed(2);
      return next;
    });

  const save = async () => {
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const res = await fetch(`/api/settlements/${settlementId}/force`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: Object.entries(picked).map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) })),
          description: note, depositAccountId, date, referenceNumber: reference.trim(), actor: "founder",
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(
        `Payment ${aed2(j.amount)} booked in Zoho (${j.allocations.map((a: { invoice_number: string }) => a.invoice_number).join(" + ")})` +
        (j.replacedDeletedPayment ? " — replaced the payment that had been deleted in Zoho" : ""),
      );
      await onBooked();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/settlements/${settlementId}/force`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setPicked({});
      toast.message("Cleared — this order is back to automatic invoice matching.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#D6CCBA] bg-white p-3 text-[12.5px] text-[#1F1B16]">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 font-semibold"><Gavel size={13} /> Force book order #{orderNumber}</div>
          <div className="mt-0.5 text-[11.5px] text-[#8A8175]">
            Gateway: gross {aed2(gatewayGross)} · fee {aed2(fee)} · net received {aed2(netReceived)}. Tick the invoice(s) this payment closes.
          </div>
        </div>
        <button onClick={onCancel} aria-label="Close" className="text-[#8A8175]"><X size={14} /></button>
      </div>

      {loadError ? (
        <div className="rounded-md bg-[#F9ECE7] px-3 py-2 text-[#A6472F]">Couldn&apos;t read Zoho invoices: {loadError}</div>
      ) : !invoices ? (
        <div className="flex items-center gap-1.5 text-[#8A8175]"><Loader2 size={12} className="animate-spin" /> Reading Zoho invoices for #{orderNumber}…</div>
      ) : invoices.length === 0 ? (
        <div className="text-[#A6472F]">Zoho has no invoice for order #{orderNumber} — run the invoice sync.</div>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-[#8A8175]">
              <th className="w-6 py-1" /><th className="py-1">Invoice</th><th className="py-1">Date</th><th className="py-1">Customer</th>
              <th className="py-1">Status</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Open</th><th className="py-1 text-right">Apply</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const dead = ["void", "draft"].includes(inv.status.toLowerCase()) || inv.balance <= 0.01;
              const on = picked[inv.invoiceId] != null;
              return (
                <tr key={inv.invoiceId} className={`border-t border-[#EAE3D6] ${dead ? "text-[#B5AC9F]" : ""}`}>
                  <td className="py-1.5"><input type="checkbox" checked={on} disabled={dead || busy} onChange={() => toggle(inv)} /></td>
                  <td className="py-1.5 font-mono">{inv.invoiceNumber}</td>
                  <td className="py-1.5">{inv.date}</td>
                  <td className="max-w-[160px] truncate py-1.5" title={inv.customerName}>{inv.customerName}</td>
                  <td className="py-1.5 capitalize">{inv.status}</td>
                  <td className="py-1.5 text-right font-mono">{aed2(inv.total)}</td>
                  <td className="py-1.5 text-right font-mono">{aed2(inv.balance)}</td>
                  <td className="py-1.5 text-right">
                    {on ? (
                      <input
                        value={picked[inv.invoiceId]} inputMode="decimal"
                        onChange={(e) => setPicked((p) => ({ ...p, [inv.invoiceId]: e.target.value }))}
                        className="w-24 rounded border border-[#D6CCBA] px-1.5 py-0.5 text-right font-mono"
                      />
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {invoices && invoices.length > 0 && (
        <div className="mt-2 rounded-md bg-[#FBF3E6] px-3 py-2 text-[11.5px] leading-relaxed text-[#6F5325]">
          One payment of <b>{aed2(applied)}</b> into <b>{depositOptions.find((d) => d.id === depositAccountId)?.name || "the Deposit To account"}</b> is applied to the ticked invoice{Object.keys(picked).length === 1 ? "" : "s"} (an invoice not paid in full stays open for the rest).
          {Math.abs(difference) >= 0.01 && (
            <> Applied − fee − net received = <b>{aed2(difference)}</b>, booked to <b>{differenceName || "the exchange gain / loss account"}</b>
              {difference > 0 ? " as a loss" : " as a gain"}.</>
          )}
        </div>
      )}

      {existingPayment && !existingPayment.startsWith("PENDING:") && (
        <div className="mt-2 rounded-md bg-[#F3EFE7] px-3 py-1.5 text-[11.5px] text-[#6F5325]">
          A force payment ({existingPayment}) was already booked for this order. Booking again adds another payment.
        </div>
      )}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-[11.5px] font-medium">
          Deposit to
          <select value={depositAccountId} onChange={(e) => setDepositAccountId(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[12px] font-normal">
            <option value="">Select clearing account…</option>
            {depositOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="text-[11.5px] font-medium">
          Payment date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#D6CCBA] px-2 py-1 text-[12px] font-normal" />
        </label>
        <label className="text-[11.5px] font-medium">
          Reference
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100}
            className="mt-1 w-full rounded-md border border-[#D6CCBA] px-2 py-1 font-mono text-[12px] font-normal" />
        </label>
      </div>

      <label className="mt-2 block text-[11.5px] font-medium">
        Description (goes on the Zoho payment)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
          className="mt-1 w-full rounded-md border border-[#D6CCBA] px-2 py-1 text-[12px] font-normal" />
      </label>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {problem && invoices && <span className="mr-auto text-[11.5px] text-[#A6472F]">{problem}</span>}
        <button onClick={clear} disabled={busy} className="text-[11.5px] text-[#8A8175] underline">Clear override</button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-[#D6CCBA] bg-white px-3 py-1 text-[12px]">Cancel</button>
        <button onClick={save} disabled={busy || !!problem}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#A6472F] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Gavel size={12} />} Book {aed2(applied)} in Zoho
        </button>
      </div>
    </div>
  );
}
