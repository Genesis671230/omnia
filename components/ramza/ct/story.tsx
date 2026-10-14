"use client";

/* "From checkout to closed books" — the process told as four chapters you
 * scroll through. Desktop: the photo column is sticky and cross-fades to the
 * chapter in view, with the product card for that step floating on it.
 * Phones: each chapter shows its own photo inline.
 *
 * Figures are sample data (labelled "Sample"), not a client's. Photos are
 * Pexels stock (public/ramza/photos/SOURCES.md) — no names or quotes on people. */

import Image from "next/image";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { ct } from "./brand";
import { GATEWAYS, GatewayMark } from "./partner-logos";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const EASE = [0.22, 1, 0.36, 1] as const;
const P = "/ramza/photos";

function Sample() {
  return <span className="rounded-md bg-[#EEF1F7] px-1.5 py-0.5 text-[10px] font-medium text-[#6E6B75]">Sample</span>;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`w-[290px] rounded-[22px] bg-white/95 p-4 text-[#14131C] shadow-[0_30px_70px_-30px_rgba(12,11,18,0.55)] ring-1 ring-black/[0.05] backdrop-blur-xl ${className}`}>
      {children}
    </div>
  );
}

const Row = ({ k, v, tone }: { k: string; v: string; tone?: "neg" | "ok" }) => (
  <div className="flex justify-between text-[12.5px]">
    <span className="text-[#6E6B75]">{k}</span>
    <span className={`font-medium tabular-nums ${tone === "neg" ? "text-[#C2334D]" : tone === "ok" ? "text-[#0E8A5F]" : ""}`}>{v}</span>
  </div>
);

const tabby = GATEWAYS.find((g) => g.key === "tabby")!;
const zoho = GATEWAYS.find((g) => g.key === "zoho")!;

