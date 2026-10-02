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
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Download, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Flag, SalesVerification } from "@/lib/finance/zoho-sales-verify";
import type { ManagementReport } from "@/lib/reports/management-report";
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
  const [mr, setMr] = useState<ManagementReport | null>(null);
  const [mrError, setMrError] = useState("");
  const [stored, setStored] = useState<Stored | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [open, setOpen] = useState(false);
  const thisMonth = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);

  const load = useCallback(async () => {
    setMr(null);
    setMrError("");
    setStored(null);
    const [report, zv] = await Promise.all([
      fetch(`/api/reports/management?month=${month}`, { cache: "no-store" }).then((r) => r.json()).catch((e) => ({ error: (e as Error).message })),
      fetch(`/api/finance/zoho-sales-verify?month=${month}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (report?.error) setMrError(report.error); else setMr(report);
    setStored(zv && !zv.error ? zv : { verification: null, checkedAt: null });
  }, [month]);
  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      {/* ── sales report (management definitions) ── */}
      <div className={`${DARK_CARD} px-7 pb-6 pt-6 xl:col-span-8`}>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_0%,rgba(59,91,253,0.5),transparent_60%),radial-gradient(50%_70%_at_0%_100%,rgba(16,185,129,0.22),transparent_60%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[26px] font-light tracking-[-0.02em]">Sales report</h3>
            <p className="mt-1 text-[12.5px] text-white/50">Refunds against the order&apos;s month · refund = money the gateway returned · exchanges aren&apos;t sales · {monthName(month)}</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={`/api/reports/management?month=${month}&format=xlsx`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[#13111D] hover:bg-white/90">
              <Download size={13} /> Management report
            </a>
            <div className="flex items-center gap-1 rounded-full bg-white/10 p-1">
              <button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><ChevronLeft size={15} /></button>
              <span className="px-2 text-[12.5px]">{monthName(month)}</span>
              <button aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30"><ChevronRight size={15} /></button>
            </div>
          </div>
        </div>

        {mrError ? (
          <div className="relative mt-8 text-[13px] text-rose-200">{mrError}</div>
        ) : !mr ? (
          <div className="relative mt-10 flex items-center gap-2 text-[13px] text-white/50"><Loader2 size={14} className="animate-spin" /> Building the month — orders, refunds, exchanges, receivables…</div>
        ) : (
          <MgmtBody r={mr} />
        )}
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

      {mr && <MgmtGateways r={mr} />}

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

/* ── management body: waterfall, cash, refunds, exchanges ─────────────── */

function MgmtBody({ r }: { r: ManagementReport }) {
  const w = r.waterfall;
  const steps = [
    { k: "Orders placed", v: w.placed.aed, n: w.placed.orders, sign: "" },
    { k: "Failed / unpaid", v: w.failedUnpaid.aed, n: w.failedUnpaid.orders, sign: "−" },
    { k: `Cancelled${w.cancelled.bySheetOnly ? ` (${w.cancelled.bySheetOnly} only in sheet)` : ""}`, v: w.cancelled.aed, n: w.cancelled.orders, sign: "−" },
    { k: "Gross sales", v: w.grossSales.aed, n: w.grossSales.orders, sign: "=", strong: true },
    { k: "Refunds", v: w.refunds.aed, n: w.refunds.orders, sign: "−" },
    { k: "Net sales", v: w.netSales.aed, n: w.netSales.orders, sign: "=", strong: true },
  ];
  const max = w.placed.aed || 1;
  const recvShare = w.netSales.aed ? r.cash.receivedAed / w.netSales.aed : 0;
  return (
    <div className="relative mt-5 space-y-6">
      <p className="text-[12px] text-white/55">
        Dashboard {fmt(r.fromDashboard.dashboard.aed, 2)} − cancelled in the sheet only {fmt(r.fromDashboard.sheetCancelled.aed, 2)} + refunded in the store {fmt(r.fromDashboard.refundedInStore.aed, 2)} = gross sales <b className="text-white">{fmt(r.fromDashboard.grossSales.aed, 2)}</b>
      </p>
      <div className="grid gap-6 md:grid-cols-[1.15fr_1fr]">
        <ul className="space-y-2">
          {steps.map((st, i) => (
            <li key={st.k}>
              <div className={`flex justify-between text-[12.5px] ${st.strong ? "font-medium text-white" : "text-white/70"}`}>
                <span>{st.sign} {st.k} <span className="text-white/40">· {fmt(st.n)}</span></span>
                <span className="tabular-nums">AED {compact(st.v)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full" style={{ background: st.sign === "−" ? "#F2705E" : st.strong ? "linear-gradient(90deg,#8B9CFF,#10B981)" : "#8B9CFF" }}
                  initial={{ width: 0 }} animate={{ width: `${(st.v / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.06 }} />
              </div>
            </li>
          ))}
        </ul>
        <div>
          <div className="text-[13px] text-white/55">Received in the bank</div>
          <div className="mt-1 text-[34px] font-light leading-none tabular-nums tracking-[-0.03em]">AED {compact(r.cash.receivedAed)}</div>
          <div className="mt-1 text-[12px] text-white/50" title={`Net sales = received ${fmt(r.cash.tie.receivedAed, 2)} + fees ${fmt(r.cash.tie.feesOnReceivedAed, 2)} + FX/other ${fmt(r.cash.tie.fxOtherAed, 2)} − refunds on received ${fmt(r.cash.tie.refundsOnReceivedAed, 2)} + receivable ${fmt(r.cash.tie.receivableAed, 2)}`}>
            {pct(recvShare)} of net sales · fees AED {compact(r.cash.tie.feesOnReceivedAed)} · refunds returned AED {compact(r.cash.tie.refundsOnReceivedAed)}
          </div>
          <div className="mt-4 text-[13px] text-white/55">Receivable — still to come in</div>
          <div className="mt-1 text-[24px] font-light tabular-nums">AED {compact(r.cash.receivableAed)}</div>
          <ul className="mt-2 space-y-1 text-[12px]">
            {r.cash.receivableByBucket.map((b) => (
              <li key={b.bucket} className="flex justify-between gap-2 text-white/70">
                <span className="truncate">{b.label} · {b.orders}</span>
                <span className="shrink-0 tabular-nums">{compact(b.aed)}{b.oldestDays > 14 ? <span className="ml-1 text-amber-300">· {b.oldestDays}d</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { k: "Refunds by payout month", v: r.refundsByPaidMonth.filter((p) => p.month !== "unknown").map((p) => `${p.month.slice(5)}: ${compact(p.aed)}`).join(" · ") || "—" },
          { k: `All refunds paid in ${r.month.slice(5)}`, v: `AED ${compact(r.refundsPaidThisMonth.aed)}`, s: `${r.refundsPaidThisMonth.ofEarlierMonths} for earlier months' orders` },
          { k: "Exchanges (not sales)", v: `${fmt(r.exchanges.orders)} orders`, s: `extra collected AED ${compact(r.exchanges.extraCollectedAed)}` },
          { k: "Exchanges re-invoiced in Zoho", v: fmt(r.exchanges.reinvoicedInZoho), s: "sale counted twice in Zoho" },
        ].map((t) => (
          <div key={t.k} className="rounded-2xl bg-white/[0.06] px-3.5 py-3">
            <div className="text-[11px] text-white/50">{t.k}</div>
            <div className="mt-1 text-[14px] tabular-nums">{t.v}</div>
            {t.s && <div className="text-[10.5px] text-white/40">{t.s}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MgmtGateways({ r }: { r: ManagementReport }) {
  return (
    <div className="rounded-[30px] bg-white px-6 pb-5 pt-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(15,23,42,0.22)] xl:col-span-12">
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="overflow-x-auto">
          <h3 className="text-[20px] font-light tracking-[-0.02em] text-slate-900">By gateway</h3>
          <table className="mt-3 w-full min-w-[720px] text-[12.5px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-slate-400">
              <tr>{["Gateway", "Sales", "Gross", "Cancelled", "Refunds", "Refund %", "Exch.", "Net", "Received", "Receivable"].map((h, i) => <th key={h} className={`pb-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {r.byGateway.map((g) => (
                <tr key={g.gateway} className="border-t border-slate-100 tabular-nums">
                  <td className="py-1.5 text-slate-800">{g.gateway}</td>
                  <td className="py-1.5 text-right">{fmt(g.orders)}</td>
                  <td className="py-1.5 text-right">{compact(g.grossAed)}</td>
                  <td className="py-1.5 text-right text-slate-500">{g.cancelled.orders ? `${g.cancelled.orders} · ${compact(g.cancelled.aed)}` : "—"}</td>
                  <td className="py-1.5 text-right text-rose-600">{g.refunds.orders ? `${g.refunds.orders} · ${compact(g.refunds.aed)}` : "—"}</td>
                  <td className="py-1.5 text-right text-slate-500">{g.refundRatePct == null ? "—" : `${g.refundRatePct}%`}</td>
                  <td className="py-1.5 text-right text-slate-500">{g.exchanges || "—"}</td>
                  <td className="py-1.5 text-right font-medium text-slate-900">{compact(g.netSalesAed)}</td>
                  <td className="py-1.5 text-right">{compact(g.receivedAed)}</td>
                  <td className="py-1.5 text-right text-amber-700">{g.receivableAed ? compact(g.receivableAed) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="text-[20px] font-light tracking-[-0.02em] text-slate-900">To fix before reporting</h3>
          <ul className="mt-3 space-y-1.5">
            {r.issues.map((i) => (
              <li key={i.key} className="flex items-start justify-between gap-3 text-[12.5px]" title={i.orders.slice(0, 30).join(", ")}>
                <span className="flex items-start gap-1.5 text-slate-700"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />{i.label}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{i.orders.length}</span>
              </li>
            ))}
            {!r.issues.length && <li className="text-[12.5px] text-slate-500">Nothing to fix.</li>}
          </ul>
          <p className="mt-3 text-[11.5px] text-slate-400">Every order behind these is in the Management report download (&ldquo;Issues to fix&rdquo;).</p>
        </div>
      </div>
    </div>
  );
}
