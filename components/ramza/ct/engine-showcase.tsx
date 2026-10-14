"use client";

/* "RAMZA in action" — the reconciliation engine as a six-stage storyboard
 * that plays on its own while it's on screen (pause on hover, click a stage
 * to jump):
 *
 *   1 Payouts arrive     gateway settlement lines stream in
 *   2 Matched to bank    payouts tie to bank credits, fee + VAT split out
 *   3 Invoices booked    each order's invoice gets a payment, instantly
 *   4 Ledger closed      clearing accounts net to zero → month locked
 *   5 Tax worked out     VAT and Corporate Tax from rules.json rates
 *   6 Investor view      quarterly / yearly profit bars, shared read-only
 *
 * All figures are ILLUSTRATIVE demo data (labelled on the panel); tax rates
 * come from config/rules.json via lib/ramza/rules.ts. */

import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRightLeft, Calculator, FileText, LineChart, Lock, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FILING_PARTNER, VAT_RATE, ctOn } from "@/lib/ramza/rules";
import { ct } from "./brand";
import { GATEWAYS, GatewayMark } from "./partner-logos";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const STAGE_MS = 3600;
const EASE = [0.22, 1, 0.36, 1] as const;
const fmt = (n: number) => n.toLocaleString("en-US");

const STAGES = [
  { k: "payouts", icon: Wallet, t: "Payouts arrive", d: "Stripe, Tabby, Tamara, Telr and bank lines stream in around the clock." },
  { k: "match", icon: ArrowRightLeft, t: "Matched to the bank", d: "Every payout tied to its bank credit — fees and VAT split out." },
  { k: "invoices", icon: FileText, t: "Invoices booked", d: "Each order’s invoice gets its payment the moment the money lands." },
  { k: "close", icon: Lock, t: "Ledger reconciled & closed", d: "Clearing accounts net to zero. The month locks itself." },
  { k: "tax", icon: Calculator, t: "VAT & tax worked out", d: "VAT return and Corporate Tax estimate, straight from the books." },
  { k: "investors", icon: LineChart, t: "Investor-ready numbers", d: "Quarterly and yearly profit your investors can open any time." },
] as const;

/* ── demo data ─────────────────────────────────────────────────────────── */

const PAYOUTS = [
  { gw: "Stripe", key: "stripe", gross: 48_250, fee: 1_398 },
  { gw: "Tabby", key: "tabby", gross: 31_900, fee: 1_595 },
  { gw: "Tamara", key: "tamara", gross: 22_480, fee: 1_124 },
  { gw: "Telr", key: "telr", gross: 18_760, fee: 469 },
] as const;
const markOf = (key: string) => GATEWAYS.find((g) => g.key === key)!;
const INVOICES = ["INV-4812", "INV-4813", "INV-4814", "INV-4815", "INV-4816", "INV-4817"];
const QUARTERS = [
  { l: "Q1", rev: 312, profit: 58 },
  { l: "Q2", rev: 356, profit: 71 },
  { l: "Q3", rev: 402, profit: 88 },
  { l: "Q4", rev: 468, profit: 109 },
];
const YEARS = [
  { l: "2023", rev: 820, profit: 96 },
  { l: "2024", rev: 1_140, profit: 188 },
  { l: "2025", rev: 1_538, profit: 326 },
];

/* ── stage panels ──────────────────────────────────────────────────────── */

function Payouts() {
  return (
    <div className="space-y-2">
      {PAYOUTS.map((p, i) => (
        <motion.div
          key={p.gw}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.18, duration: 0.5, ease: EASE }}
          className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_6px_20px_-14px_rgba(20,19,28,0.5)]"
        >
          <span className="flex w-[112px] shrink-0 items-center"><GatewayMark g={markOf(p.key)} h={26} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-[#14131C]">Settlement</div>
            <div className="text-[11.5px] text-[#8E8B95]">{12 + i * 7} orders · just now</div>
          </div>
          <div className="text-right text-[13.5px] font-medium tabular-nums text-[#14131C]">AED {fmt(p.gross)}</div>
        </motion.div>
      ))}
    </div>
  );
}

