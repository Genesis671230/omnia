"use client";

/* The month in money — dark sales report + the Zoho cross-check.
 *
 * Sales report: counted sales (the one sale rule), what reached the bank,
 * what's pending, gateway fees, refunds (Zoho credit notes with a value) and
 * the net left. Same figures as the money overview below (sales ledger).
 *
 * Zoho check: the stored result of /api/finance/zoho-sales-verify — store
 * sales vs Zoho invoices, every order with no Zoho document, Zoho sales with
 * no order, exchanges invoiced twice, refunds, cancellations. Re-running it
 * reads Zoho (~130 calls, ~4 min), so it only runs on the button. */

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { sumDays, toDayMoney } from "@/lib/orders/day-money";
import type { Flag, SalesVerification } from "@/lib/finance/zoho-sales-verify";
import type { LedgerDay } from "../day-sales-drawer";
import { compact, fmt, pct } from "../overview/kit";
import { DARK_CARD } from "./funnel";

const WHITE_CARD = "rounded-[30px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(15,23,42,0.22)]";

function defaultMonth(): string {
  const now = new Date(Date.now() + 4 * 3600_000);
  // The first days of a month are near empty — open on the month just closed.
  if (now.getUTCDate() <= 5) now.setUTCMonth(now.getUTCMonth() - 1, 1);
  return now.toISOString().slice(0, 7);
}
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

type Stored = { verification: SalesVerification | null; checkedAt: string | null; zohoCalls?: number };

