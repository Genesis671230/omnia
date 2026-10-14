"use client";

/* The hero: "Reconcile a month of payouts in 60 seconds."
 *
 * Drop a gateway payout export, bank statement, invoice/order export or chart
 * of accounts (CSV or Excel) — or try the demo month for your industry. The
 * run plays as a short sequence (read → gateways → match → fees & VAT → FX →
 * bank → chart of accounts → cleared) while matched lines stream in, then
 * hands over to <DemoResults>. Files are read in the browser and never sent. */

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseCsv, type Table } from "@/lib/ramza/demo/csv";
import { loadTable, type Loaded } from "@/lib/ramza/demo/engine";
import { runDemo, runFiles, type RunResult } from "@/lib/ramza/demo/run";
import { INDUSTRY_LABEL } from "@/lib/ramza/demo/coa";
import { funnel } from "@/lib/ramza/funnel";
import { IndustryChips, useIndustry } from "./industry";
import { DemoResults } from "./demo-results";
import { FloatingArtifacts } from "./artifacts";

type Phase = "idle" | "running" | "done";
const STEP_MS = 620;

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function steps(r: RunResult): { label: string; detail: string }[] {
  const s = r.recon?.summary;
  const gws = r.recon?.gateways.map((g) => g.gateway).join(", ") || "—";
  return [
    { label: r.source === "demo" ? "Reading the demo month" : "Reading your file", detail: `${fmt(r.lines)} lines` },
    { label: "Recognising gateways", detail: gws },
    { label: "Matching payouts to invoices", detail: s ? `${s.cleared} of ${s.invoices} cleared` : "no invoices in file" },
    { label: "Separating fees & VAT", detail: s ? `fees AED ${fmt(s.feeAed)} · VAT AED ${fmt(s.vatAed)}` : "—" },
    { label: "Converting currencies", detail: s && s.currencies.length > 1 ? `${s.currencies.join(" · ")} → AED${s.fxAed ? ` · FX AED ${fmt(Math.abs(s.fxAed))}` : ""}` : "all AED" },
    { label: "Matching the bank", detail: s ? `${s.bankMatched} of ${s.payouts} payouts landed` : "—" },
    { label: r.customChart ? "Sorting bank lines into your chart" : "Sorting bank lines to a chart of accounts", detail: r.expenses ? `${Math.round(r.expenses.autoRate * 100)}% auto-categorised` : "no bank lines" },
    { label: "Books cleared", detail: `~${Math.max(1, Math.round(r.report.minutesSaved / 60))} h of matching saved` },
  ];
}

async function readFile(f: File): Promise<Table> {
  if (/\.(xlsx|xls)$/i.test(f.name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
    return parseCsv(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { dateNF: "yyyy-mm-dd" }));
  }
  return parseCsv(await f.text());
}