function Match() {
  return (
    <div className="grid grid-cols-[1fr_56px_1fr] items-stretch gap-0">
      <div className="space-y-2">
        {PAYOUTS.slice(0, 4).map((p, i) => (
          <motion.div key={p.gw} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.1 }}
            className="flex h-12 items-center justify-between rounded-xl bg-white px-3 text-[12.5px] shadow-sm">
            <GatewayMark g={markOf(p.key)} h={20} />
            <span className="tabular-nums text-[#55525E]">{fmt(p.gross - p.fee)}</span>
          </motion.div>
        ))}
      </div>
      <svg viewBox="0 0 56 216" preserveAspectRatio="none" className="h-[216px] w-full">
        {[0, 1, 2, 3].map((i) => {
          const y = 24 + i * 56;
          return (
            <motion.path key={i} d={`M0 ${y} C 28 ${y}, 28 ${y}, 56 ${y}`} fill="none" stroke="#4F35E8" strokeWidth={2} strokeLinecap="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5 + i * 0.25, duration: 0.5 }} />
          );
        })}
      </svg>
      <div className="space-y-2">
        {PAYOUTS.slice(0, 4).map((p, i) => (
          <motion.div key={p.gw} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 + i * 0.25 }}
            className="flex h-12 items-center justify-between rounded-xl bg-emerald-50 px-3 text-[12.5px] ring-1 ring-emerald-200">
            <span className="text-emerald-700">Bank credit ✓</span>
            <span className="tabular-nums text-emerald-800">{fmt(p.gross - p.fee)}</span>
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.7 }}
        className="col-span-3 mt-3 flex flex-wrap gap-2 text-[11.5px]">
        <span className="rounded-full bg-[#EEF1F7] px-3 py-1 text-[#4F35E8]">Gateway fees split out</span>
        <span className="rounded-full bg-[#EEF1F7] px-3 py-1 text-[#4F35E8]">VAT on fees recovered</span>
        <span className="rounded-full bg-[#EEF1F7] px-3 py-1 text-[#4F35E8]">FX difference booked</span>
      </motion.div>
    </div>
  );
}

function Invoices() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {INVOICES.map((inv, i) => (
        <motion.div key={inv} initial={{ opacity: 0, rotateX: -60 }} animate={{ opacity: 1, rotateX: 0 }} transition={{ delay: i * 0.15, duration: 0.5 }}
          className="relative overflow-hidden rounded-2xl bg-white p-3.5 shadow-[0_6px_20px_-14px_rgba(20,19,28,0.5)]" style={{ transformPerspective: 600 }}>
          <div className="text-[11px] text-[#8E8B95]">{inv}</div>
          <div className="mt-1 text-[14px] font-medium tabular-nums text-[#14131C]">AED {fmt(1_240 + i * 385)}</div>
          <div className="mt-2 h-1.5 w-3/4 rounded-full bg-[#EEF1F7]" />
          <div className="mt-1 h-1.5 w-1/2 rounded-full bg-[#EEF1F7]" />
          <motion.span initial={{ scale: 2.4, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: -12 }} transition={{ delay: 0.5 + i * 0.15, type: "spring", stiffness: 300, damping: 16 }}
            className="absolute right-2 top-2 rounded-md border-2 border-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600">Paid</motion.span>
        </motion.div>
      ))}
    </div>
  );
}

