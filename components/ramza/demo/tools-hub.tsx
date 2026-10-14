"use client";

/* Free tools — each one a working piece of RAMZA, on the visitor's
 * industry demo data or their own CSV, all in the browser:
 *   payouts → invoices (Stripe / Shopify Payments / BNPL), bank reconciliation,
 *   expenses → chart of accounts, chart-of-accounts builder, payroll &
 *   gratuity (WPS), e-invoice readiness. */

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { chartFor, INDUSTRY_LABEL, type Account } from "@/lib/ramza/demo/coa";
import { parseCsv, toCsv } from "@/lib/ramza/demo/csv";
import { categoriseBank, demoDataset, einvoiceReadiness, loadTable, payroll, reconcile, type Employee, type Invoice, type Loaded } from "@/lib/ramza/demo/engine";
import { funnel } from "@/lib/ramza/funnel";
import { useIndustry, IndustryChips } from "./industry";

const TOOLS = [
  { k: "payouts", t: "Payouts → invoices", d: "Stripe, Shopify Payments, Tabby, Tamara: which invoices each payout cleared, and what it cost." },
  { k: "bank", t: "Bank reconciliation", d: "Every credit on the statement tied to its payout — the gap is your FX and bank charges." },
  { k: "expenses", t: "Expenses → accounts", d: "Bank lines sorted into your chart of accounts, recoverable VAT flagged." },
  { k: "coa", t: "Chart of accounts", d: "A UAE-ready chart for your industry — download it for Zoho, Xero or QuickBooks." },
  { k: "payroll", t: "Payroll & gratuity", d: "Monthly payroll, end-of-service gratuity and the monthly provision, per UAE labour law." },
  { k: "einvoice", t: "E-invoice readiness", d: "Do your invoices carry the fields e-invoicing needs? Score and gaps, per field." },
] as const;
type ToolKey = (typeof TOOLS)[number]["k"];

