"use client";

/* A COD courier voucher's delivery / return charges — the rows with no
 * cash collected (Pro Price 0): OnTrack delivered a prepaid order, or took a
 * return back, and netted its charge out of the remittance. They close no
 * invoice, so they are listed here and booked as ONE VAT-inclusive expense
 * out of the Deposit To (clearing) account into the account picked below. */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import type { DeliveryPublishResult } from "@/lib/finance/publish-settlements";
import { AccountSelect, readPrefs, writePrefs } from "./gateway-proof";
import { aed2, type ReconLine } from "./types";

const PREF_KEY = "omnia.cod.deliveryAccountId";
const DELIVERY_RE = /deliver|shipping|courier|freight|postage/i;

export function DeliveryChargesPanel({
  r, expenseAccounts, depositAccountId, vatTaxId, vatName, referenceOverride,
}: {
  r: ReconLine;
  expenseAccounts: { account_id: string; account_name: string }[];
  depositAccountId: string;
  vatTaxId: string;
  vatName: string;
  referenceOverride?: string;
}) {
  const charges = useMemo(() => r.payout?.deliveryCharges ?? [], [r.payout?.deliveryCharges]);
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeliveryPublishResult | null>(null);

  useEffect(() => {
    if (accountId || expenseAccounts.length === 0) return;
    const saved = readPrefs(PREF_KEY).accountId;
    if (saved && expenseAccounts.some((a) => a.account_id === saved)) return setAccountId(saved);
    const guess = expenseAccounts.find((a) => DELIVERY_RE.test(a.account_name));
    if (guess) setAccountId(guess.account_id);
  }, [expenseAccounts, accountId]);

  if (charges.length === 0) return null;
  const total = Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const vat = Math.round(charges.reduce((s, c) => s + c.vat, 0) * 100) / 100;
  const returns = charges.filter((c) => c.isReturn).length;
  const accountName = expenseAccounts.find((a) => a.account_id === accountId)?.account_name ?? "";

  const book = async (dryRun: boolean) => {
    if (!accountId) return toast.error("Pick the delivery charges account first.");
    if (!depositAccountId) return toast.error("Pick the Deposit To account first.");
    writePrefs(PREF_KEY, { accountId });
    setBusy(true);
    try {
      const res = await fetch("/api/settlements/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankLineId: r.id, deliveryOnly: true, depositAccountId, feeAccountId: accountId,
          deliveryAccountId: accountId, vatTaxId, referenceNumberOverride: referenceOverride, dryRun,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const d = j.delivery as DeliveryPublishResult | undefined;
      setResult(d ?? null);
      if (!d) toast.message("No delivery charges on this credit.");
      else if (!d.ok) toast.error(d.message ?? "Delivery charges not booked.");
      else toast.success(
        d.status === "planned" ? `Preview: ${aed2(d.amount)} would be booked.`
        : d.status === "found_existing" ? `Already in Zoho (${d.reference}) — not booked again.`
        : `Booked ${d.count} delivery charges, ${aed2(d.amount)}, in Zoho.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] p-3 text-[12px] text-[#1F1B16]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Truck size={13} /> Delivery charges · {charges.length} row{charges.length === 1 ? "" : "s"}
          {returns > 0 && <span className="font-normal text-[#8A8175]">({returns} return{returns === 1 ? "" : "s"})</span>}
          · <span className="tabular-nums">{aed2(total)}</span>
          <span className="font-normal text-[#8A8175]">incl. VAT {aed2(vat)}</span>
        </span>
        <ChevronDown size={13} className={`text-[#8A8175] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[#6F5325]">
        Rows where the courier collected no cash: it delivered a prepaid order or took a return, and kept its
        charge from the remittance. No invoice closes — they book as one expense out of the Deposit To account
        {vatTaxId ? <> with input VAT (<b>{vatName}</b>)</> : <> with no VAT</>}.
      </p>

      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-[#EAE3D6] bg-white">
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0 bg-[#FBF8F1] text-left text-[10.5px] uppercase tracking-wide text-[#8A8175]">
              <tr><th className="px-2 py-1">Order</th><th className="px-2 py-1">Voucher</th><th className="px-2 py-1">Status</th>
                <th className="px-2 py-1 text-right">Ex VAT</th><th className="px-2 py-1 text-right">VAT</th><th className="px-2 py-1 text-right">Charge</th></tr>
            </thead>
            <tbody>
              {charges.map((c, i) => (
                <tr key={`${c.ref}-${c.voucherNo}-${i}`} className="border-t border-[#EAE3D6]">
                  <td className="px-2 py-1 font-mono">
                    #{c.ref}{c.isReturn && <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-[#F3EFE7] px-1.5 text-[10px] text-[#8A8175]"><RotateCcw size={9} /> return</span>}
                  </td>
                  <td className="px-2 py-1 font-mono text-[#8A8175]">{c.voucherNo}</td>
                  <td className="px-2 py-1 text-[#8A8175]">{c.status}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{aed2(c.exVat)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{aed2(c.vat)}</td>
                  <td className="px-2 py-1 text-right font-medium tabular-nums">{aed2(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <AccountSelect
            label="Delivery charges account" hint="expense"
            value={accountId} onChange={setAccountId} placeholder="Select expense account…"
            options={expenseAccounts.map((a) => ({ id: a.account_id, name: a.account_name }))}
          />
        </div>
        <button onClick={() => book(true)} disabled={busy}
          className="rounded-md border border-[#D6CCBA] bg-white px-3 py-1.5 text-[12px] disabled:opacity-50">Preview</button>
        <button onClick={() => book(false)} disabled={busy || !accountId || !depositAccountId}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#B08343] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
          {busy && <Loader2 size={12} className="animate-spin" />} Book {aed2(total)} to {accountName || "…"}
        </button>
      </div>
      {result && (
        <div className={`mt-2 rounded-md px-2.5 py-1.5 text-[11.5px] ${result.ok ? "bg-[#F0F5EF] text-[#4B7A54]" : "bg-[#F9ECE7] text-[#A6472F]"}`}>
          {result.status === "booked" ? `Booked · expense ${result.expenseId} · ref ${result.reference}`
            : result.status === "found_existing" ? `Already in Zoho · expense ${result.expenseId} · ref ${result.reference}`
            : result.status === "planned" ? `Preview ok · ref ${result.reference}`
            : result.message}
        </div>
      )}
    </div>
  );
}