function Close() {
  const accounts = [["Stripe clearing", 48_250], ["Tabby clearing", 31_900], ["Tamara clearing", 22_480], ["Telr clearing", 18_760]] as const;
  return (
    <div>
      <div className="space-y-2">
        {accounts.map(([name, start], i) => (
          <div key={name} className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 text-[13px] shadow-sm">
            <span className="text-[#14131C]">{name}</span>
            <motion.span className="tabular-nums font-medium" initial={{ color: "#C2334D" }} animate={{ color: "#059669" }} transition={{ delay: 0.4 + i * 0.3, duration: 0.4 }}>
              <Counter from={start} to={0} delay={0.2 + i * 0.3} />
            </motion.span>
          </div>
        ))}
      </div>
      <motion.div initial={{ opacity: 0, scale: 1.6, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: -4 }} transition={{ delay: 1.8, type: "spring", stiffness: 260, damping: 15 }}
        className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-2xl border-2 border-[#14131C] px-4 py-2 text-[13px] font-bold uppercase tracking-[0.14em] text-[#14131C]">
        Month closed
      </motion.div>
    </div>
  );
}

function Tax() {
  const sales = 1_538_000, purchases = 612_000, profit = 326_000 + 480_000; // demo year
  const vatOut = Math.round(sales * VAT_RATE), vatIn = Math.round(purchases * VAT_RATE);
  const rows: [string, number, string?][] = [
    ["VAT on sales", vatOut],
    ["VAT on purchases & fees", -vatIn],
    ["VAT payable", vatOut - vatIn, "strong"],
    ["Corporate Tax estimate", ctOn(profit), "strong"],
  ];
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_6px_20px_-14px_rgba(20,19,28,0.5)]">
      {rows.map(([l, v, s], i) => (
        <motion.div key={l} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.22 }}
          className={`flex items-center justify-between py-2 text-[13.5px] ${s ? "border-t border-[#EEF1F7] font-medium text-[#14131C]" : "text-[#55525E]"}`}>
          <span>{l}</span>
          <span className="tabular-nums">AED <Counter from={0} to={v} delay={0.15 + i * 0.22} /></span>
        </motion.div>
      ))}
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-2 text-[11.5px] text-[#8E8B95]">
        Rates from the published UAE rules · reviewed by an accountant · filed via {FILING_PARTNER}
      </motion.p>
    </div>
  );
}

export function ProfitBars({ period, compact = false }: { period: "quarterly" | "yearly"; compact?: boolean }) {
  const data = period === "quarterly" ? QUARTERS : YEARS;
  const max = Math.max(...data.map((d) => d.rev));
  return (
    <div className={`flex items-end gap-3 ${compact ? "h-[150px]" : "h-[190px]"}`}>
      {data.map((d, i) => (
        <div key={d.l} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <div className="relative flex w-full max-w-[56px] flex-1 items-end justify-center">
            <motion.div className="absolute bottom-0 w-full rounded-t-xl bg-[#E3E7F0]" initial={{ height: 0 }} animate={{ height: `${(d.rev / max) * 100}%` }} transition={{ delay: i * 0.12, duration: 0.8, ease: EASE }} />
            <motion.div className="absolute bottom-0 w-full rounded-t-xl bg-gradient-to-t from-[#4F35E8] to-[#B3A6FF]" initial={{ height: 0 }} animate={{ height: `${(d.profit / max) * 100}%` }} transition={{ delay: 0.3 + i * 0.12, duration: 0.8, ease: EASE }} />
          </div>
          <span className="text-[11.5px] text-[#8E8B95]">{d.l}</span>
        </div>
      ))}
    </div>
  );
}

function Investors() {
  const [period, setPeriod] = useState<"quarterly" | "yearly">("quarterly");
  useEffect(() => { const t = setTimeout(() => setPeriod("yearly"), 1900); return () => clearTimeout(t); }, []);
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_6px_20px_-14px_rgba(20,19,28,0.5)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-medium text-[#14131C]">Net profit</div>
        <div className="flex rounded-full bg-[#EEF1F7] p-0.5 text-[11.5px]">
          {(["quarterly", "yearly"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`relative rounded-full px-3 py-1 capitalize ${period === p ? "text-white" : "text-[#55525E]"}`}>
              {period === p && <motion.span layoutId="inv-toggle" className="absolute inset-0 rounded-full bg-[#0B1533]" />}
              <span className="relative">{p}</span>
            </button>
          ))}
        </div>
      </div>
      <ProfitBars key={period} period={period} compact />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }} className="mt-3 flex items-center gap-2 rounded-xl bg-[#FFFFFF] px-3 py-2 text-[12px] text-[#55525E]">
        <span className="flex -space-x-2">
          {["#4F35E8", "#B3A6FF", "#14131C"].map((c) => <span key={c} className="h-6 w-6 rounded-full ring-2 ring-white" style={{ background: c }} />)}
        </span>
        Investors opened the board pack · read-only link
      </motion.div>
    </div>
  );
}

