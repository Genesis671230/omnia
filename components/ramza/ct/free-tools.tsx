"use client";

/* Free tax tools — four instant checks on one glassy band.
 *
 *   CT penalty    incorporation date + year end → registration deadline,
 *                 first return due, penalties to date (and the waiver window)
 *   CT relief     Small Business Relief / individual threshold / 0% band
 *   VAT           must you register, and what late registration costs
 *   E-invoicing   your phase, ASP appointment date, go-live
 *
 * Logic: lib/ramza/tax-tools.ts (every figure from config/rules.json).
 * Estimates from public rules — RAMZA can't see anyone's EmaraTax account,
 * isn't a tax agent, and says so under the results. */

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, FileCode2, Info, Landmark, Receipt, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { FILING_PARTNER } from "@/lib/ramza/rules";
import {
  TAX, checkCtFromIncorporation, checkCtRelief, checkEInvoicing, checkVat, fmtDay, type ToolLine,
} from "@/lib/ramza/tax-tools";
import { ct } from "./brand";
import { CtLeadForm } from "./lead-form";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

type ToolKey = "ct" | "relief" | "vat" | "einv";
const TOOLS: { k: ToolKey; label: string; icon: typeof Landmark; blurb: string }[] = [
  { k: "einv", label: "E-invoicing", icon: FileCode2, blurb: "ASP date + penalties" },
  { k: "ct", label: "CT penalty check", icon: ShieldAlert, blurb: "From your incorporation date" },
  { k: "relief", label: "Do I pay CT?", icon: Landmark, blurb: "Relief & exemption check" },
  { k: "vat", label: "VAT check", icon: Receipt, blurb: "Register or not" },
];

const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;

