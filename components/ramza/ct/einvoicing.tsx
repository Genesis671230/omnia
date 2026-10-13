"use client";

/* E-invoicing readiness — the UAE's 5-corner model drawn and animated, plus
 * the two go-live tracks. Dates come from config/rules.json (einvoicing.*).
 *
 * Positioning (compliance): RAMZA is NOT an Accredited Service Provider. We
 * get the books and invoice data ready and connect the business to an ASP;
 * the page says so in plain words. No FTA/MoF marks or colours. */

import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Building2, Check, FileCode2, Landmark, Network, Pause, Play, ShieldCheck, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { rules, VAT_RATE } from "@/lib/ramza/rules";
import { CtLeadForm } from "./lead-form";
import { ct } from "./brand";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const millions = (n: number) => `AED ${n / 1_000_000}M`;

const NODES = [
  { x: 70, y: 90, icon: Store, t: "Your business", s: "books by RAMZA" },
  { x: 290, y: 90, icon: Network, t: "Your ASP", s: "accredited provider" },
  { x: 510, y: 90, icon: Network, t: "Buyer’s ASP", s: "accredited provider" },
  { x: 730, y: 90, icon: Building2, t: "Your buyer", s: "receives the invoice" },
  { x: 400, y: 250, icon: Landmark, t: "Tax authority", s: "receives tax data" },
];
const LINKS = [
  "M110 76 H250", "M330 76 H470", "M550 76 H690", // invoice path, corners 1→2→3→4
  "M290 150 C 290 222, 330 236, 370 236", // corner 5: both ASPs report tax data
  "M510 150 C 510 222, 470 236, 430 236",
];

function FlowDiagram() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { amount: 0.3, once: false });
  const reduced = useReducedMotion();
  const on = inView && !reduced;

  return (
    <svg ref={ref} viewBox="0 0 800 310" className="block h-auto w-full" role="img" aria-label="Diagram: invoice travels from your business through two accredited service providers to the buyer, with tax data reported to the tax authority">
      {LINKS.map((d, i) => (
        <g key={d}>
          <path d={d} fill="none" stroke="#E2DFD8" strokeWidth={3} strokeLinecap="round" />
          <motion.path d={d} fill="none" stroke={i < 3 ? "#4F35E8" : "#10B981"} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 10"
            initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : { pathLength: 0 }} transition={{ duration: 0.8, delay: i * 0.35 }} />
          {/* travelling packet */}
          {on && (
            <circle r={6} fill={i < 3 ? "#4F35E8" : "#10B981"}>
              <animateMotion dur="2.6s" begin={`-${i * 0.45}s`} repeatCount="indefinite" path={d} />
            </circle>
          )}
        </g>
      ))}
      {NODES.map((n, i) => (
        <motion.g key={n.t} initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0 } : undefined} transition={{ delay: 0.1 + i * 0.12 }}>
          <foreignObject x={n.x - 72} y={n.y - 38} width={144} height={92}>
            <div className="flex flex-col items-center text-center">
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${i === 0 ? "bg-[#14131C] text-white" : i === 4 ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200" : "bg-white text-[#4F35E8] ring-1 ring-[#E2DFD8]"} shadow-sm`}>
                <n.icon size={20} />
              </span>
              <span className="mt-2 text-[13px] font-medium text-[#14131C]">{n.t}</span>
              <span className="text-[11px] text-[#8E8B95]">{n.s}</span>
            </div>
          </foreignObject>
        </motion.g>
      ))}
      <text x={400} y={64} textAnchor="middle" fontSize={11} fill="#8E8B95">structured e-invoice</text>
    </svg>
  );
}


/* ── the film: one invoice's journey, played like a short video ────────── */

const SCENES = [
  { t: "You raise an invoice", s: "Structured data, not a PDF — straight from books RAMZA keeps reconciled." },
  { t: "Your ASP validates it", s: "Format, TRN and VAT are checked before anything leaves." },
  { t: "Sent across the network", s: "Your ASP passes it to your buyer's accredited provider." },
  { t: "Your buyer receives it", s: "Delivered into their system — no email attachments." },
  { t: "Tax data is reported", s: "Both providers report the invoice's tax data to the tax authority." },
] as const;
const SCENE_MS = 3200;
const STOPS = [6, 30, 54, 80]; // % across the track: you, your ASP, buyer's ASP, buyer

