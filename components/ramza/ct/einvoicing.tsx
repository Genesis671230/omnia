"use client";

/* E-invoicing readiness — the UAE's 5-corner model drawn and animated, plus
 * the two go-live tracks. Dates come from config/rules.json (einvoicing.*).
 *
 * Positioning (compliance): RAMZA is NOT an Accredited Service Provider. We
 * get the books and invoice data ready and connect the business to an ASP;
 * the page says so in plain words. No FTA/MoF marks or colours. */

import { motion, useInView, useReducedMotion } from "framer-motion";
import { Building2, CalendarDays, FileCode2, Landmark, Network, ShieldCheck, Store } from "lucide-react";
import { useRef } from "react";
import { rules } from "@/lib/ramza/rules";
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
          <path d={d} fill="none" stroke="#D5DEF5" strokeWidth={3} strokeLinecap="round" />
          <motion.path d={d} fill="none" stroke={i < 3 ? "#2347D9" : "#10B981"} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 10"
            initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : { pathLength: 0 }} transition={{ duration: 0.8, delay: i * 0.35 }} />
          {/* travelling packet */}
          {on && (
            <circle r={6} fill={i < 3 ? "#2347D9" : "#10B981"}>
              <animateMotion dur="2.6s" begin={`-${i * 0.45}s`} repeatCount="indefinite" path={d} />
            </circle>
          )}
        </g>
      ))}
      {NODES.map((n, i) => (
        <motion.g key={n.t} initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0 } : undefined} transition={{ delay: 0.1 + i * 0.12 }}>
          <foreignObject x={n.x - 72} y={n.y - 38} width={144} height={92}>
            <div className="flex flex-col items-center text-center">
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${i === 0 ? "bg-[#2347D9] text-white" : i === 4 ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200" : "bg-white text-[#2347D9] ring-1 ring-[#D9E1F5]"} shadow-sm`}>
                <n.icon size={20} />
              </span>
              <span className="mt-2 text-[13px] font-medium text-[#0A1A4A]">{n.t}</span>
              <span className="text-[11px] text-[#8A96BD]">{n.s}</span>
            </div>
          </foreignObject>
        </motion.g>
      ))}
      <text x={400} y={64} textAnchor="middle" fontSize={11} fill="#8A96BD">structured e-invoice</text>
    </svg>
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

        <Reveal delay={0.05} className="mt-12 rounded-[28px] bg-white p-4 shadow-[0_24px_60px_-34px_rgba(10,26,74,0.4)] sm:p-8">
          <FlowDiagram />
        </Reveal>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Reveal className="rounded-[28px] bg-gradient-to-br from-[#0A1A4A] to-[#2347D9] p-6 text-white sm:p-8">
            <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#8FB0FF]"><CalendarDays size={14} /> Key dates</div>
            <div className="mt-5 space-y-4">
              {tracks.map((t) => (
                <div key={t.who} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                  <div className="text-[15px] font-medium">{t.who}</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                    <div><div className="text-[#B9C6EE]">Appoint an ASP by</div><div className="mt-0.5 text-[17px] font-medium">{day(t.asp)}</div></div>
                    <div><div className="text-[#B9C6EE]">E-invoicing live</div><div className="mt-0.5 text-[17px] font-medium">{day(t.live)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <div className="grid gap-3">
            {ready.map((r, i) => (
              <Reveal key={r.t} delay={i * 0.08} className="flex gap-4 rounded-3xl bg-white p-5 shadow-[0_10px_30px_-24px_rgba(10,26,74,0.4)]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EEF3FF] text-[#2347D9]"><r.icon size={19} /></span>
                <div><div className="text-[16px] font-medium text-[#0A1A4A]">{r.t}</div><p className={`${ct.body} mt-1`}>{r.d}</p></div>
              </Reveal>
            ))}
          </div>
        </div>
      </TrackView>
    </section>
  );
}