const TONE: Record<ToolLine["tone"], { icon: typeof Info; cls: string }> = {
  good: { icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-50" },
  warn: { icon: AlertTriangle, cls: "text-amber-600 bg-amber-50" },
  bad: { icon: ShieldAlert, cls: "text-rose-600 bg-rose-50" },
  info: { icon: Info, cls: "text-[#4F35E8] bg-[#F1EFEA]" },
};

function Lines({ lines }: { lines: ToolLine[] }) {
  return (
    <ul className="space-y-3">
      {lines.map((l, i) => {
        const T = TONE[l.tone];
        return (
          <motion.li key={l.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="flex gap-3">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${T.cls}`}><T.icon size={16} /></span>
            <div>
              <div className="text-[15px] font-medium text-[#14131C]">{l.title}</div>
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-[#55525E]">{l.detail}</p>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={ct.label}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-[#8E8B95]">{hint}</span>}
    </label>
  );
}

function Toggle({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-2xl bg-[#F1EFEA] p-1">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`flex-1 rounded-xl px-3 py-2 text-[13px] transition ${value === k ? "bg-white font-medium text-[#14131C] shadow-sm" : "text-[#55525E]"}`}>{l}</button>
      ))}
    </div>
  );
}

/* ── the four tools ────────────────────────────────────────────────────── */

function CtTool() {
  const today = dubaiToday();
  const [inc, setInc] = useState("");
  const [fy, setFy] = useState("12");
  const [reg, setReg] = useState("");
  const [filed, setFiled] = useState("");
  const r = useMemo(() => (inc ? checkCtFromIncorporation({ incorporated: inc, fyEndMonth: Number(fy), registeredOn: reg || null, firstReturnFiledOn: filed || null, today }) : null), [inc, fy, reg, filed, today]);
  return (
    <ToolLayout
      form={<>
        <Field label="Date of incorporation (or first licence)"><input type="date" max={today} value={inc} onChange={(e) => setInc(e.target.value)} className={ct.input} /></Field>
        <Field label="Financial year ends in">
          <select value={fy} onChange={(e) => setFy(e.target.value)} className={ct.input}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Registered for CT on" hint="Leave empty if not yet"><input type="date" max={today} value={reg} onChange={(e) => setReg(e.target.value)} className={ct.input} /></Field>
          <Field label="First return filed on" hint="Leave empty if not yet"><input type="date" max={today} value={filed} onChange={(e) => setFiled(e.target.value)} className={ct.input} /></Field>
        </div>
      </>}
      result={r && {
        big: r.estimatedAed ? aed(r.estimatedAed) : "AED 0",
        bigLabel: r.estimatedAed ? "Estimated penalties so far" : "No penalty so far",
        bad: r.estimatedAed > 0,
        chips: [`Register by ${fmtDay(r.registrationDue)}`, `First return due ${fmtDay(r.firstReturnDue)}`],
        lines: r.lines,
      }}
      empty="Add the date your company was incorporated — the deadlines and any penalty appear instantly."
      situation="missed_deadline"
      cta="Fix my CT position"
    />
  );
}

function ReliefTool() {
  const [kind, setKind] = useState<"company" | "free_zone" | "individual">("company");
  const [rev, setRev] = useState("");
  const [profit, setProfit] = useState("");
  const [period, setPeriod] = useState(`${new Date().getUTCFullYear()}-12-31`);
  const [qfzp, setQfzp] = useState(false);
  const [mne, setMne] = useState(false);
  const r = useMemo(() => (rev ? checkCtRelief({ kind, revenueAed: num(rev), periodEnd: period, qualifyingFreeZone: kind === "free_zone" && qfzp, mneGroup: mne, taxableProfitAed: profit ? num(profit) : null }) : null), [kind, rev, profit, period, qfzp, mne]);
  return (
    <ToolLayout
      form={<>
        <Toggle value={kind} onChange={(v) => setKind(v as typeof kind)} options={[["company", "Mainland company"], ["free_zone", "Free zone"], ["individual", "Individual / sole"]]} />
        <Field label={kind === "individual" ? "Business turnover this calendar year (AED)" : "Revenue for the tax period (AED)"}><input inputMode="decimal" value={rev} onChange={(e) => setRev(e.target.value)} className={ct.input} placeholder="e.g. 2,400,000" /></Field>
        {kind !== "individual" && <>
          <Field label="Tax period ends"><input type="date" value={period} onChange={(e) => setPeriod(e.target.value)} className={ct.input} /></Field>
          <Field label="Taxable profit (optional, AED)" hint="For an estimate of the tax"><input inputMode="decimal" value={profit} onChange={(e) => setProfit(e.target.value)} className={ct.input} placeholder="e.g. 600,000" /></Field>
          <div className="space-y-2 text-[13.5px] text-[#55525E]">
            {kind === "free_zone" && <label className="flex items-center gap-2"><input type="checkbox" checked={qfzp} onChange={(e) => setQfzp(e.target.checked)} /> We are a Qualifying Free Zone Person</label>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={mne} onChange={(e) => setMne(e.target.checked)} /> Part of a multinational group</label>
          </div>
        </>}
      </>}
      result={r && {
        big: r.verdict === "taxable" ? (r.estimatedCtAed != null ? aed(r.estimatedCtAed) : "9% band") : "AED 0",
        bigLabel: r.headline,
        bad: r.verdict === "taxable",
        chips: r.verdict === "sbr" ? [`Relief until periods ending ${fmtDay(TAX.sbrUntil)}`] : [],
        lines: r.lines,
      }}
      empty={`Add your revenue — we check Small Business Relief (up to ${aed(TAX.sbrRevenueAed)}), the individual threshold and the 0% band.`}
      situation="register_or_file"
      cta="Check it with an accountant"
    />
  );
}

function VatTool() {
  const today = dubaiToday();
  const [supplies, setSupplies] = useState("");
  const [registered, setRegistered] = useState("no");
  const [crossed, setCrossed] = useState("");
  const r = useMemo(() => (supplies ? checkVat({ suppliesLast12Aed: num(supplies), registered: registered === "yes", crossedOn: crossed || null, today }) : null), [supplies, registered, crossed, today]);
  return (
    <ToolLayout
      form={<>
        <Field label="Taxable sales + imports, last 12 months (AED)"><input inputMode="decimal" value={supplies} onChange={(e) => setSupplies(e.target.value)} className={ct.input} placeholder="e.g. 420,000" /></Field>
        <Field label="Registered for VAT?"><Toggle value={registered} onChange={setRegistered} options={[["no", "Not yet"], ["yes", "Yes"]]} /></Field>
        {registered === "no" && <Field label={`Month you crossed ${aed(TAX.vatMandatoryAed)} (if known)`}><input type="date" max={today} value={crossed} onChange={(e) => setCrossed(e.target.value)} className={ct.input} /></Field>}
      </>}
      result={r && {
        big: r.verdict === "mandatory" ? (registered === "yes" ? "Registered" : r.exposureAed ? aed(r.exposureAed) : "Register now") : r.verdict === "voluntary" ? "Optional" : "Not needed",
        bigLabel: r.verdict === "mandatory" ? (r.exposureAed ? "Late-registration penalty" : "VAT registration is mandatory") : r.verdict === "voluntary" ? "Voluntary registration" : "No VAT registration yet",
        bad: r.exposureAed > 0,
        chips: [`Mandatory above ${aed(TAX.vatMandatoryAed)}`, `Voluntary above ${aed(TAX.vatVoluntaryAed)}`],
        lines: r.lines,
      }}
      empty="Add your taxable sales for the last 12 months — we tell you whether VAT registration is due and what being late costs."
      situation="vat"
      cta="Get VAT sorted"
    />
  );
}

function EinvTool() {
  const today = dubaiToday();
  const [rev, setRev] = useState("");
  const [asp, setAsp] = useState("no");
  const [inv, setInv] = useState("");
  const r = useMemo(() => (rev ? checkEInvoicing(num(rev), today, { aspAppointed: asp === "yes", b2bInvoicesPerMonth: inv ? num(inv) : null }) : null), [rev, asp, inv, today]);
  return (
    <ToolLayout
      form={<>
        <Field label="Annual revenue (AED)" hint={`Large-business phase: revenue of ${aed(TAX.einvoicing.large.revenue_gte_aed)} or more`}><input inputMode="decimal" value={rev} onChange={(e) => setRev(e.target.value)} className={ct.input} placeholder="e.g. 60,000,000" /></Field>
        <Field label="Accredited Service Provider appointed?"><Toggle value={asp} onChange={setAsp} options={[["no", "Not yet"], ["yes", "Yes"]]} /></Field>
        <Field label="B2B / B2G invoices a month (optional)" hint="For the per-invoice penalty estimate"><input inputMode="numeric" value={inv} onChange={(e) => setInv(e.target.value)} className={ct.input} placeholder="e.g. 120" /></Field>
        <p className="text-[13px] leading-relaxed text-[#55525E]">B2B and B2G invoices move to structured e-invoices exchanged through Accredited Service Providers (ASPs). RAMZA prepares the data and connects you to an ASP — RAMZA isn&apos;t an ASP itself.</p>
      </>}
      result={r && {
        big: r.exposureAed > 0 ? aed(r.exposureAed) : asp === "yes" ? `${Math.max(r.daysToGoLive, 0)} days` : r.daysToAsp >= 0 ? `${r.daysToAsp} days` : "Overdue",
        bigLabel: r.exposureAed > 0 ? "Estimated e-invoicing penalties so far" : asp === "yes" ? `to go-live · ${fmtDay(r.goLive)}` : `to appoint an ASP · ${fmtDay(r.aspBy)}`,
        bad: r.exposureAed > 0 || (asp === "no" && r.daysToAsp < 60),
        chips: [r.phase === "large" ? "Phase 1 — large businesses" : "Phase 2 — everyone else", `Go-live ${fmtDay(r.goLive)}`, ...(r.monthlyRiskAed ? [`At risk: ${aed(r.monthlyRiskAed)}/month`] : [])],
        lines: r.lines,
      }}
      empty="Add your revenue — we show your phase, the date to appoint an ASP, when e-invoices go live and what missing it costs."
      situation="einvoicing"
      cta="Get e-invoicing ready"
    />
  );
}

/* ── shared layout: inputs | result + request ─────────────────────────── */

type Result = { big: string; bigLabel: string; bad: boolean; chips: string[]; lines: ToolLine[] } | null;

function ToolLayout({ form, result, empty, situation, cta }: { form: React.ReactNode; result: Result; empty: string; situation: string; cta: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-4">{form}</div>
      <div className="rounded-[26px] bg-white/80 p-6 shadow-[0_20px_50px_-30px_rgba(20,19,28,0.45)] ring-1 ring-white backdrop-blur-xl">
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
              
              <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-[#55525E]">{empty}</p>
            </motion.div>
          ) : asking ? (
            <motion.div key="ask" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className={ct.h3}>{cta}</h3>
                <button type="button" onClick={() => setAsking(false)} className="text-[13px] text-[#4F35E8] hover:underline">Back to result</button>
              </div>
              <CtLeadForm placement={`tool-${situation}`} cta={cta} initialSituation={situation} />
            </motion.div>
          ) : (
            <motion.div key={result.bigLabel + result.big} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <div className="text-[13px] text-[#55525E]">{result.bigLabel}</div>
              <div className={`mt-1 text-[40px] font-medium leading-none tracking-[-0.03em] ${result.bad ? "text-[#C2334D]" : "text-[#14131C]"}`}>{result.big}</div>
              {!!result.chips.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {result.chips.map((c) => <span key={c} className="rounded-full bg-[#F1EFEA] px-2.5 py-1 text-[12px] font-medium text-[#4F35E8]">{c}</span>)}
                </div>
              )}
              <div className="mt-5"><Lines lines={result.lines} /></div>
              <button type="button" onClick={() => setAsking(true)} className={`${ct.btnPrimary} mt-6 w-full`}>{cta} <ArrowRight size={16} /></button>
              <p className="mt-3 text-[11.5px] leading-relaxed text-[#8E8B95]">
                An estimate from the published rules — we can&apos;t see your EmaraTax account. RAMZA isn&apos;t a registered tax agent; returns are filed by our licensed partner, {FILING_PARTNER}.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function FreeToolsSection() {
  const [tool, setTool] = useState<ToolKey>("einv");
  return (
    <section id="free-tools" className="relative scroll-mt-24 overflow-x-clip pb-24 pt-24 text-[#14131C]">
      <TrackView section="free-tools" className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrow}>Free tools · instant answers</span>
          <h2 className={`${ct.h2} mt-4`}>Check your e-invoicing and tax position in 30 seconds</h2>
          <p className={`${ct.lead} mt-4`}>Your e-invoicing date and penalty exposure, Corporate Tax penalties from your incorporation date, relief and VAT registration — no sign-up.</p>
        </Reveal>

        <Reveal delay={0.05} className="mt-10 rounded-[32px] bg-white/60 p-3 shadow-[0_40px_90px_-50px_rgba(20,19,28,0.5)] ring-1 ring-white backdrop-blur-2xl sm:p-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {TOOLS.map((t) => {
              const on = tool === t.k;
              return (
                <button key={t.k} type="button" onClick={() => setTool(t.k)} aria-pressed={on}
                  className={`relative flex items-center gap-3 rounded-[22px] px-4 py-3.5 text-left transition ${on ? "text-white" : "text-[#14131C] hover:bg-white/70"}`}>
                  {on && <motion.span layoutId="tool-pill" className="absolute inset-0 rounded-[22px] bg-[#14131C]" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                  
                  <span className="relative min-w-0">
                    <span className="block text-[14.5px] font-medium">{t.label}</span>
                    <span className={`block truncate text-[12px] ${on ? "text-white/75" : "text-[#8E8B95]"}`}>{t.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="px-2 pb-4 pt-6 sm:px-5">
            <AnimatePresence mode="wait">
              <motion.div key={tool} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
                {tool === "ct" ? <CtTool /> : tool === "relief" ? <ReliefTool /> : tool === "vat" ? <VatTool /> : <EinvTool />}
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
        <p className="mx-auto mt-5 max-w-2xl text-center text-[12px] text-[#8E8B95]">
          Rules as published by the UAE Ministry of Finance and the Federal Tax Authority; updated when they change.
        </p>
      </TrackView>
    </section>
  );
}
