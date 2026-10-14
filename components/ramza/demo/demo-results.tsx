"use client";

/* What the run found: headline tiles, then tabs — invoices cleared, payouts
 * vs bank (with the exchange difference), the journal RAMZA would post, bank
 * lines in the chart of accounts, and what each gateway really costs. Ends
 * with "Email me the full report" (the lead form) and a CSV download. */

import { motion } from "framer-motion";
import { useState } from "react";
import type { RunResult } from "@/lib/ramza/demo/run";
import { INDUSTRY_LABEL, type Industry } from "@/lib/ramza/demo/coa";
import { toCsv } from "@/lib/ramza/demo/csv";
import { funnel, anonId } from "@/lib/ramza/funnel";
import { track } from "@/lib/ramza/track";
import { getAttribution } from "@/lib/ramza/attribution";

const a2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const a0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

type Tab = "invoices" | "bank" | "journal" | "accounts" | "gateways";
const STATUS: Record<string, { label: string; cls: string }> = {
  matched: { label: "Cleared", cls: "bg-[#E6F6EE] text-[#147A4B]" },
  retention: { label: "Cleared · retention held", cls: "bg-[#E6F6EE] text-[#147A4B]" },
  short_paid: { label: "Short-paid", cls: "bg-[#FFF4DB] text-[#9A6A00]" },
  unmatched_payout: { label: "No invoice", cls: "bg-[#FFF4DB] text-[#9A6A00]" },
  unpaid_invoice: { label: "Unpaid", cls: "bg-[#FDECEF] text-[#B4233F]" },
  refund: { label: "Refund", cls: "bg-[#EFECFF] text-[#4F35E8]" },
};

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function DemoResults({ result, industry, onReset }: { result: RunResult; industry: Industry; onReset: () => void }) {
  const s = result.recon?.summary;
  const tabs: { k: Tab; label: string; show: boolean }[] = [
    { k: "invoices", label: "Invoices cleared", show: Boolean(result.recon) },
    { k: "bank", label: "Payouts → bank", show: Boolean(result.recon?.payouts.length) },
    { k: "journal", label: "Journal entries", show: Boolean(result.recon?.journal.length) },
    { k: "accounts", label: "Chart of accounts", show: Boolean(result.expenses) },
    { k: "gateways", label: "Gateway costs", show: Boolean(result.recon?.gateways.length) },
  ];
  const [tab, setTab] = useState<Tab>(tabs.find((t) => t.show)?.k ?? "invoices");
  const pick = (t: Tab) => { setTab(t); funnel("result_tab", { tab: t }); };

  const tiles = [
    s && { k: "Invoices cleared", v: `${s.cleared}/${s.invoices}`, sub: `${Math.round(s.matchRate * 100)}% automatically${s.unpaid ? ` · ${s.unpaid} unpaid` : ""}`, accent: true },
    s && { k: "Gross collected", v: `AED ${a0(s.grossAed)}`, sub: `${s.payouts} payouts · ${s.currencies.join(", ")}` },
    s && { k: "Fees + VAT on fees", v: `AED ${a0(s.feeAed + s.vatAed)}`, sub: `VAT AED ${a2(s.vatAed)} recoverable` },
    s && { k: "Into the bank", v: `AED ${a0(s.bankAed || s.netAed)}`, sub: s.fxAed ? `FX difference AED ${a2(s.fxAed)}` : `${s.bankMatched}/${s.payouts} payouts matched` },
    result.expenses && { k: "Bank lines sorted", v: `${result.expenses.lines.length}`, sub: `${Math.round(result.expenses.autoRate * 100)}% into ${result.customChart ? "your" : "the"} chart automatically` },
    { k: "Time saved", v: `~${Math.max(1, Math.round(result.report.minutesSaved / 60))} h`, sub: "of spreadsheet matching" },
  ].filter(Boolean) as { k: string; v: string; sub: string; accent?: boolean }[];

  return (
    <div className="space-y-5">
      {result.notes.map((n) => <div key={n} className="rounded-2xl bg-[#FFF4DB] px-4 py-3 text-[14px] text-[#7A5600]">{n}</div>)}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t, i) => (
          <motion.div key={t.k} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className={`rounded-[22px] p-4 ${t.accent ? "bg-[#0B1533] text-white" : "bg-white ring-1 ring-[#E3E7F0]"}`}>
            <div className={`text-[11.5px] font-medium uppercase tracking-[0.12em] ${t.accent ? "text-[#CBC3FF]" : "text-[#8A8792]"}`}>{t.k}</div>
            <div className="mt-1.5 font-[family-name:var(--font-display)] text-[24px] font-semibold tabular-nums tracking-[-0.02em]">{t.v}</div>
            <div className={`mt-0.5 text-[12px] ${t.accent ? "text-white/60" : "text-[#8A8792]"}`}>{t.sub}</div>
          </motion.div>
        ))}
      </div>

      <div className="rounded-[28px] bg-white ring-1 ring-[#E3E7F0]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEDE8] px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap gap-1">
            {tabs.filter((t) => t.show).map((t) => (
              <button key={t.k} onClick={() => pick(t.k)} className={`-mb-px border-b-2 px-3 pb-3 text-[14px] font-medium transition ${tab === t.k ? "border-[#4F35E8] text-[#14131C]" : "border-transparent text-[#8A8792] hover:text-[#14131C]"}`}>{t.label}</button>
            ))}
          </div>
          <div className="flex gap-2 pb-3">
            {result.recon && (
              <button onClick={() => { funnel("csv_download", { tab }); download(`ramza-reconciliation-${industry}.csv`, toCsv(["Ref", "Gateway", "Date", "Currency", "Status", "Invoice", "Invoice AED", "Gross AED", "Fee AED", "VAT AED", "Net AED", "Difference AED"], result.recon!.rows.map((r) => [r.ref, r.gateway, r.date, r.currency, STATUS[r.status]?.label ?? r.status, r.invoice?.number ?? "", r.invoiceAed, r.grossAed, r.feeAed, r.vatAed, r.netAed, r.diffAed]))); }}
                className="h-9 rounded-full px-3.5 text-[13px] font-medium text-[#14131C] ring-1 ring-[#D3D9E6] hover:bg-[#EEF1F7]">Download CSV</button>
            )}
            <button onClick={onReset} className="h-9 rounded-full px-3.5 text-[13px] font-medium text-[#55525E] hover:text-[#14131C]">Try another</button>
          </div>
        </div>
        <div className="max-h-[460px] overflow-auto px-2 pb-2 sm:px-4">
          {tab === "invoices" && result.recon && <InvoicesTab result={result} />}
          {tab === "bank" && result.recon && <BankTab result={result} />}
          {tab === "journal" && result.recon && <JournalTab result={result} />}
          {tab === "accounts" && result.expenses && <AccountsTab result={result} />}
          {tab === "gateways" && result.recon && <GatewaysTab result={result} />}
        </div>
      </div>

      <ReportForm result={result} industry={industry} />
    </div>
  );
}