const CHAPTERS = [
  {
    n: "01",
    kicker: "The sale",
    title: "An order ships. The money doesn’t arrive with it.",
    body: "A customer checks out with Tabby on Tuesday. The parcel leaves the same day — but the cash lands days later, bundled with forty other orders, net of fees you never see line by line.",
    img: "px-studio-packing.jpg",
    alt: "Store owner wrapping an online order",
    pos: "50% 40%",
    card: (
      <Card>
        <div className="flex items-center justify-between"><span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#6E6B75]">New order</span><Sample /></div>
        <div className="mt-3 flex items-baseline justify-between"><span className="font-mono text-[13px]">#WA-10482</span><span className="text-[12px] text-[#6E6B75]">Tue 14:22</span></div>
        <div className="mt-3 space-y-1.5"><Row k="Order total" v="AED 1,240.00" /><Row k="Paid with" v="Tabby · 4 instalments" /><Row k="Cash received" v="not yet" tone="neg" /></div>
      </Card>
    ),
  },
  {
    n: "02",
    kicker: "The payout",
    title: "Days later, one deposit for forty orders — minus fees.",
    body: "Tabby, Tamara, Stripe, Telr and your COD courier each settle on their own schedule, in their own file format, after taking their cut. RAMZA reads every payout file and splits it back into the orders inside it.",
    img: "px-card-terminal.jpg",
    alt: "Customer paying by card at a shop counter",
    pos: "50% 50%",
    card: (
      <Card>
        <div className="flex items-center justify-between"><GatewayMark g={tabby} h={24} /><Sample /></div>
        <div className="mt-3 space-y-1.5"><Row k="Orders in payout" v="42" /><Row k="Gross" v="AED 19,860.00" /><Row k="Fees + VAT" v="−AED 1,618.50" tone="neg" /></div>
        <div className="mt-2 flex justify-between border-t border-dashed border-[#E3E7F0] pt-2 text-[12.5px]"><span className="font-medium">Net to bank</span><span className="font-semibold tabular-nums">AED 18,241.50</span></div>
      </Card>
    ),
  },
  {
    n: "03",
    kicker: "The match",
    title: "Order → payout → bank credit. Line by line.",
    body: "Each bank credit is tied to the payout that produced it and every order inside it — fees and VAT split out, currency differences explained. Anything short-paid, missing or booked twice lands on one list.",
    img: "px-statements-calculator.jpg",
    alt: "Bank statements and a calculator on a desk",
    pos: "50% 50%",
    card: (
      <Card>
        <div className="flex items-center justify-between"><span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#6E6B75]">Three-way match</span><Sample /></div>
        <ul className="mt-3 space-y-2 text-[12.5px]">
          {[["42 orders", "AED 19,860.00"], ["Tabby payout", "AED 18,241.50"], ["Bank credit", "AED 18,241.50"]].map(([a, b]) => (
            <li key={a} className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-[#0E8A5F] text-[10px] text-white">✓</span>{a}</span><span className="font-medium tabular-nums">{b}</span></li>
          ))}
        </ul>
        <div className="mt-3 rounded-xl bg-[#E3F4EC] px-3 py-2 text-[12px] font-medium text-[#0E8A5F]">Matched · difference AED 0.00</div>
      </Card>
    ),
  },
  {
    n: "04",
    kicker: "The books",
    title: "An accountant signs off. Zoho is booked.",
    body: "Nothing posts on its own. An accountant reviews the match, you see what will be written, and only then does RAMZA book the payment, the gateway fee, its VAT and any exchange difference — each with a reference you can search.",
    img: "px-accountant-files.jpg",
    alt: "Accountant reviewing files at her desk",
    pos: "40% 40%",
    card: (
      <Card>
        <div className="flex items-center justify-between"><GatewayMark g={zoho} h={28} /><Sample /></div>
        <ul className="mt-3 space-y-1.5 text-[12.5px]">
          {[["42 invoices paid", "19,860.00"], ["Gateway fee", "1,541.43"], ["Input VAT 5%", "77.07"], ["Exchange difference", "0.00"]].map(([a, b]) => (
            <li key={a} className="flex justify-between"><span className="text-[#6E6B75]">{a}</span><span className="font-medium tabular-nums">{b}</span></li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-[#E3E7F0] pt-2 text-[12px]"><span className="text-[#6E6B75]">Reviewed by accountant</span><span className="font-semibold text-[#0E8A5F]">Booked ✓</span></div>
      </Card>
    ),
  },
] as const;

function Chapter({ c, i, onActive }: { c: (typeof CHAPTERS)[number]; i: number; onActive: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  useEffect(() => { if (inView) onActive(i); }, [inView, i, onActive]);
  return (
    <div ref={ref} className="py-10 lg:flex lg:min-h-[78vh] lg:items-center lg:py-0">
      <div>
        {/* phones: the photo + card inline */}
        <div className="relative mb-7 aspect-[4/3] overflow-hidden rounded-[28px] bg-[#E3E7F0] lg:hidden">
          <Image src={`${P}/${c.img}`} alt={c.alt} fill sizes="92vw" className="object-cover" style={{ objectPosition: c.pos }} />
          <div className="absolute bottom-3 left-3 origin-bottom-left scale-[0.78]">{c.card}</div>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-[#4F35E8]">{c.n}</span>
          <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#6E6B75]">{c.kicker}</span>
        </div>
        <h3 className="mt-3 max-w-[20ch] font-[family-name:var(--font-display)] text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-[#14131C] sm:text-[34px]">{c.title}</h3>
        <p className="mt-4 max-w-[30rem] text-[16.5px] leading-relaxed text-[#55525E]">{c.body}</p>
      </div>
    </div>
  );
}

export function StorySection() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const c = CHAPTERS[active];
  return (
    <section id="how" className={`${ct.sectionLight} scroll-mt-24 pb-20 pt-24`}>
      <TrackView section="story" className={ct.container}>
        <Reveal className="max-w-2xl">
          <span className={ct.eyebrow}>How a payout becomes closed books</span>
          <h2 className={`${ct.h2} mt-4`}>From the checkout to the ledger, without the spreadsheet in between.</h2>
        </Reveal>

        <div className="mt-6 grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            {CHAPTERS.map((ch, i) => <Chapter key={ch.n} c={ch} i={i} onActive={setActive} />)}
            <a href="#start" className={`${ct.btnPrimary} mt-4`}>See it on your own payouts <ArrowRight size={16} /></a>
          </div>

          {/* desktop: sticky photo that follows the chapter in view */}
          <div className="relative hidden lg:block">
            <div className="sticky top-24 h-[calc(100vh-8rem)] max-h-[720px]">
              <div className="relative h-full overflow-hidden rounded-[36px] bg-[#E3E7F0]">
                <AnimatePresence initial={false}>
                  <motion.div key={c.img} className="absolute inset-0"
                    initial={{ opacity: 0, scale: reduce ? 1 : 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.8, ease: EASE }}>
                    <Image src={`${P}/${c.img}`} alt={c.alt} fill sizes="620px" className="object-cover" style={{ objectPosition: c.pos }} />
                  </motion.div>
                </AnimatePresence>
                <div className="absolute inset-0 bg-gradient-to-t from-[#14131C]/40 via-transparent to-transparent" />
                <AnimatePresence mode="wait">
                  <motion.div key={c.n} className="absolute bottom-8 left-8"
                    initial={{ opacity: 0, y: reduce ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -10 }}
                    transition={{ duration: reduce ? 0 : 0.45, ease: EASE, delay: reduce ? 0 : 0.15 }}>
                    {c.card}
                  </motion.div>
                </AnimatePresence>
                {/* progress */}
                <div className="absolute right-6 top-6 flex gap-1.5">
                  {CHAPTERS.map((ch, i) => (
                    <span key={ch.n} className={`h-1.5 rounded-full transition-all duration-500 ${i === active ? "w-8 bg-white" : "w-3 bg-white/45"}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </TrackView>
    </section>
  );
}