function InvoiceCard({ checks }: { checks: number }) {
  const net = 12500;
  const vat = Math.round(net * VAT_RATE);
  return (
    <div className="w-[150px] rounded-2xl bg-white p-3 text-left shadow-[0_18px_40px_-18px_rgba(20,19,28,0.55)] ring-1 ring-[#E2DFD8]">
      <div className="flex items-center justify-between text-[10px] font-medium text-[#4F35E8]"><span>E-INVOICE</span><FileCode2 size={12} /></div>
      <div className="mt-2 space-y-1">
        <div className="h-1.5 w-20 rounded-full bg-[#E8E5DE]" /><div className="h-1.5 w-14 rounded-full bg-[#E8E5DE]" />
      </div>
      <div className="mt-2 flex justify-between text-[10.5px] text-[#55525E]"><span>Net</span><span className="tabular-nums">{net.toLocaleString("en-US")}</span></div>
      <div className="flex justify-between text-[10.5px] text-[#55525E]"><span>VAT {Math.round(VAT_RATE * 100)}%</span><span className="tabular-nums">{vat.toLocaleString("en-US")}</span></div>
      <div className="mt-1 flex justify-between border-t border-[#F2F0EB] pt-1 text-[11px] font-medium text-[#14131C]"><span>AED</span><span className="tabular-nums">{(net + vat).toLocaleString("en-US")}</span></div>
      <div className="mt-2 flex gap-1">
        {["Format", "TRN", "VAT"].map((c, i) => (
          <span key={c} className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] transition-colors duration-300 ${i < checks ? "bg-emerald-50 text-emerald-600" : "bg-[#F5F3EF] text-[#A19EA6]"}`}>
            {i < checks && <Check size={8} />}{c}
          </span>
        ))}
      </div>
    </div>
  );
}

function EInvoiceFilm() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduced = useReducedMotion();
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const running = playing && inView && !reduced;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setScene((s) => (s + 1) % SCENES.length), SCENE_MS);
    return () => clearTimeout(t);
  }, [running, scene]);

  const stop = STOPS[Math.min(scene, 3)];
  const checks = scene === 0 ? 0 : 3;
  const nodes = [
    { icon: Store, t: "Your business" }, { icon: Network, t: "Your ASP" }, { icon: Network, t: "Buyer's ASP" }, { icon: Building2, t: "Your buyer" },
  ];
  return (
    <div ref={ref} className="overflow-hidden rounded-[28px] bg-[#14131C] text-white" role="region" aria-label="Animation: how an e-invoice travels">
      <div className="relative h-[300px] px-4 sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_80%_0%,rgba(179,166,255,0.14),transparent_60%)]" />
        {/* track */}
        <div className="absolute left-[8%] right-[8%] top-[118px] h-[2px] bg-white/15" />
        <motion.div className="absolute left-[8%] top-[118px] h-[2px] bg-gradient-to-r from-[#CBC3FF] to-[#B3A6FF]"
          animate={{ width: `${((STOPS[Math.min(scene, 3)] - 6) / 74) * 84}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
        {nodes.map((n, i) => (
          <div key={n.t} className="absolute top-[96px] -translate-x-1/2 text-center" style={{ left: `${[8, 36, 64, 92][i]}%` }}>
            <span className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl transition-colors duration-500 ${Math.min(scene, 3) >= i ? "bg-[#B3A6FF] text-white" : "bg-white/10 text-white/60"}`}><n.icon size={18} /></span>
            <span className="mt-1.5 block whitespace-nowrap text-[11px] text-white/70">{n.t}</span>
          </div>
        ))}
        {/* authority, reported in the last scene */}
        <div className="absolute left-1/2 top-[226px] -translate-x-1/2 text-center">
          <span className={`mx-auto flex h-10 w-10 items-center justify-center rounded-2xl transition-colors duration-500 ${scene === 4 ? "bg-emerald-400 text-[#0C0B12]" : "bg-white/10 text-white/50"}`}><Landmark size={17} /></span>
          <span className="mt-1 block text-[11px] text-white/60">Tax authority</span>
        </div>
        {scene === 4 && [36, 64].map((x, i) => (
          <motion.span key={x} className="absolute h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]"
            initial={{ left: `${x}%`, top: 120 }} animate={{ left: "50%", top: 232 }} transition={{ duration: 1.1, delay: i * 0.25, repeat: Infinity, repeatDelay: 0.6 }} />
        ))}
        {/* the invoice */}
        <motion.div className="absolute top-[8px]" animate={{ left: `calc(${stop + (stop > 50 ? -4 : 0)}% - 20px)`, rotate: scene === 2 ? -3 : 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
          <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
            <InvoiceCard checks={checks} />
          </motion.div>
          <AnimatePresence>{scene === 3 && (
            <motion.span initial={{ scale: 1.6, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: -8 }} exit={{ opacity: 0 }}
              className="absolute -right-3 -top-2 rounded-lg border-2 border-emerald-400 bg-[#0C0B12]/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Received</motion.span>
          )}</AnimatePresence>
        </motion.div>
      </div>
      {/* caption + player controls */}
      <div className="flex items-center gap-4 border-t border-white/10 bg-white/[0.04] px-5 py-4 sm:px-8">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#14131C]">
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div key={scene} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
              <div className="text-[15px] font-medium">{scene + 1}. {SCENES[scene].t}</div>
              <div className="truncate text-[12.5px] text-white/60">{SCENES[scene].s}</div>
            </motion.div>
          </AnimatePresence>
          <div className="mt-2 flex gap-1.5">
            {SCENES.map((_, i) => (
              <button key={i} type="button" onClick={() => setScene(i)} aria-label={`Scene ${i + 1}`} className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
                <motion.span className="block h-full bg-white" initial={false}
                  animate={{ width: i < scene ? "100%" : i === scene ? (running ? "100%" : "40%") : "0%" }}
                  transition={i === scene && running ? { duration: SCENE_MS / 1000, ease: "linear" } : { duration: 0.2 }} key={`${i}-${scene}`} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EInvoicingSection() {
  const { large, sme } = rules.einvoicing;
  const tracks = [
    { who: `Revenue ${millions(large.revenue_gte_aed)}+`, asp: large.asp_by, live: large.go_live },
    { who: `Revenue under ${millions(large.revenue_gte_aed)}`, asp: sme.asp_by, live: sme.go_live },
  ];
  const ready = [
    { icon: FileCode2, t: "Invoices as structured data", d: "Not PDFs. Every invoice line clean and consistent — straight from books RAMZA keeps reconciled." },
    { icon: Network, t: "Connected to an accredited provider", d: "We line up the Accredited Service Provider and hand over clean data. RAMZA itself is not an ASP." },
    { icon: ShieldCheck, t: "Tax data that already ties out", d: "VAT on every invoice matches the ledger, so what gets reported matches what you file." },
  ];
  return (
    <section id="e-invoicing" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-24`}>
      <TrackView section="e-invoicing" className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrow}>E-invoicing is next</span>
          <h2 className={`${ct.h2} mt-4`}>PDF invoices are on the way out</h2>
          <p className={`${ct.lead} mt-4`}>UAE B2B and B2G invoices move to a 5-corner e-invoicing network. Clean books now make the switch a non-event.</p>
        </Reveal>

        <div className="mt-12 grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Reveal delay={0.05}><EInvoiceFilm /></Reveal>
          <Reveal delay={0.1} className="rounded-[28px] bg-white/80 p-6 shadow-[0_24px_60px_-34px_rgba(20,19,28,0.4)] ring-1 ring-white backdrop-blur-xl sm:p-7">
            <h3 className={ct.h3}>Request e-invoicing setup</h3>
            <p className={`${ct.body} mt-1 mb-5`}>We clean your invoice data, line up an Accredited Service Provider and test before your go-live.</p>
            <CtLeadForm placement="einvoicing" cta="Request e-invoicing setup" initialSituation="einvoicing" />
          </Reveal>
        </div>

        <Reveal delay={0.05} className="mt-6 rounded-[28px] bg-white p-4 shadow-[0_24px_60px_-34px_rgba(20,19,28,0.4)] sm:p-8">
          <FlowDiagram />
        </Reveal>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Reveal className="rounded-[28px] bg-gradient-to-br from-[#14131C] to-[#25232E] p-6 text-white sm:p-8">
            <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]">Key dates</div>
            <div className="mt-5 space-y-4">
              {tracks.map((t) => (
                <div key={t.who} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                  <div className="text-[15px] font-medium">{t.who}</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                    <div><div className="text-[#B8B6C0]">Appoint an ASP by</div><div className="mt-0.5 text-[17px] font-medium">{day(t.asp)}</div></div>
                    <div><div className="text-[#B8B6C0]">E-invoicing live</div><div className="mt-0.5 text-[17px] font-medium">{day(t.live)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <div className="grid gap-3">
            {ready.map((r, i) => (
              <Reveal key={r.t} delay={i * 0.08} className="flex gap-4 rounded-3xl bg-white p-5 shadow-[0_10px_30px_-24px_rgba(20,19,28,0.4)]">
                <span className="mt-2 h-2.5 w-2.5 shrink-0 rotate-45 bg-[#4F35E8]" aria-hidden />
                <div><div className="text-[16px] font-medium text-[#14131C]">{r.t}</div><p className={`${ct.body} mt-1`}>{r.d}</p></div>
              </Reveal>
            ))}
          </div>
        </div>
      </TrackView>
    </section>
  );
}