const th = "sticky top-0 z-[1] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-[#8A8792]";
const td = "px-3 py-2.5 text-[13.5px] text-[#14131C] border-t border-[#F3F1EC]";
const tdr = `${td} text-right tabular-nums`;

function InvoicesTab({ result }: { result: RunResult }) {
  const rows = [...result.recon!.rows].sort((a, b) => (a.status === "matched" ? 1 : 0) - (b.status === "matched" ? 1 : 0) || a.date.localeCompare(b.date));
  return (
    <table className="w-full min-w-[720px] border-collapse">
      <thead><tr><th className={th}>Ref</th><th className={th}>Gateway</th><th className={th}>Status</th><th className={`${th} text-right`}>Invoice</th><th className={`${th} text-right`}>Collected</th><th className={`${th} text-right`}>Fee</th><th className={`${th} text-right`}>VAT</th><th className={`${th} text-right`}>Net</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.ref}-${i}`}>
            <td className={td}><b className="font-medium">{r.ref}</b><div className="text-[11.5px] text-[#8A8792]">{r.date}{r.invoice?.customer ? ` · ${r.invoice.customer}` : ""}</div></td>
            <td className={td}>{r.gateway}{r.currency !== "AED" && <span className="ml-1 rounded bg-[#EEF1F7] px-1.5 py-0.5 text-[11px]">{r.currency}</span>}</td>
            <td className={td}><span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>{r.status === "short_paid" || r.status === "retention" ? <div className="mt-0.5 text-[11.5px] text-[#8A8792]">AED {a2(r.diffAed)} {r.status === "retention" ? "held back" : "short"}</div> : null}</td>
            <td className={tdr}>{r.invoiceAed ? a2(r.invoiceAed) : "—"}</td>
            <td className={tdr}>{r.grossAed ? a2(r.grossAed) : "—"}</td>
            <td className={tdr}>{r.feeAed ? a2(r.feeAed) : "—"}</td>
            <td className={tdr}>{r.vatAed ? a2(r.vatAed) : "—"}</td>
            <td className={`${tdr} font-medium`}>{r.netAed ? a2(r.netAed) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BankTab({ result }: { result: RunResult }) {
  return (
    <table className="w-full min-w-[720px] border-collapse">
      <thead><tr><th className={th}>Payout</th><th className={th}>Lines</th><th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Fees + VAT</th><th className={`${th} text-right`}>Payout net</th><th className={th}>Bank credit</th><th className={`${th} text-right`}>FX</th></tr></thead>
      <tbody>
        {result.recon!.payouts.map((p) => (
          <tr key={p.payoutId}>
            <td className={td}><b className="font-medium">{p.gateway}</b><div className="text-[11.5px] text-[#8A8792]">{p.payoutId}{p.currency !== "AED" ? ` · paid in ${p.currency}` : ""}</div></td>
            <td className={td}>{p.lines}</td>
            <td className={tdr}>{a2(p.grossAed)}</td>
            <td className={tdr}>{a2(p.feeAed + p.vatAed)}</td>
            <td className={tdr}>{a2(p.netAed)}</td>
            <td className={td}>{p.bank ? <><span className="text-[#147A4B]">✓</span> {p.bank.date} · AED {a2(p.bank.amount)}<div className="truncate text-[11.5px] text-[#8A8792]">{p.bank.description}</div></> : <span className="text-[#B4233F]">not in the bank yet</span>}</td>
            <td className={tdr}>{p.fxAed ? a2(p.fxAed) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JournalTab({ result }: { result: RunResult }) {
  const lines = result.recon!.journal.slice(0, 60);
  const refs = [...new Set(lines.map((l) => l.ref))];
  return (
    <div className="space-y-3 py-3">
      <p className="px-2 text-[13px] text-[#8A8792]">What RAMZA posts to Zoho Books, Xero or QuickBooks for each payout — fees and VAT on their own lines, the exchange difference booked, the clearing account emptied.</p>
      {refs.slice(0, 8).map((ref) => (
        <div key={ref} className="overflow-hidden rounded-2xl ring-1 ring-[#EFEDE8]">
          <table className="w-full border-collapse">
            <tbody>
              {lines.filter((l) => l.ref === ref).map((l, i) => (
                <tr key={i}>
                  <td className={`${td} ${l.credit ? "pl-8" : ""}`}>{l.account}<div className="text-[11.5px] text-[#8A8792]">{i === 0 ? `${l.date} · ${l.memo}` : l.memo !== lines.find((x) => x.ref === ref)?.memo ? l.memo : ""}</div></td>
                  <td className={`${tdr} w-32`}>{l.debit ? a2(l.debit) : ""}</td>
                  <td className={`${tdr} w-32`}>{l.credit ? a2(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {refs.length > 8 && <p className="px-2 text-[12.5px] text-[#8A8792]">…and {refs.length - 8} more payouts in the full report.</p>}
    </div>
  );
}

function AccountsTab({ result }: { result: RunResult }) {
  const e = result.expenses!;
  return (
    <div className="grid gap-4 py-3 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-1.5 px-2">
        {e.byAccount.slice(0, 12).map((a) => {
          const max = Math.max(...e.byAccount.map((x) => Math.abs(x.total)));
          return (
            <div key={a.account.code}>
              <div className="flex justify-between text-[13px]"><span><span className="text-[#A19EA6]">{a.account.code}</span> {a.account.name}</span><span className="tabular-nums">{a2(a.total)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-[#EEF1F7]"><motion.div initial={{ width: 0 }} animate={{ width: `${(Math.abs(a.total) / max) * 100}%` }} className={`h-full rounded-full ${a.total < 0 ? "bg-[#0B1533]" : "bg-[#4F35E8]"}`} /></div>
            </div>
          );
        })}
      </div>
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Bank line</th><th className={th}>Account</th><th className={`${th} text-right`}>Amount</th></tr></thead>
        <tbody>
          {e.lines.slice(0, 40).map((l, i) => (
            <tr key={i}>
              <td className={td}><span className="line-clamp-1">{l.description}</span><div className="text-[11.5px] text-[#8A8792]">{l.date}</div></td>
              <td className={td}>{l.account.name}{l.vatAed ? <div className="text-[11.5px] text-[#8A8792]">VAT AED {a2(l.vatAed)} recoverable</div> : null}{l.confidence === "fallback" && <div className="text-[11.5px] text-[#9A6A00]">check</div>}</td>
              <td className={tdr}>{a2(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GatewaysTab({ result }: { result: RunResult }) {
  const g = result.recon!.gateways;
  const max = Math.max(...g.map((x) => x.effectiveRate), 0.0001);
  return (
    <div className="space-y-4 px-2 py-4">
      <p className="text-[13px] text-[#8A8792]">The real cost of each way you get paid — fees plus VAT on fees, as a share of what was collected.</p>
      {g.map((x, i) => (
        <div key={x.gateway} className="grid grid-cols-[150px_1fr_auto] items-center gap-4">
          <div className="text-[14px] font-medium">{x.gateway}<div className="text-[11.5px] font-normal text-[#8A8792]">AED {a0(x.grossAed)} · {x.lines} lines</div></div>
          <div className="h-3 rounded-full bg-[#EEF1F7]"><motion.div initial={{ width: 0 }} animate={{ width: `${(x.effectiveRate / max) * 100}%` }} transition={{ delay: i * 0.08, duration: 0.6 }} className="h-full rounded-full bg-[#4F35E8]" /></div>
          <div className="w-24 text-right text-[15px] font-semibold tabular-nums">{(x.effectiveRate * 100).toFixed(2)}%<div className="text-[11.5px] font-normal text-[#8A8792]">AED {a0(x.feeAed + x.vatAed)}</div></div>
        </div>
      ))}
    </div>
  );
}

/* ── "Email me the full report" ── */

function ReportForm({ result, industry }: { result: RunResult; industry: Industry }) {
  const [f, setF] = useState({ name: "", email: "", whatsapp: "", company: "", company_website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [emailed, setEmailed] = useState(false);
  const [opened, setOpened] = useState(false);
  const touch = () => { if (!opened) { setOpened(true); funnel("report_open", { industry, source: result.source }); } };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setErrors({});
    const eventId = crypto.randomUUID();
    try {
      const res = await fetch("/api/lead/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, industry, summary: result.report, anonId: anonId(), attribution: getAttribution(), eventId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErrors(j.errors ?? { form: j.error ?? "Something went wrong — message us on WhatsApp." }); setState("idle"); return; }
      setEmailed(Boolean(j.emailed));
      setState("sent");
      track("Lead", { eventId, content_name: "demo_report", industry });
      funnel("lead", { industry, source: result.source, emailed: Boolean(j.emailed) });
    } catch {
      setErrors({ form: "Network error — try again or message us on WhatsApp." });
      setState("idle");
    }
  };

  const input = "h-12 w-full rounded-2xl border border-[#DDE2EC] bg-white px-4 text-[15px] text-[#14131C] placeholder:text-[#A19EA6] focus:border-[#14131C] focus:outline-none focus:ring-4 focus:ring-[#14131C]/10";
  return (
    <div className="overflow-hidden rounded-[30px] bg-[#0B1533] text-white">
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]">Your full report</div>
          <h3 className="mt-2 font-[family-name:var(--font-display)] text-[28px] font-semibold leading-tight tracking-[-0.02em]">Get every match, fee and journal entry in your inbox.</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-[#B8B6C0]">
            {result.source === "upload" ? "We email the numbers from this run — never your file." : `The ${INDUSTRY_LABEL[industry].toLowerCase()} demo, written up.`} Then, if you want it every day, RAMZA runs this on your live gateways and books — with a WhatsApp note when each payout lands.
          </p>
        </div>
        {state === "sent" ? (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-[24px] bg-white/[0.06] p-6 ring-1 ring-white/10">
            <div className="text-[20px] font-semibold">{emailed ? "Sent — check your inbox ✓" : "Got it ✓"}</div>
            <p className="mt-2 text-[14.5px] text-[#B8B6C0]">{emailed ? `Your report is on its way to ${f.email}. ` : "Our team will send your report shortly. "}An accountant will look at it and message you{f.whatsapp ? " on WhatsApp" : ""} with what we&apos;d set up first.</p>
          </motion.div>
        ) : (
          <form onSubmit={submit} onFocus={touch} className="grid gap-3 sm:grid-cols-2">
            <div><input className={input} placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />{errors.name && <p className="mt-1 text-[12.5px] text-[#FCA5B5]">{errors.name}</p>}</div>
            <div><input className={input} placeholder="Work email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />{errors.email && <p className="mt-1 text-[12.5px] text-[#FCA5B5]">{errors.email}</p>}</div>
            <div><input className={input} placeholder="WhatsApp (optional)" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} autoComplete="tel" />{errors.whatsapp && <p className="mt-1 text-[12.5px] text-[#FCA5B5]">{errors.whatsapp}</p>}</div>
            <div><input className={input} placeholder="Company (optional)" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" /></div>
            <input tabIndex={-1} aria-hidden className="hidden" value={f.company_website} onChange={(e) => setF({ ...f, company_website: e.target.value })} />
            <button disabled={state === "sending"} className="h-12 rounded-full bg-[#4F35E8] text-[15px] font-medium text-white transition hover:bg-[#5C44F0] disabled:opacity-60 sm:col-span-2">{state === "sending" ? "Sending…" : "Email me the full report"}</button>
            {errors.form && <p className="text-[13px] text-[#FCA5B5] sm:col-span-2">{errors.form}</p>}
            <p className="text-[11.5px] text-white/45 sm:col-span-2">No spam — one report, then a human follows up. RAMZA is not a registered tax agent; filings go through a licensed partner.</p>
          </form>
        )}
      </div>
    </div>
  );
}
