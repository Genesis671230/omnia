"use client";

/* A bank debit that paid a supplier — book it one of two ways:
 *
 *   Pay a supplier     pick the supplier, see their open bills, apply the
 *                      payment across them (oldest first, or type amounts);
 *                      whatever isn't applied stays on the supplier as an
 *                      advance. Any amount up to the debit — one transfer can
 *                      pay several suppliers, one at a time.
 *   Book to an account the whole debit to any account (Prepaid Expenses,
 *                      Advance to suppliers…) — an expense paid from the bank.
 *
 * Routes: /api/zoho/vendors, /api/zoho/vendors/:id/bills,
 * /api/bank-lines/:id/supplier-payment, /api/integrations/zoho/post-bank-lines. */

import { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Lock, Plus, Search, Sparkles, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import type { OpenBill, Vendor, VendorAdvance } from "@/lib/integrations/zoho-vendors";
import { allocateOldestFirst, checkAllocation } from "@/lib/finance/supplier-payment";
import { AccountCombobox } from "./account-combobox";
import type { BankTxnLine } from "./bank-txn-row";
import { aed2 } from "./types";

type ZohoAccount = { account_id: string; account_name: string; account_type: string };
type Mode = "supplier" | "account";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The payee a narration names — "Outward Telex Payment/DETO AUTOMATIC DOORS LLC/SW-…" → "DETO AUTOMATIC DOORS LLC". */
export function payeeFromNarration(narration: string): string {
  const skip = /payment|debit|credit|transfer|telex|ibk|charges|tof|channel|ibmb|^sw-|^to |ben info/i;
  for (const raw of narration.split("/")) {
    const seg = raw.replace(/^Ben Info:\s*[\d,\s]*/i, "").replace(/\\HCP$/i, "").trim();
    if (seg.length < 4 || skip.test(seg) || /\d{5,}/.test(seg) || !/[a-z]{3}/i.test(seg)) continue;
    return seg.replace(/[.,]+$/, "");
  }
  return "";
}

export function SupplierPaymentDialog({
  line, bankAccountId, accounts, onClose, onBooked,
}: {
  line: BankTxnLine;
  /** The bank account this statement is — what the money left from. */
  bankAccountId: string;
  accounts: ZohoAccount[];
  onClose: () => void;
  onBooked: () => void;
}) {
  const [mode, setMode] = useState<Mode>("supplier");
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F1B3D]/40 p-4" role="dialog" aria-modal aria-label="Book a supplier payment">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#E3E9F5] px-6 py-5">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[#0F1B3D]">Book {aed2(line.amount)} paid out on {line.date?.slice(0, 10) ?? "—"}</h3>
            <p className="mt-1 truncate text-[12.5px] text-[#5E6B85]" title={line.description}>{line.reference ? `${line.reference} · ` : ""}{line.description}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="rounded-full p-1.5 text-[#5E6B85] hover:bg-[#F3F6FC]"><X size={16} /></button>
        </header>

        <div className="flex gap-2 px-6 pt-4">
          {([["supplier", "Pay a supplier", Building2], ["account", "Book to an account", Wallet]] as const).map(([m, label, Icon]) => (
            <button key={m} onClick={() => setMode(m)} disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] ${mode === m ? "bg-[#0F1B3D] text-white" : "bg-[#F3F6FC] text-[#0F1B3D] hover:bg-[#E9EFFA]"}`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>

        {mode === "supplier"
          ? <SupplierMode line={line} bankAccountId={bankAccountId} accounts={accounts} busy={busy} setBusy={setBusy} onDone={() => { onBooked(); onClose(); }} />
          : <AccountMode line={line} bankAccountId={bankAccountId} accounts={accounts} busy={busy} setBusy={setBusy} onDone={() => { onBooked(); onClose(); }} />}
      </div>
    </div>
  );
}

/* ── pay a supplier ────────────────────────────────────────────────────── */

function SupplierMode({ line, bankAccountId, accounts, busy, setBusy, onDone }: {
  line: BankTxnLine; bankAccountId: string; accounts: ZohoAccount[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [bills, setBills] = useState<OpenBill[] | null>(null);
  const [applied, setApplied] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState(String(line.amount));
  const [paidThrough, setPaidThrough] = useState(bankAccountId);
  const [locked, setLocked] = useState("");
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [suggested, setSuggested] = useState<Vendor[]>([]);
  // "bills": apply this payment to bills · "advance": nothing applied, it all
  // sits on the supplier as unused — a quotation deposit, applied later.
  const [how, setHow] = useState<"bills" | "advance">("bills");
  const [advances, setAdvances] = useState<VendorAdvance[] | null>(null);
  const [applying, setApplying] = useState<VendorAdvance | null>(null);
  const [creating, setCreating] = useState(false);
  const payee = useMemo(() => payeeFromNarration(line.description), [line.description]);
  // `bankLine` makes the server use this line's own books (RAK → House of Omnia).
  const scope = `bankLine=${encodeURIComponent(line.id)}`;

  // Supplier search, debounced.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setLoadingVendors(true);
      try {
        const res = await fetch(`/api/zoho/vendors?q=${encodeURIComponent(q.trim())}&${scope}`);
        const j = await res.json();
        if (!live) return;
        if (res.status === 403) setLocked(j.error);
        else if (!res.ok) toast.error(j.error || `HTTP ${res.status}`);
        else {
          setVendors(j.vendors ?? []);
          const s = (j.suggested ?? []) as Vendor[];
          setSuggested(s);
          // The supplier the narration names (e.g. "/GUWU/" → GUWUX), picked for you.
          if (s.length) setVendor((cur) => cur ?? s[0]);
        }
      } finally {
        if (live) setLoadingVendors(false);
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // The supplier's unused advances — money paid before a bill existed.
  useEffect(() => {
    if (!vendor) return;
    let live = true;
    setAdvances(null);
    setApplying(null);
    fetch(`/api/zoho/vendors/${encodeURIComponent(vendor.vendor_id)}/advances?${scope}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j.advances as VendorAdvance[]; })
      .then((a) => live && setAdvances(a))
      .catch(() => live && setAdvances([]));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor]);

  // A supplier's open bills, pre-filled oldest first.
  useEffect(() => {
    if (!vendor) return;
    let live = true;
    setBills(null);
    fetch(`/api/zoho/vendors/${encodeURIComponent(vendor.vendor_id)}/bills?${scope}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j.bills as OpenBill[]; })
      .then((b) => { if (!live) return; setBills(b); setApplied(allocateOldestFirst(Number(amount) || 0, b)); })
      .catch((e) => { if (live) { setBills([]); toast.error((e as Error).message); } });
    return () => { live = false; };
    // Re-allocating on every amount keystroke would fight manual edits — only on supplier change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor]);

  // Applying an old advance: its unused balance is the "payment"; the bank debit isn't involved.
  const effApplied = how === "advance" && !applying ? {} : applied;
  const check = useMemo(
    () => applying
      ? checkAllocation({ amount: applying.balance, bankAmount: applying.balance, bills: bills ?? [], applied })
      : checkAllocation({ amount: Number(amount), bankAmount: line.amount, bills: bills ?? [], applied: effApplied }),
    [amount, line.amount, bills, applied, effApplied, applying],
  );

  const createSupplier = async (name: string) => {
    setCreating(true);
    try {
      const res = await fetch(`/api/zoho/vendors?${scope}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(j.existed ? `${j.vendor.name} already exists — picked it.` : `Created supplier ${j.vendor.name} in Zoho.`);
      setVendors((v) => [j.vendor, ...v.filter((x) => x.vendor_id !== j.vendor.vendor_id)]);
      setVendor(j.vendor);
      setHow("advance");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const applyAdvance = async () => {
    if (!applying) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zoho/vendorpayments/${encodeURIComponent(applying.payment_id)}/apply?${scope}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applied }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(`Applied ${aed2(check.applied)} of the advance to bills — ${aed2(j.unusedLeft)} still unused.`);
      // Refresh both lists; the bank debit itself is still waiting to be booked.
      const v = vendor; setVendor(null); setTimeout(() => setVendor(v), 0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const book = async () => {
    if (!vendor) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bank-lines/${encodeURIComponent(line.id)}/supplier-payment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: vendor.vendor_id, vendorName: vendor.name, amount: Number(amount), applied: effApplied, paidThroughAccountId: paidThrough }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(j.status === "found_existing"
        ? `Already in Zoho — payment ${j.paymentId}, not booked again.`
        : `Paid ${vendor.name} ${aed2(Number(amount))} in Zoho${check.advance > 0 ? ` (${aed2(check.advance)} as advance)` : ""}.`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (locked) {
    return (
      <div className="m-6 flex items-start gap-3 rounded-2xl bg-[#FFF7E8] px-4 py-4 text-[13px] leading-relaxed text-[#7A4B00]">
        <Lock size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Zoho won&apos;t let this app read suppliers yet.</p>
          <p className="mt-1">{locked}</p>
          <p className="mt-2">Meanwhile, use <b>Book to an account</b> (e.g. Advance to suppliers) and apply it to the bill in Zoho later.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid flex-1 gap-5 overflow-y-auto px-6 py-5 md:grid-cols-[0.9fr_1.1fr]">
        <div className="min-w-0">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">Supplier</label>
          <div className="relative mt-1.5">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA6BD]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers…" autoFocus
              className="h-10 w-full rounded-xl border border-[#D8E1F1] pl-9 pr-3 text-[13px] focus:border-[#1D4ED8] focus:outline-none" />
          </div>
          {suggested.length > 0 && !q && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#5E6B85]">
              <Sparkles size={12} className="text-[#1D4ED8]" /> Named in the bank narration:
              {suggested.map((v) => (
                <button key={v.vendor_id} onClick={() => setVendor(v)}
                  className={`rounded-full px-2.5 py-0.5 ${vendor?.vendor_id === v.vendor_id ? "bg-[#1D4ED8] text-white" : "bg-[#EAF1FD] text-[#1D4ED8] hover:bg-[#DCE7FB]"}`}>
                  {v.name}{v.outstanding > 0 ? ` · owes ${aed2(v.outstanding)}` : ""}
                </button>
              ))}
            </div>
          )}
          <ul className="mt-2 max-h-[300px] overflow-y-auto rounded-xl border border-[#E3E9F5]">
            {loadingVendors && vendors.length === 0 && <li className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-[#5E6B85]"><Loader2 size={13} className="animate-spin" /> Loading suppliers…</li>}
            {!loadingVendors && vendors.length === 0 && <li className="px-3 py-3 text-[12.5px] text-[#5E6B85]">No supplier matches.</li>}
            {(() => {
              const name = (q.trim() || (suggested.length ? "" : payee)).trim();
              if (!name || vendors.some((v) => v.name.trim().toLowerCase() === name.toLowerCase())) return null;
              return (
                <li className="border-b border-[#EEF2F8]">
                  <button onClick={() => createSupplier(name)} disabled={creating}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-[#1D4ED8] hover:bg-[#F7F9FE] disabled:opacity-50">
                    {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create supplier &ldquo;{name}&rdquo; in Zoho
                  </button>
                </li>
              );
            })()}
            {vendors.map((v) => (
              <li key={v.vendor_id}>
                <button onClick={() => setVendor(v)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] ${vendor?.vendor_id === v.vendor_id ? "bg-[#EAF1FD]" : "hover:bg-[#F7F9FE]"}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[#0F1B3D]">{v.name}</span>
                    {v.company && v.company !== v.name && <span className="block truncate text-[11.5px] text-[#5E6B85]">{v.company}</span>}
                  </span>
                  <span className="shrink-0 text-right text-[11.5px] tabular-nums text-[#5E6B85]">
                    {v.outstanding > 0 ? <>owes <b className="font-medium text-[#0F1B3D]">{aed2(v.outstanding)}</b></> : "nothing owed"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">Amount paid</span>
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#D8E1F1] px-3 text-[13px] tabular-nums focus:border-[#1D4ED8] focus:outline-none" />
              <span className="mt-1 block text-[11px] text-[#9AA6BD]">Up to the debit, {aed2(line.amount)}</span>
            </label>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">Paid from</span>
              <div className="mt-1.5">
                <AccountCombobox accounts={accounts.filter((a) => ["bank", "cash", "credit_card"].includes(a.account_type))} value={paidThrough} onChange={setPaidThrough} placeholder="Bank account" />
              </div>
            </div>
          </div>

          {vendor && !applying && (
            <div className="mt-4 flex gap-1.5 rounded-full bg-[#F3F6FC] p-1 text-[12.5px]">
              {([["bills", "Apply to bills"], ["advance", "Advance — no bill yet"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setHow(k)}
                  className={`flex-1 rounded-full px-3 py-1.5 ${how === k ? "bg-white font-medium text-[#0F1B3D] shadow-sm" : "text-[#5E6B85]"}`}>{label}</button>
              ))}
            </div>
          )}
          {vendor && how === "advance" && !applying && (
            <p className="mt-3 rounded-xl bg-[#EEF7F0] px-3 py-3 text-[12.5px] leading-relaxed text-[#1F5D35]">
              The whole {aed2(Number(amount) || 0)} is recorded as a payment to {vendor.name} with nothing applied — it shows on the supplier as
              <b> unused</b>. When the bill arrives, apply it from &ldquo;Unused advances&rdquo; here (or in Zoho). Use this for deposits on a quotation.
            </p>
          )}
          {vendor && advances && advances.length > 0 && (
            <div className="mt-4 rounded-xl border border-[#E3E9F5] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">Unused advances to {vendor.name}</div>
              <ul className="mt-2 space-y-1.5">
                {advances.map((a) => (
                  <li key={a.payment_id} className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ${applying?.payment_id === a.payment_id ? "bg-[#EAF1FD]" : "bg-[#F7F9FE]"}`}>
                    <span className="min-w-0 truncate" title={a.description}>{a.date} · {a.payment_number || a.reference_number} · <b className="tabular-nums">{aed2(a.balance)}</b> unused of {aed2(a.amount)}</span>
                    {applying?.payment_id === a.payment_id
                      ? <button className="shrink-0 text-[#5E6B85] hover:underline" onClick={() => { setApplying(null); setApplied(allocateOldestFirst(Number(amount) || 0, bills ?? [])); }}>Cancel</button>
                      : <button className="shrink-0 font-medium text-[#1D4ED8] hover:underline" disabled={!bills?.length}
                          onClick={() => { setApplying(a); setApplied(allocateOldestFirst(a.balance, bills ?? [])); }}>Apply to bills</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={`mt-4 ${how === "advance" && !applying ? "hidden" : ""}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">{applying ? `Apply the ${aed2(applying.balance)} advance to` : "Open bills"}</span>
              {bills && bills.length > 0 && (
                <span className="flex gap-3 text-[11.5px]">
                  <button className="text-[#1D4ED8] hover:underline" onClick={() => setApplied(allocateOldestFirst(applying ? applying.balance : Number(amount) || 0, bills))}>Fill oldest first</button>
                  <button className="text-[#5E6B85] hover:underline" onClick={() => setApplied({})}>Clear</button>
                </span>
              )}
            </div>
            {!vendor ? <p className="mt-2 rounded-xl bg-[#F7F9FE] px-3 py-3 text-[12.5px] text-[#5E6B85]">Pick a supplier to see what you owe them.</p>
              : bills == null ? <p className="mt-2 flex items-center gap-2 px-1 py-3 text-[12.5px] text-[#5E6B85]"><Loader2 size={13} className="animate-spin" /> Loading bills…</p>
              : bills.length === 0 ? <p className="mt-2 rounded-xl bg-[#F7F9FE] px-3 py-3 text-[12.5px] text-[#5E6B85]">No open bills — the whole amount is recorded as an advance to {vendor.name}.</p>
              : (
                <table className="mt-2 w-full text-[12.5px]">
                  <thead className="text-left text-[10.5px] uppercase tracking-wide text-[#9AA6BD]">
                    <tr><th className="py-1 font-medium">Bill</th><th className="py-1 font-medium">Due</th><th className="py-1 text-right font-medium">Balance</th><th className="py-1 text-right font-medium">Pay</th></tr>
                  </thead>
                  <tbody>
                    {bills.map((b) => (
                      <tr key={b.bill_id} className="border-t border-[#EEF2F8]">
                        <td className="py-1.5">
                          <span className="block font-medium text-[#0F1B3D]">{b.bill_number || b.reference_number || b.bill_id}</span>
                          <span className="text-[11px] text-[#9AA6BD]">{b.date}{b.status === "overdue" ? " · overdue" : ""}</span>
                        </td>
                        <td className="py-1.5 text-[#5E6B85]">{b.due_date || "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-[#0F1B3D]">{aed2(b.balance)}</td>
                        <td className="py-1.5 text-right">
                          <input type="number" min={0} step="0.01" value={applied[b.bill_id] ?? ""} placeholder="0.00"
                            onChange={(e) => setApplied((a) => ({ ...a, [b.bill_id]: r2(Number(e.target.value) || 0) }))}
                            className="h-8 w-24 rounded-lg border border-[#D8E1F1] px-2 text-right tabular-nums focus:border-[#1D4ED8] focus:outline-none" aria-label={`Amount for bill ${b.bill_number}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-[#E3E9F5] bg-[#F7F9FE] px-6 py-4 text-[12.5px]">
        {applying ? (
          <span className="text-[#5E6B85]">
            From the advance to bills <b className="tabular-nums text-[#0F1B3D]">{aed2(check.applied)}</b> · stays unused <b className="tabular-nums text-[#0F1B3D]">{aed2(r2(applying.balance - check.applied))}</b>
          </span>
        ) : (
        <span className="text-[#5E6B85]">
          To bills <b className="tabular-nums text-[#0F1B3D]">{aed2(check.applied)}</b>
          {check.advance > 0 && <> · advance to supplier <b className="tabular-nums text-[#0F1B3D]">{aed2(check.advance)}</b></>}
          {Number(amount) < line.amount - 0.005 && <> · {aed2(r2(line.amount - Number(amount)))} of the debit left to book</>}
        </span>
        )}
        {!check.ok && Number(amount) > 0 && <span className="w-full text-[#A6472F]">{check.errors[0]}</span>}
        {applying ? (
          <button onClick={applyAdvance} disabled={busy || !check.ok || check.applied <= 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#1D4ED8] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">
            {busy && <Loader2 size={13} className="animate-spin" />} Apply {aed2(check.applied)} of the advance
          </button>
        ) : (
          <button onClick={book} disabled={busy || !vendor || !check.ok || !paidThrough}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#0F1B3D] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">
            {busy && <Loader2 size={13} className="animate-spin" />} {how === "advance" ? "Record advance payment in Zoho" : "Record payment in Zoho"}
          </button>
        )}
      </footer>
    </>
  );
}

/* ── book to an account ────────────────────────────────────────────────── */

function AccountMode({ line, bankAccountId, accounts, busy, setBusy, onDone }: {
  line: BankTxnLine; bankAccountId: string; accounts: ZohoAccount[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void;
}) {
  const suggested = accounts.find((a) => /prepaid expenses?$/i.test(a.account_name.trim()))?.account_id
    ?? accounts.find((a) => /advance to suppliers|prepaid/i.test(a.account_name))?.account_id ?? "";
  const [accountId, setAccountId] = useState(suggested);
  const [note, setNote] = useState("");
  const accountName = accounts.find((a) => a.account_id === accountId)?.account_name ?? "";

  const book = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/zoho/post-bank-lines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drafts: [{
            bankLineId: line.id, transactionType: "expense", fromAccountId: bankAccountId, toAccountId: accountId,
            amount: line.amount, date: line.date, reference: line.reference,
            description: (note.trim() || line.zohoDescription || line.description).slice(0, 500),
          }],
          actor: "founder",
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const r = j.results?.[0];
      if (r?.status === "failed") throw new Error(r.error || "Zoho refused it");
      toast.success(`Booked ${aed2(line.amount)} to ${accountName}.`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="space-y-4 px-6 py-5">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">Account</span>
          <div className="mt-1.5"><AccountCombobox accounts={accounts} value={accountId} onChange={setAccountId} suggestedAccountId={suggested} placeholder="Prepaid Expenses, Advance to suppliers…" /></div>
          <p className="mt-1.5 text-[11.5px] text-[#9AA6BD]">The whole debit, {aed2(line.amount)}, paid from the bank into this account. Use an advance or prepaid account when the bill isn&apos;t in Zoho yet.</p>
        </div>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">Description for Zoho</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={line.zohoDescription || line.description}
            className="mt-1.5 h-10 w-full rounded-xl border border-[#D8E1F1] px-3 text-[13px] focus:border-[#1D4ED8] focus:outline-none" />
        </label>
      </div>
      <footer className="flex items-center justify-end gap-3 border-t border-[#E3E9F5] bg-[#F7F9FE] px-6 py-4">
        <button onClick={book} disabled={busy || !accountId || !bankAccountId}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1B3D] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">
          {busy && <Loader2 size={13} className="animate-spin" />} Book {aed2(line.amount)}{accountName ? ` to ${accountName}` : ""}
        </button>
      </footer>
    </>
  );
}