function Counter({ from, to, delay = 0 }: { from: number; to: number; delay?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay * 1000;
    const tick = (t: number) => {
      const p = Math.min(Math.max((t - start) / 900, 0), 1);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, delay]);
  return <>{fmt(v)}</>;
}

const PANELS = [Payouts, Match, Invoices, Close, Tax, Investors];

/* ── section ───────────────────────────────────────────────────────────── */

export function EngineShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduced = useReducedMotion();
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = inView && !paused && !reduced;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStage((s) => (s + 1) % STAGES.length), STAGE_MS);
    return () => clearTimeout(t);
  }, [stage, playing]);

  const Panel = PANELS[stage];
  const S = STAGES[stage];

  return (
    <section id="in-action" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-20`}>
      <TrackView section="engine" event="ViewContent" className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrow}><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span> RAMZA in action</span>
          <h2 className={`${ct.h2} mt-4`}>Your books close themselves. Every day.</h2>
          <p className={`${ct.lead} mt-4`}>An always-on reconciliation engine — from the payout to the profit your investors see. Accountants review; nobody types.</p>
        </Reveal>

        <div ref={ref} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} className="mt-12 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          {/* stage rail */}
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {STAGES.map((s, i) => {
              const active = i === stage;
              return (
                <li key={s.k}>
                  <button onClick={() => setStage(i)} aria-current={active}
                    className={`relative w-full overflow-hidden rounded-2xl px-4 py-3.5 text-left transition ${active ? "bg-white shadow-[0_18px_40px_-26px_rgba(20,19,28,0.55)]" : "hover:bg-white/60"}`}>
                    <div className="flex items-start gap-3">
                      <span className={`w-8 shrink-0 font-[family-name:var(--font-display)] text-[20px] font-semibold leading-[1.1] tabular-nums transition ${active ? "text-[#4F35E8]" : i < stage ? "text-emerald-600" : "text-[#CFCCC6]"}`}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <div className={`text-[15px] font-medium ${active ? "text-[#14131C]" : "text-[#55525E]"}`}>{s.t}</div>
                        <AnimatePresence initial={false}>
                          {active && (
                            <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden text-[13px] leading-relaxed text-[#6E6B75]">
                              {s.d}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    {active && (
                      <motion.span key={`${stage}-${playing}`} className="absolute bottom-0 left-0 h-[3px] bg-[#0B1533]"
                        initial={{ width: "0%" }} animate={{ width: playing ? "100%" : "0%" }} transition={{ duration: playing ? STAGE_MS / 1000 : 0, ease: "linear" }} />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          {/* app window */}
          <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#F5F3EF] to-[#E3E7F0] p-2 shadow-[0_40px_90px_-50px_rgba(20,19,28,0.6)] ring-1 ring-[#DDE2EC]">
            <div className="flex items-center justify-between rounded-t-[22px] bg-white/70 px-4 py-2.5 backdrop-blur">
              <div className="flex gap-1.5">{["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}</div>
              <div className="text-[12px] text-[#55525E]">RAMZA · Live books</div>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> 24/7</span>
            </div>
            <div className="min-h-[360px] px-4 pb-4 pt-5 sm:px-6">
              {/* title + panel remount together on each stage — enter-only, so a
                  slow device can never show two stages at once */}
              <motion.div key={stage} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
                  <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-[#14131C]">
                    {S.t}
                    <span className="ml-auto text-[11px] font-normal text-[#8E8B95]">Step {stage + 1} of {STAGES.length}</span>
                  </div>
                  <Panel />
                </motion.div>
            </div>
            <div className="flex items-center justify-between px-4 pb-3 text-[11px] text-[#8E8B95]">
              <span>Every line reviewed by an accountant</span>
              <span>Illustrative demo data</span>
            </div>
          </div>
        </div>
      </TrackView>
    </section>
  );
}