const a2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const a0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function ToolsHub() {
  const { industry } = useIndustry();
  const [tool, setTool] = useState<ToolKey>("payouts");
  const [own, setOwn] = useState<Loaded | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (k: ToolKey) => { setTool(k); setOwn(null); funnel("tool_use", { tool: k, industry, action: "open" }); };

  const ds = useMemo(() => demoDataset(industry), [industry]);
  const upload = async (f: File) => {
    const text = /\.(xlsx|xls)$/i.test(f.name)
      ? await import("xlsx").then(async (X) => { const wb = X.read(await f.arrayBuffer(), { type: "array" }); return X.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); })
      : await f.text();
    const l = loadTable(f.name, parseCsv(text), industry);
    setOwn(l);
    funnel("tool_use", { tool, industry, action: "upload", kind: l.kind, rows: l.rows });
  };

  return (
    <section id="tools" className="relative py-20 sm:py-28">
      <div className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <div className="mx-auto max-w-[760px] text-center">
          <div className="inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#4F35E8]">Free tools</div>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-[#14131C] sm:text-[44px]">Try every part of RAMZA on your own numbers.</h2>
          <p className="mx-auto mt-4 max-w-[600px] text-[17px] leading-relaxed text-[#55525E]">Demo data for your industry is loaded — or drop your own CSV into any tool. Nothing is uploaded.</p>
          <IndustryChips className="mt-6" from="tools" />
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {TOOLS.map((t) => (
              <button key={t.k} onClick={() => pick(t.k)} className={`min-w-[220px] rounded-[20px] p-4 text-left transition lg:min-w-0 ${tool === t.k ? "bg-[#0B1533] text-white" : "bg-white ring-1 ring-[#E3E7F0] hover:ring-[#14131C]/25"}`}>
                <div className="text-[15px] font-semibold">{t.t}</div>
                <div className={`mt-1 text-[12.5px] leading-snug ${tool === t.k ? "text-white/65" : "text-[#8A8792]"}`}>{t.d}</div>
              </button>
            ))}
          </div>

          <div className="min-w-0 rounded-[28px] bg-white p-5 ring-1 ring-[#E3E7F0] sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] text-[#8A8792]">{own ? <>Your file: <b className="font-medium text-[#14131C]">{own.name}</b> · {own.kind} · {own.rows} rows <button onClick={() => setOwn(null)} className="ml-2 text-[#4F35E8] hover:underline">use demo</button></> : <>Demo: <b className="font-medium text-[#14131C]">{ds.company}</b> · {INDUSTRY_LABEL[industry]} · October 2026</>}</div>
              {tool !== "coa" && <button onClick={() => fileRef.current?.click()} className="h-9 rounded-full px-3.5 text-[13px] font-medium text-[#14131C] ring-1 ring-[#D3D9E6] hover:bg-[#EEF1F7]">Use my CSV</button>}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={`${tool}-${industry}-${own?.name ?? "demo"}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                {tool === "payouts" && <PayoutsTool own={own} />}
                {tool === "bank" && <BankTool own={own} />}
                {tool === "expenses" && <ExpensesTool own={own} />}
                {tool === "coa" && <CoaTool />}
                {tool === "payroll" && <PayrollTool own={own} />}
                {tool === "einvoice" && <EinvoiceTool own={own} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-[#8A8792]";
const td = "border-t border-[#F3F1EC] px-3 py-2.5 text-[13.5px] text-[#14131C]";
const tdr = `${td} text-right tabular-nums`;
const Stat = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
  <div className="rounded-2xl bg-[#FFFFFF] p-3.5 ring-1 ring-[#EEF1F7]"><div className="text-[11px] uppercase tracking-[0.1em] text-[#8A8792]">{k}</div><div className="mt-1 font-[family-name:var(--font-display)] text-[21px] font-semibold tabular-nums text-[#14131C]">{v}</div>{sub && <div className="text-[11.5px] text-[#8A8792]">{sub}</div>}</div>
);
const Wrong = ({ want }: { want: string }) => <div className="rounded-2xl bg-[#FFF4DB] px-4 py-3 text-[14px] text-[#7A5600]">This tool needs {want}. Your file looks like something else — try it in the hero above, which reads any mix of files.</div>;

function PayoutsTool({ own }: { own: Loaded | null }) {
  const { industry } = useIndustry();
  const ds = demoDataset(industry);
  if (own && own.kind !== "payout") return <Wrong want="a gateway payout export (Stripe, Shopify Payments, Tabby…)" />;
  const r = reconcile(own ? { company: "", invoices: [], payouts: own.payouts!, bank: [] } : ds);
  const gws = r.gateways;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat k="Gross" v={`AED ${a0(r.summary.grossAed)}`} sub={`${r.rows.filter((x) => x.payoutId).length} lines`} />
        <Stat k="Fees" v={`AED ${a0(r.summary.feeAed)}`} />
        <Stat k="VAT on fees" v={`AED ${a2(r.summary.vatAed)}`} sub="recoverable" />
        <Stat k={own ? "Net paid out" : "Invoices cleared"} v={own ? `AED ${a0(r.summary.netAed)}` : `${r.summary.cleared}/${r.summary.invoices}`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead><tr><th className={th}>Gateway</th><th className={`${th} text-right`}>Collected</th><th className={`${th} text-right`}>Fee</th><th className={`${th} text-right`}>VAT</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Real cost</th></tr></thead>
          <tbody>{gws.map((g) => <tr key={g.gateway}><td className={td}>{g.gateway}<div className="text-[11.5px] text-[#8A8792]">{g.lines} lines</div></td><td className={tdr}>{a2(g.grossAed)}</td><td className={tdr}>{a2(g.feeAed)}</td><td className={tdr}>{a2(g.vatAed)}</td><td className={tdr}>{a2(g.netAed)}</td><td className={`${tdr} font-semibold`}>{(g.effectiveRate * 100).toFixed(2)}%</td></tr>)}</tbody>
        </table>
      </div>
      {own && <p className="text-[12.5px] text-[#8A8792]">Add your invoices/orders export in the hero to see which invoices each line clears.</p>}
    </div>
  );
}

function BankTool({ own }: { own: Loaded | null }) {
  const { industry } = useIndustry();
  const ds = demoDataset(industry);
  if (own && own.kind !== "bank") return <Wrong want="a bank statement (date, description, amount or debit/credit)" />;
  const bank = own?.bank ?? ds.bank;
  const r = reconcile(own ? { company: "", invoices: [], payouts: [], bank } : ds);
  const credits = bank.filter((b) => b.amount > 0);
  const matchedDesc = new Set(r.payouts.filter((p) => p.bank).map((p) => p.bank!.description + p.bank!.amount));
  const gatewayish = /TABBY|TAMARA|STRIPE|SHOPIFY|TELR|NETWORK|CHECKOUT|COD|REMITTANCE|PAYOUT/i;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat k="Bank credits" v={String(credits.length)} sub={`AED ${a0(credits.reduce((a, b) => a + b.amount, 0))}`} />
        <Stat k="Tied to a payout" v={own ? String(credits.filter((c) => gatewayish.test(c.description)).length) : `${r.summary.bankMatched}/${r.summary.payouts}`} sub={own ? "gateway credits found" : "payouts"} />
        <Stat k="FX & bank diff." v={`AED ${a2(r.summary.fxAed)}`} />
        <Stat k="Debits" v={String(bank.length - credits.length)} sub="see Expenses → accounts" />
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead><tr><th className={th}>Date</th><th className={th}>Description</th><th className={`${th} text-right`}>Amount</th><th className={th}>Matched to</th></tr></thead>
          <tbody>{credits.slice(0, 50).map((b, i) => {
            const p = r.payouts.find((x) => x.bank && x.bank.description === b.description && x.bank.amount === b.amount);
            return <tr key={i}><td className={td}>{b.date}</td><td className={td}><span className="line-clamp-1">{b.description}</span></td><td className={tdr}>{a2(b.amount)}</td>
              <td className={td}>{p ? <span className="text-[#147A4B]">✓ {p.gateway} · {p.lines} line{p.lines > 1 ? "s" : ""}{p.fxAed ? ` · FX ${a2(p.fxAed)}` : ""}</span> : matchedDesc.has(b.description + b.amount) ? "✓" : gatewayish.test(b.description) ? <span className="text-[#9A6A00]">gateway credit — add its payout file</span> : <span className="text-[#8A8792]">customer receipt</span>}</td></tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function ExpensesTool({ own }: { own: Loaded | null }) {
  const { industry } = useIndustry();
  const [chart, setChart] = useState<Account[] | null>(null);
  const chartRef = useRef<HTMLInputElement>(null);
  if (own && own.kind !== "bank") return <Wrong want="a bank or card statement" />;
  const bank = (own?.bank ?? demoDataset(industry).bank).filter((b) => b.amount < 0);
  const c = categoriseBank(bank, chart ?? chartFor(industry));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#FFFFFF] px-4 py-3 ring-1 ring-[#EEF1F7]">
        <div className="text-[13.5px] text-[#55525E]">{chart ? `Using your chart: ${chart.length} accounts` : `Using RAMZA's ${INDUSTRY_LABEL[industry].toLowerCase()} chart of accounts`}</div>
        <button onClick={() => chartRef.current?.click()} className="h-9 rounded-full px-3.5 text-[13px] font-medium text-[#14131C] ring-1 ring-[#D3D9E6] hover:bg-white">Upload my chart of accounts</button>
        <input ref={chartRef} type="file" accept=".csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const l = loadTable(f.name, parseCsv(await f.text()), industry); if (l.chart?.length) { setChart(l.chart); funnel("tool_use", { tool: "expenses", action: "coa_upload", rows: l.chart.length }); } e.target.value = ""; }} />
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Stat k="Lines" v={String(c.lines.length)} />
        <Stat k="Auto-categorised" v={`${Math.round(c.autoRate * 100)}%`} />
        <Stat k="VAT recoverable" v={`AED ${a2(c.lines.reduce((a, l) => a + l.vatAed, 0))}`} />
      </div>
      <div className="max-h-[340px] overflow-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead><tr><th className={th}>Bank line</th><th className={th}>Account</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>VAT</th></tr></thead>
          <tbody>{c.lines.slice(0, 60).map((l, i) => <tr key={i}><td className={td}><span className="line-clamp-1">{l.description}</span><div className="text-[11.5px] text-[#8A8792]">{l.date}</div></td><td className={td}><span className="text-[#A19EA6]">{l.account.code}</span> {l.account.name}{l.confidence === "fallback" && <span className="ml-1 text-[11px] text-[#9A6A00]">· check</span>}</td><td className={tdr}>{a2(l.amount)}</td><td className={tdr}>{l.vatAed ? a2(l.vatAed) : "—"}</td></tr>)}</tbody>
        </table>
      </div>
      <button onClick={() => { funnel("tool_use", { tool: "expenses", action: "download" }); download("ramza-categorised.csv", toCsv(["Date", "Description", "Amount", "Account code", "Account", "VAT recoverable"], c.lines.map((l) => [l.date, l.description, l.amount, l.account.code, l.account.name, l.vatAed]))); }} className="h-10 rounded-full bg-[#0B1533] px-5 text-[14px] font-medium text-white hover:bg-black">Download categorised CSV</button>
    </div>
  );
}

function CoaTool() {
  const { industry } = useIndustry();
  const chart = chartFor(industry);
  const types = [...new Set(chart.map((a) => a.type))];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {types.map((t) => (
          <div key={t} className="rounded-2xl bg-[#FFFFFF] p-4 ring-1 ring-[#EEF1F7]">
            <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-[#4F35E8]">{t}</div>
            <ul className="mt-2 space-y-1">{chart.filter((a) => a.type === t).map((a) => <li key={a.code} className="flex gap-3 text-[13.5px]"><span className="w-10 tabular-nums text-[#A19EA6]">{a.code}</span><span className="text-[#14131C]">{a.name}</span></li>)}</ul>
          </div>
        ))}
      </div>
      <button onClick={() => { funnel("tool_use", { tool: "coa", industry, action: "download" }); download(`ramza-chart-of-accounts-${industry}.csv`, toCsv(["Account Code", "Account Name", "Account Type"], chart.map((a) => [a.code, a.name, a.type]))); }} className="h-10 rounded-full bg-[#0B1533] px-5 text-[14px] font-medium text-white hover:bg-black">Download for Zoho / Xero / QuickBooks</button>
    </div>
  );
}

function PayrollTool({ own }: { own: Loaded | null }) {
  const { industry } = useIndustry();
  const [rows, setRows] = useState<Employee[]>(() => (own?.employees?.length ? own.employees : demoDataset(industry).employees));
  if (own && own.kind !== "payroll") return <Wrong want="an employee list (name, basic salary, allowances, joining date)" />;
  const asOf = new Date().toISOString().slice(0, 10);
  const p = payroll(rows, asOf);
  const set = (i: number, k: keyof Employee, v: string) => setRows((r) => r.map((e, j) => (j === i ? { ...e, [k]: k === "name" || k === "joined" ? v : Number(v) || 0 } : e)));
  const cell = "w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-[13px] tabular-nums hover:border-[#DDE2EC] focus:border-[#14131C] focus:outline-none";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat k="Monthly payroll" v={`AED ${a0(p.totals.gross)}`} sub={`${rows.length} staff`} />
        <Stat k="Basic" v={`AED ${a0(p.totals.basic)}`} />
        <Stat k="Gratuity to date" v={`AED ${a0(p.totals.gratuity)}`} sub="end-of-service liability" />
        <Stat k="Provision this month" v={`AED ${a0(p.totals.monthlyAccrual)}`} sub="book to 2300" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead><tr><th className={th}>Employee</th><th className={`${th} text-right`}>Basic</th><th className={`${th} text-right`}>Allowances</th><th className={th}>Joined</th><th className={`${th} text-right`}>Years</th><th className={`${th} text-right`}>Gratuity</th></tr></thead>
          <tbody>{p.rows.map((e, i) => (
            <tr key={i}>
              <td className={td}><input className={cell} value={e.name} onChange={(x) => set(i, "name", x.target.value)} /></td>
              <td className={tdr}><input className={`${cell} text-right`} value={e.basic} onChange={(x) => set(i, "basic", x.target.value)} /></td>
              <td className={tdr}><input className={`${cell} text-right`} value={e.allowances} onChange={(x) => set(i, "allowances", x.target.value)} /></td>
              <td className={td}><input type="date" className={cell} value={e.joined} onChange={(x) => set(i, "joined", x.target.value)} /></td>
              <td className={tdr}>{e.years.toFixed(1)}</td>
              <td className={`${tdr} font-semibold`}>{a2(e.gratuity)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setRows((r) => [...r, { name: "New employee", basic: 4000, allowances: 2000, joined: asOf.slice(0, 8) + "01" }])} className="h-10 rounded-full px-4 text-[14px] font-medium text-[#14131C] ring-1 ring-[#D3D9E6] hover:bg-[#EEF1F7]">Add employee</button>
        <button onClick={() => { funnel("tool_use", { tool: "payroll", action: "download", staff: rows.length }); download("ramza-payroll.csv", toCsv(["Employee", "Basic", "Allowances", "Gross", "Joined", "Years", "Gratuity", "Monthly provision"], p.rows.map((e) => [e.name, e.basic, e.allowances, e.gross, e.joined, e.years, e.gratuity, e.monthlyAccrual]))); }} className="h-10 rounded-full bg-[#0B1533] px-5 text-[14px] font-medium text-white hover:bg-black">Download payroll sheet</button>
      </div>
      <p className="text-[12px] text-[#8A8792]">Estimate under Federal Decree-Law 33/2021: 21 days&apos; basic per year for the first five years, 30 days after, after one year of service, capped at two years&apos; wage. Free-zone rules (e.g. DIFC DEWS) differ.</p>
    </div>
  );
}

function EinvoiceTool({ own }: { own: Loaded | null }) {
  const { industry } = useIndustry();
  if (own && own.kind !== "invoices") return <Wrong want="an invoices export (number, date, customer, total, TRNs)" />;
  const invoices: Invoice[] = own?.invoices ?? demoDataset(industry).invoices;
  const b2b = industry !== "ecommerce" && industry !== "retail";
  const r = einvoiceReadiness(invoices, b2b);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
        <div className="rounded-[24px] bg-[#0B1533] p-5 text-white">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#CBC3FF]">Readiness score</div>
          <div className="mt-1 font-[family-name:var(--font-display)] text-[48px] font-semibold tabular-nums leading-none">{r.score}<span className="text-[22px] text-white/50">/100</span></div>
          <div className="mt-2 text-[12.5px] text-white/60">{r.ready} of {r.invoices} invoices have every core field</div>
        </div>
        <div className="space-y-2">
          {r.fields.map((f) => (
            <div key={f.key} className="grid grid-cols-[170px_1fr_auto] items-center gap-3">
              <span className="text-[13.5px] text-[#14131C]">{f.label}</span>
              <div className="h-2 rounded-full bg-[#EEF1F7]"><motion.div initial={{ width: 0 }} animate={{ width: `${(1 - f.missing / Math.max(invoices.length, 1)) * 100}%` }} className={`h-full rounded-full ${f.ok ? "bg-[#1F9D63]" : "bg-[#E8A33D]"}`} /></div>
              <span className={`w-24 text-right text-[12.5px] ${f.ok ? "text-[#147A4B]" : "text-[#9A6A00]"}`}>{f.ok ? "all present" : `${f.missing} missing`}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-[#8A8792]">Checks the core fields only — a full check runs your invoices through an accredited service provider&apos;s validation. {b2b ? "B2B invoices need the buyer's TRN. " : ""}RAMZA cleans the data and connects you to an accredited provider; it is not one itself.</p>
    </div>
  );
}