export function InstantDemo() {
  const { industry } = useIndustry();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<Loaded[]>([]);
  const [chartFile, setChartFile] = useState<Loaded | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chartRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);

  const play = useCallback((r: RunResult) => {
    setResult(r);
    setStep(0);
    setPhase("running");
    startedAt.current = performance.now();
  }, []);

  useEffect(() => {
    if (phase !== "running" || !result) return;
    if (step >= 8) {
      const t = setTimeout(() => {
        setPhase("done");
        funnel("demo_complete", { source: result.source, industry, cleared: result.report.cleared, invoices: result.report.invoices, ms: Math.round(performance.now() - startedAt.current) });
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      }, 450);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [phase, step, result, industry]);

  const tryDemo = () => {
    funnel("demo_start", { source: "demo", industry });
    play(runDemo(industry));
  };

  const addFiles = async (list: FileList | File[], asChart = false) => {
    setError("");
    const loaded: Loaded[] = [];
    for (const f of Array.from(list).slice(0, 5)) {
      if (!/\.(csv|txt|xlsx|xls)$/i.test(f.name)) { setError(`${f.name}: use CSV or Excel (export it from your gateway, bank or books).`); continue; }
      if (f.size > 8 * 1024 * 1024) { setError(`${f.name} is over 8 MB — export one month at a time.`); continue; }
      try {
        const l = loadTable(f.name, await readFile(f), industry);
        loaded.push(asChart && l.kind !== "coa" ? { ...l, kind: "unknown" } : l);
        funnel("file_drop", { kind: l.kind, rows: l.rows, ext: f.name.split(".").pop() ?? "", asChart });
      } catch (e) {
        setError(`${f.name}: couldn't read it (${(e as Error).message}).`);
      }
    }
    if (asChart) { const c = loaded.find((l) => l.kind === "coa"); if (c) setChartFile(c); else if (loaded.length) setError("That doesn't look like a chart of accounts — it needs a code and an account name column."); return; }
    setFiles((cur) => [...cur, ...loaded].slice(-5));
  };

  const runUpload = () => {
    const all = [...files, ...(chartFile ? [chartFile] : [])];
    if (!files.length) return;
    funnel("demo_start", { source: "upload", industry, files: files.length, kinds: files.map((f) => f.kind).join("+") });
    play(runFiles(industry, all));
  };

  const reset = () => { setPhase("idle"); setResult(null); setFiles([]); setChartFile(null); setStep(0); };

  return (
    <section id="demo" className="relative overflow-x-clip pb-10 pt-10 sm:pt-16">
      <FloatingArtifacts />
      <div className="relative mx-auto w-full max-w-[880px] px-5 text-center sm:px-8">
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#55525E] ring-1 ring-[#E3E7F0]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#1F9D63]" /> Free · no sign-up · your file never leaves your browser
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5 font-[family-name:var(--font-display)] text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] text-[#14131C] sm:text-[60px] lg:text-[68px]">
          Reconcile a month of payouts <span className="text-[#4F35E8]">in 60&nbsp;seconds.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mx-auto mt-5 max-w-[620px] text-[17px] leading-relaxed text-[#55525E] sm:text-[18px]">
          Stripe, Shopify Payments, Tabby, Tamara, Telr, card terminals and COD — matched to your invoices, fees and VAT split out, currencies converted, the bank ticked off and every line in your chart of accounts.
        </motion.p>

        <AnimatePresence mode="wait">
          {phase === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="mt-9">
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
                className={`relative rounded-[28px] border-2 border-dashed bg-white/80 px-6 py-9 backdrop-blur transition ${drag ? "scale-[1.01] border-[#4F35E8] bg-[#F4F2FF]" : "border-[#D3D9E6]"}`}
              >
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-[#14131C] shadow-[0_6px_20px_-10px_rgba(20,19,28,0.35)] ring-1 ring-[#E3E7F0]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m0 0 4 4m-4-4L8 7" /><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" /></svg>
                </div>
                <div className="mt-4 text-[17px] font-medium text-[#14131C]">Drop your payout export, bank statement or invoices</div>
                <div className="mt-1 text-[13.5px] text-[#8A8792]">CSV or Excel · up to 5 files · e.g. Stripe payouts + Shopify orders + bank statement</div>
                {files.length > 0 && (
                  <div className="mx-auto mt-5 flex max-w-[560px] flex-wrap justify-center gap-2">
                    {files.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-2 rounded-full bg-[#EEF1F7] px-3 py-1.5 text-[12.5px] text-[#14131C]">
                        <b className="font-medium">{f.name.length > 26 ? `${f.name.slice(0, 24)}…` : f.name}</b>
                        <span className="text-[#8A8792]">{f.kind === "unknown" ? "not recognised" : `${f.kind}${f.gatewayGuess && f.kind === "payout" ? ` · ${f.gatewayGuess}` : ""} · ${f.rows} rows`}</span>
                        <button aria-label="Remove" onClick={() => setFiles((c) => c.filter((_, j) => j !== i))} className="text-[#8A8792] hover:text-[#14131C]">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                  <button onClick={() => inputRef.current?.click()} className="inline-flex h-12 items-center rounded-full bg-[#0B1533] px-6 text-[15px] font-medium text-white transition hover:bg-black">Choose files</button>
                  {files.length > 0 && (
                    <button onClick={runUpload} className="inline-flex h-12 items-center rounded-full bg-[#4F35E8] px-6 text-[15px] font-medium text-white shadow-[0_8px_24px_-12px_rgba(79,53,232,0.6)] transition hover:bg-[#3F26D6]">Reconcile {files.length} file{files.length > 1 ? "s" : ""} →</button>
                  )}
                </div>
                <input ref={inputRef} type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
              </div>
              {error && <p className="mt-3 text-[13px] text-[#C2334D]">{error}</p>}
              <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-[#8A8792]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                Read in your browser. RAMZA doesn&apos;t upload or keep your file.
              </p>

              <div className="mx-auto mt-6 flex max-w-[720px] items-center justify-between gap-4 rounded-[22px] bg-white px-5 py-4 text-left ring-1 ring-[#E3E7F0]">
                <div>
                  <div className="text-[15px] font-medium text-[#14131C]">Chart of accounts <span className="ml-1 text-[12px] font-normal text-[#8A8792]">optional</span></div>
                  <div className="text-[13.5px] text-[#8A8792]">{chartFile ? `${chartFile.name} · ${chartFile.rows} accounts — bank lines will use your accounts` : `Use your own accounts — or ours for ${INDUSTRY_LABEL[industry].toLowerCase()}.`}</div>
                </div>
                <button onClick={() => chartRef.current?.click()} className="inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[14px] font-medium text-[#14131C] ring-1 ring-[#D3D9E6] transition hover:bg-[#EEF1F7]">{chartFile ? "Replace" : "Upload CSV"}</button>
                <input ref={chartRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files) void addFiles(e.target.files, true); e.target.value = ""; }} />
              </div>

              <div className="mt-8">
                <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#8A8792]">No file handy? Pick your industry</div>
                <IndustryChips className="mt-3" from="hero" />
                <button onClick={tryDemo} className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-[#4F35E8] px-7 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(79,53,232,0.7)] transition hover:bg-[#3F26D6]">
                  Try with {INDUSTRY_LABEL[industry].toLowerCase()} demo data <span aria-hidden>↗</span>
                </button>
              </div>
            </motion.div>
          )}

          {phase !== "idle" && result && (
            <motion.div key="run" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-9">
              <RunPanel result={result} step={step} done={phase === "done"} onReset={reset} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {phase === "done" && result && (
        <div ref={resultsRef} className="relative mx-auto mt-10 w-full max-w-[1200px] scroll-mt-24 px-5 sm:px-8">
          <DemoResults result={result} industry={industry} onReset={reset} />
        </div>
      )}
    </section>
  );
}

/* ── the run: steps on the left, matched lines streaming on the right ── */

function RunPanel({ result, step, done, onReset }: { result: RunResult; step: number; done: boolean; onReset: () => void }) {
  const list = steps(result);
  const rows = (result.recon?.rows ?? []).filter((r) => r.payoutId).slice(0, 60);
  const shown = done ? rows.slice(0, 7) : rows.slice(Math.max(0, Math.floor((step / 8) * rows.length) - 7), Math.floor((step / 8) * rows.length));
  const pct = Math.min(100, Math.round((step / 8) * 100));
  return (
    <div className="grid gap-4 text-left md:grid-cols-[1fr_1.1fr]">
      <div className="rounded-[26px] bg-white p-5 ring-1 ring-[#E3E7F0] sm:p-6">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium text-[#8A8792]">{result.label}</div>
          {done && <button onClick={onReset} className="text-[13px] font-medium text-[#4F35E8] hover:underline">Start over</button>}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#EEF1F7]">
          <motion.div className="h-full rounded-full bg-[#4F35E8]" animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
        </div>
        <ol className="mt-4 space-y-1">
          {list.map((s, i) => {
            const state = i < step ? "done" : i === step && !done ? "now" : done ? "done" : "todo";
            return (
              <li key={s.label} className={`flex items-start gap-3 rounded-xl px-2 py-1.5 transition ${state === "now" ? "bg-[#F4F2FF]" : ""}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${state === "done" ? "bg-[#1F9D63] text-white" : state === "now" ? "bg-[#4F35E8] text-white" : "bg-[#EEF1F7] text-[#A19EA6]"}`}>
                  {state === "done" ? "✓" : i + 1}
                </span>
                <div className="min-w-0">
                  <div className={`text-[14.5px] ${state === "todo" ? "text-[#A19EA6]" : "text-[#14131C]"} ${i === 7 && state === "done" ? "font-semibold" : ""}`}>{s.label}</div>
                  {state !== "todo" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="truncate text-[12.5px] text-[#8A8792]">{s.detail}</motion.div>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="relative overflow-hidden rounded-[26px] bg-[#0B1533] p-5 text-white sm:p-6">
        <div className="flex items-center justify-between text-[12px] uppercase tracking-[0.14em] text-[#CBC3FF]">
          <span>Live matching</span><span className="tabular-nums">{done ? "complete" : `${pct}%`}</span>
        </div>
        <div className="mt-4 space-y-2">
          <AnimatePresence initial={false}>
            {shown.map((r) => (
              <motion.div key={`${r.payoutId}-${r.ref}-${r.status}`} layout initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.35 }}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl bg-white/[0.06] px-3.5 py-2.5 ring-1 ring-white/10">
                <span className={`h-2 w-2 rounded-full ${r.status === "matched" || r.status === "retention" ? "bg-[#34D399]" : r.status === "refund" ? "bg-[#B3A6FF]" : "bg-[#FBBF24]"}`} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{r.ref} <span className="font-normal text-white/50">· {r.gateway}{r.currency !== "AED" ? ` · ${r.currency}` : ""}</span></div>
                  <div className="truncate text-[11.5px] text-white/50">
                    {r.status === "refund" ? "refund inside the payout" : r.invoice ? `invoice ${r.invoice.number} · fee ${r.feeAed.toFixed(2)}${r.vatAed ? ` + VAT ${r.vatAed.toFixed(2)}` : ""}` : "no invoice found"}
                  </div>
                </div>
                <div className="text-right text-[13px] tabular-nums">{r.netAed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<div className="text-[10.5px] text-white/45">net AED</div></div>
              </motion.div>
            ))}
          </AnimatePresence>
          {!rows.length && <div className="rounded-2xl bg-white/[0.06] px-4 py-6 text-center text-[13.5px] text-white/60">No payout lines in this file — bank lines are being sorted into accounts.</div>}
        </div>
        {done && result.recon && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-[#4F35E8] px-4 py-3 text-[14px]">
            <b>{result.recon.summary.cleared} of {result.recon.summary.invoices}</b> invoices cleared · AED {fmt(result.recon.summary.bankAed || result.recon.summary.netAed)} into the bank. Results below ↓
          </motion.div>
        )}
      </div>
    </div>
  );
}