export function MonthFinancials() {
  const [month, setMonth] = useState(defaultMonth);
  const [days, setDays] = useState<LedgerDay[] | null>(null);
  const [stored, setStored] = useState<Stored | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [open, setOpen] = useState(false);
  const thisMonth = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);

  const load = useCallback(async () => {
    setDays(null);
    setStored(null);
    const [ledger, zv] = await Promise.all([
      fetch(`/api/orders/sales-ledger?month=${month}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch(`/api/finance/zoho-sales-verify?month=${month}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    setDays(ledger?.days ?? []);
    setStored(zv && !zv.error ? zv : { verification: null, checkedAt: null });
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => (days ? sumDays(days.filter((d) => d.orders > 0).map(toDayMoney)) : null), [days]);
  const v = stored?.verification ?? null;

  const verify = async () => {
    setVerifying(true);
    try {
      const res = await fetch(`/api/finance/zoho-sales-verify?month=${month}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setStored(j);
      toast.success(`Zoho checked — ${j.verification.flags.length} item${j.verification.flags.length === 1 ? "" : "s"} to look at.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const refunds = v?.refunds.totalAed ?? 0;
  const net = totals ? totals.soldAed - refunds - totals.feeAed : 0;
  const bars = totals ? [
    { label: "Sold", value: totals.soldAed, color: "linear-gradient(180deg,#8B9CFF,#5B3DF5)" },
    { label: "Refunds", value: -refunds, color: "linear-gradient(180deg,#F59E9E,#F2705E)" },
    { label: "Gateway fees", value: -totals.feeAed, color: "linear-gradient(180deg,#FDBA74,#F59E0B)" },
    { label: "Net", value: net, color: "linear-gradient(180deg,#6EE7B7,#10B981)" },
  ] : [];
  const scale = totals?.soldAed || 1;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      {/* ── sales report ── */}
      <div className={`${DARK_CARD} px-7 pb-6 pt-6 xl:col-span-8`}>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_0%,rgba(59,91,253,0.5),transparent_60%),radial-gradient(50%_70%_at_0%_100%,rgba(16,185,129,0.22),transparent_60%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[26px] font-light tracking-[-0.02em]">Sales report</h3>
            <p className="mt-1 text-[12.5px] text-white/50">Counted store sales · refunds from Zoho credit notes · {monthName(month)}</p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/10 p-1">
            <button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><ChevronLeft size={15} /></button>
            <span className="px-2 text-[12.5px]">{monthName(month)}</span>
            <button aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30"><ChevronRight size={15} /></button>
          </div>
        </div>

        {!totals ? (
          <div className="relative mt-10 flex items-center gap-2 text-[13px] text-white/50"><Loader2 size={14} className="animate-spin" /> Reading the month…</div>
        ) : (
          <div className="relative mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_1.2fr]">
            <div>
              <div className="text-[13px] text-white/55">Sold</div>
              <div className="mt-1 text-[48px] font-light leading-none tabular-nums tracking-[-0.04em]" title={`AED ${fmt(totals.soldAed, 2)}`}>
                <span className="mr-2 text-[16px] text-white/50">AED</span>{compact(totals.soldAed)}
              </div>
              <div className="mt-2 text-[12.5px] text-white/55">{fmt(totals.orders)} orders · AOV AED {fmt(totals.orders ? totals.soldAed / totals.orders : 0)}</div>
              <div className="mt-6 space-y-3">
                {[
                  { k: "In the bank", v: totals.receivedAed, c: "#10B981" },
                  { k: "Pending", v: totals.pendingAed, c: "#8B9CFF" },
                  { k: "of which COD with the courier", v: totals.codAed, c: "#F2705E" },
                ].map((r) => (
                  <div key={r.k}>
                    <div className="flex justify-between text-[12.5px]"><span className="text-white/60">{r.k}</span><span className="tabular-nums">AED {compact(r.v)} · {pct(totals.soldAed ? r.v / totals.soldAed : 0)}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <motion.div className="h-full rounded-full" style={{ background: r.c }} initial={{ width: 0 }} animate={{ width: `${totals.soldAed ? (r.v / totals.soldAed) * 100 : 0}%` }} transition={{ duration: 0.9 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* waterfall: sold → refunds → fees → net */}
            <div className="flex h-[230px] items-end gap-4">
              {bars.map((b, i) => {
                const h = (Math.abs(b.value) / scale) * 100;
                const offset = i === 1 ? 100 - h : i === 2 ? ((totals.soldAed - refunds) / scale) * 100 - h : 0;
                return (
                  <div key={b.label} className="flex h-full flex-1 flex-col justify-end">
                    <div className="mb-1.5 text-center text-[12px] tabular-nums text-white/80">{b.value < 0 ? "−" : ""}{compact(Math.abs(b.value))}</div>
                    <div className="relative flex-1">
                      <motion.div className="absolute inset-x-0 rounded-[10px]" style={{ background: b.color, bottom: `${Math.max(offset, 0)}%` }}
                        initial={{ height: 0 }} animate={{ height: `${Math.max(h, 1.5)}%` }} transition={{ duration: 0.8, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }} />
                    </div>
                    <div className="mt-2 text-center text-[11.5px] text-white/55">{b.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {totals && !v && <p className="relative mt-4 text-[11.5px] text-white/40">Refunds appear once this month is verified with Zoho.</p>}
        {totals && totals.feeEstimatedShare > 0.05 && <p className="relative mt-2 text-[11.5px] text-white/40">{pct(totals.feeEstimatedShare)} of the fees are estimates until those payout files are uploaded.</p>}
      </div>

      {/* ── zoho check ── */}
      <div className={`${WHITE_CARD} flex flex-col px-6 pb-5 pt-6 xl:col-span-4`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[22px] font-light tracking-[-0.02em] text-slate-900">Zoho check</h3>
            <p className="mt-1 text-[12.5px] text-slate-500">
              {stored?.checkedAt ? `Checked ${new Date(stored.checkedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Not verified yet"}
            </p>
          </div>
          <button onClick={verify} disabled={verifying}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1B3D] px-3.5 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60"
            title="Reads Zoho sales orders, invoices and credit notes for the month (~4 minutes)">
            {verifying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {verifying ? "Reading Zoho…" : "Verify with Zoho"}
          </button>
        </div>
        {!stored ? (
          <div className="mt-6 flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : !v ? (
          <p className="mt-6 text-[13px] leading-relaxed text-slate-500">Compare {monthName(month)}&apos;s store sales with Zoho&apos;s sales orders, invoices and credit notes — every order missing in Zoho, Zoho sales with no order, exchanges, refunds and cancellations.</p>
        ) : (
          <ZohoSummary v={v} onOpen={() => setOpen(true)} />
        )}
      </div>

      <AnimatePresence>{open && v && <ZohoDrawer v={v} month={month} onClose={() => setOpen(false)} />}</AnimatePresence>
    </div>
  );
}

/* ── zoho summary & drawer ─────────────────────────────────────────────── */

const FLAG_META: Record<string, { label: string; hint: string }> = {
  not_in_zoho: { label: "Not in Zoho", hint: "Counted sale with no Zoho sales order or invoice" },
  zoho_without_order: { label: "Zoho sale with no order", hint: "Invoice whose order isn't a sale in the stores" },
  exchange_reinvoiced: { label: "Exchange invoiced twice", hint: "Item taken back on a zero credit note and the replacement invoiced again — Zoho counts the sale twice" },
  duplicate_invoice: { label: "Two invoices, no exchange", hint: "Probably a duplicate invoice" },
  amount_differs: { label: "Amount differs", hint: "One invoice, different total from the order" },
  cancelled_but_invoiced: { label: "Cancelled but invoiced", hint: "Cancelled in the store, invoice still live" },
  draft_invoice: { label: "Draft invoices", hint: "Not yet issued" },
};
const flagKey = (f: Flag) => (f.type === "amount_mismatch" ? f.reason : f.type);
const flagAmount = (f: Flag) => ("amountAed" in f ? f.amountAed : "zohoAed" in f ? f.zohoAed : 0);

function groupFlags(v: SalesVerification) {
  const g = new Map<string, Flag[]>();
  for (const f of v.flags) g.set(flagKey(f), [...(g.get(flagKey(f)) ?? []), f]);
  return Object.keys(FLAG_META).filter((k) => g.has(k)).map((k) => ({ key: k, flags: g.get(k)! }));
}

function ZohoSummary({ v, onOpen }: { v: SalesVerification; onOpen: () => void }) {
  const groups = groupFlags(v);
  const matchedShare = v.ours.orders ? v.matched / v.ours.orders : 0;
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11.5px] text-slate-500">Store sales</div>
          <div className="mt-0.5 text-[18px] tabular-nums text-slate-900">AED {compact(v.ours.salesAed)}</div>
          <div className="text-[11px] text-slate-400">{fmt(v.ours.orders)} orders</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11.5px] text-slate-500">Zoho invoiced</div>
          <div className="mt-0.5 text-[18px] tabular-nums text-slate-900">AED {compact(v.zoho.invoicedAed)}</div>
          <div className="text-[11px] text-slate-400">{fmt(v.zoho.invoices)} invoices · {v.differenceAed >= 0 ? "+" : "−"}{compact(Math.abs(v.differenceAed))}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-slate-600">
        <ShieldCheck size={14} className="text-emerald-600" /> {pct(matchedShare)} of orders found in Zoho
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[["Refunds", `${v.refunds.count}`, `AED ${compact(v.refunds.totalAed)}`], ["Exchanges", `${v.exchanges.count}`, "zero credit notes"], ["Cancelled", `${v.cancellations.count}`, `AED ${compact(v.cancellations.totalAed)}`]].map(([k, n, s]) => (
          <div key={k} className="rounded-2xl bg-slate-50 px-2 py-2.5">
            <div className="text-[18px] tabular-nums text-slate-900">{n}</div>
            <div className="text-[11px] text-slate-500">{k}</div>
            <div className="text-[10.5px] text-slate-400">{s}</div>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {groups.map(({ key, flags }) => (
          <li key={key} className="flex items-center justify-between gap-2 rounded-xl px-1 text-[12.5px]" title={FLAG_META[key].hint}>
            <span className="flex items-center gap-1.5 text-slate-700"><AlertTriangle size={12} className="text-amber-500" />{FLAG_META[key].label}</span>
            <span className="tabular-nums text-slate-500">{flags.length} · AED {compact(flags.reduce((s, f) => s + flagAmount(f), 0))}</span>
          </li>
        ))}
      </ul>
      <button onClick={onOpen} className="mt-auto pt-4 text-left text-[12.5px] font-medium text-[#1D4ED8] hover:underline">See every order →</button>
    </>
  );
}

type Tab = "flags" | "refunds" | "exchanges" | "cancellations";

function ZohoDrawer({ v, month, onClose }: { v: SalesVerification; month: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("flags");
  const groups = groupFlags(v);
  const rows: { cells: string[] }[] =
    tab === "flags" ? groups.flatMap(({ key, flags }) => flags.map((f) => ({
      cells: [FLAG_META[key].label, f.order || "—", "invoice" in f ? f.invoice : "", f.type === "amount_mismatch" ? `store ${fmt(f.orderAed, 2)} · Zoho ${fmt(f.zohoAed, 2)}` : fmt(flagAmount(f), 2), "day" in f ? f.day : "date" in f ? f.date : ""],
    })))
    : tab === "refunds" ? v.refunds.list.map((r) => ({ cells: [r.number, r.order || "—", r.customer, fmt(r.amountAed, 2), r.date] }))
    : tab === "exchanges" ? v.exchanges.list.map((r) => ({ cells: [r.number, r.order || "—", r.customer, "items back at 0", r.date] }))
    : v.cancellations.list.map((c) => ({ cells: [c.status, c.order, c.store, fmt(c.amountAed, 2), c.day] }));
  const head = tab === "flags" ? ["Issue", "Order", "Zoho", "AED", "Date"] : tab === "cancellations" ? ["Status", "Order", "Store", "AED", "Day"] : ["Credit note", "Order", "Customer", "AED", "Date"];

  const copy = async () => {
    const text = [head.join("\t"), ...rows.map((r) => r.cells.join("\t"))].join("\n");
    await navigator.clipboard.writeText(text).catch(() => {});
    toast.success("Copied — paste into a sheet or a message");
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex justify-end bg-[#0F1B3D]/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.3 }}
        onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl" role="dialog" aria-label="Zoho check details">
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-[18px] font-semibold text-slate-900">Zoho check · {monthName(month)}</h3>
            <p className="mt-1 text-[12.5px] text-slate-500">Store AED {fmt(v.ours.salesAed, 2)} · Zoho invoiced AED {fmt(v.zoho.invoicedAed, 2)} · refunds AED {fmt(v.refunds.totalAed, 2)} · Zoho net AED {fmt(v.zoho.netAed, 2)}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X size={16} /></button>
        </header>
        <div className="flex items-center gap-2 px-6 pt-4">
          {([["flags", `To fix (${v.flags.length})`], ["refunds", `Refunds (${v.refunds.count})`], ["exchanges", `Exchanges (${v.exchanges.count})`], ["cancellations", `Cancelled (${v.cancellations.count})`]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 text-[12.5px] ${tab === k ? "bg-[#0F1B3D] text-white" : "bg-slate-100 text-slate-700"}`}>{label}</button>
          ))}
          <button onClick={copy} className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-[#1D4ED8] hover:underline"><Copy size={12} /> Copy list</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-3">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>{head.map((h) => <th key={h} className="py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">{r.cells.map((c, j) => <td key={j} className={`py-2 pr-3 ${j === 3 ? "tabular-nums" : ""} text-slate-700`}>{c}</td>)}</tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="py-8 text-center text-slate-400">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </motion.aside>
    </motion.div>
  );
}
