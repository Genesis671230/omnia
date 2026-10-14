"use client";

/* Home hero (2026-10-14): the e-invoicing readiness hook.
 *
 *   eyebrow "UAE e-invoicing is coming" · h1 "Your invoice backlog must close
 *   by month end." · one-line sub · buttons (no entrance fade, instant)
 *
 * Full-bleed, dark and high-contrast: real Business Bay / DIFC / office
 * photography cross-fading under a navy scrim, the go-live dates from
 * config/rules.json (EINV), a live month-end countdown (Dubai time), and the
 * WhatsApp + Telegram phones on the right showing the backlog being closed.
 * Primary action stays the free check form (#start). The reconcile tool moved
 * to /ramza/reconcile.
 *
 * Compliance: RAMZA is not an Accredited Service Provider — we clean the
 * books and connect the business to one. No FTA/MoF marks or colours. */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EINV } from "@/lib/ramza/rules";
import { funnel } from "@/lib/ramza/funnel";
import { ChatPhonesPair } from "./chat-phones";

const P = "/ramza/photos";
const SLIDES = [
  { src: `${P}/bb-business-bay-dusk.jpg`, place: "Business Bay, Dubai", pos: "60% 50%" },
  { src: `${P}/bb-difc-towers-night.jpg`, place: "DIFC, Dubai", pos: "55% 40%" },
  { src: `${P}/bb-office-team.jpg`, place: "Finance team, month-end", pos: "50% 40%" },
];

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const millions = (n: number) => `AED ${n / 1_000_000}M`;

/** Time left to the last moment of this month in Dubai (UTC+4, no DST). */
function monthEndLeft(now: number) {
  const dubai = new Date(now + 4 * 3600_000);
  const end = Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() + 1, 1) - 4 * 3600_000;
  const ms = Math.max(0, end - now);
  const label = new Date(end - 1 + 4 * 3600_000).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return { d: Math.floor(ms / 86_400_000), h: Math.floor(ms / 3_600_000) % 24, m: Math.floor(ms / 60_000) % 60, s: Math.floor(ms / 1000) % 60, label };
}

function MonthEndClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now ? monthEndLeft(now) : null;
  const cells: [string, number | undefined][] = [["days", left?.d], ["hrs", left?.h], ["min", left?.m], ["sec", left?.s]];
  return (
    <div className="inline-flex items-center gap-4 rounded-2xl bg-white/[0.07] px-4 py-3 ring-1 ring-white/15 backdrop-blur-md">
      <div className="text-[12px] leading-tight text-white/70">Month end<br /><b className="text-[13px] font-semibold text-white">{left?.label ?? "—"}</b></div>
      <div className="flex gap-1.5">
        {cells.map(([u, v]) => (
          <div key={u} className="w-[52px] rounded-xl bg-[#050B1F]/70 py-1.5 text-center ring-1 ring-white/10">
            <div className="font-[family-name:var(--font-display)] text-[22px] font-semibold leading-none tabular-nums text-white">{v === undefined ? "--" : String(v).padStart(2, "0")}</div>
            <div className="mt-1 text-[9.5px] uppercase tracking-[0.14em] text-white/55">{u}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EInvoicingHero({ whatsappHref }: { whatsappHref: string }) {
  const still = !!useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 7000);
    return () => clearInterval(t);
  }, [still]);
  const s = SLIDES[i];

  return (
    <section className="relative isolate overflow-hidden bg-[#050B1F] text-white">
      {/* photography, slow Ken Burns cross-fade */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <AnimatePresence initial={false}>
          <motion.div key={s.src} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.6, ease: "easeInOut" }}>
            <motion.div className="absolute inset-0" initial={{ scale: 1.04 }} animate={still ? undefined : { scale: 1.14 }} transition={{ duration: 9, ease: "linear" }}>
              <Image src={s.src} alt="" fill priority={i === 0} sizes="100vw" className="object-cover" style={{ objectPosition: s.pos }} />
            </motion.div>
          </motion.div>
        </AnimatePresence>
        {/* navy scrim: solid behind the copy, opening toward the phones */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#050B1F_0%,rgba(5,11,31,0.94)_34%,rgba(5,11,31,0.62)_62%,rgba(5,11,31,0.45)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,11,31,0.7)_0%,transparent_22%,transparent_70%,#050B1F_100%)]" />
        <div className="absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(79,53,232,0.35),transparent_65%)]" />
      </div>

      <div className="relative mx-auto grid w-full max-w-[1240px] items-center gap-12 px-5 pb-16 pt-28 sm:px-8 sm:pt-32 lg:min-h-[min(100svh,900px)] lg:grid-cols-[1.05fr_0.95fr] lg:pb-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[#4F35E8]/25 px-3.5 py-1.5 text-[12.5px] font-medium text-[#DCD6FF] ring-1 ring-[#8F7DFF]/40 backdrop-blur">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5FE0A8] opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#5FE0A8]" /></span>
            UAE e-invoicing is coming
          </span>

          {/* Copy and buttons render instantly — no entrance fade above the fold. */}
          <h1 className="mt-6 max-w-[14ch] font-[family-name:var(--font-display)] text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[54px] lg:text-[60px]">
            Your invoice backlog{" "}
            <span className="relative whitespace-nowrap text-[#B9AEFF]">
              must close
              <motion.span aria-hidden className="absolute -bottom-1 left-0 h-[5px] rounded-full bg-gradient-to-r from-[#7C66FF] to-[#5FE0A8]" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ delay: 0.3, duration: 0.9, ease: "easeOut" }} />
            </span>{" "}
            by month end.
          </h1>

          <p className="mt-5 max-w-[30rem] text-[17px] leading-relaxed text-[#C9CEE0] sm:text-[18px]">
            Open invoices, missing TRNs and unmatched payouts must be cleared before go-live. We clear them — checked by UAE accountants.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#start" onClick={() => funnel("cta_click", { placement: "hero", cta: "readiness_check" })}
              className="inline-flex h-[54px] items-center gap-2 rounded-full bg-white px-7 text-[15.5px] font-semibold text-[#050B1F] shadow-[0_14px_40px_-14px_rgba(124,102,255,0.9)] transition hover:bg-[#ECE9FF]">
              Get my free readiness check <ArrowRight size={17} />
            </a>
            <a href={whatsappHref} onClick={() => funnel("whatsapp_click", { placement: "hero" })}
              className="inline-flex h-[54px] items-center gap-2 rounded-full bg-[#25D366] px-6 text-[15px] font-semibold text-[#06291A] transition hover:bg-[#3BE07A]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 3C7 3 3 6.6 3 11c0 2.3 1.1 4.4 2.9 5.9L5 21l4.3-2.2c.9.2 1.8.3 2.7.3 5 0 9-3.6 9-8s-4-8.1-9-8.1Z" /></svg>
              WhatsApp an accountant
            </a>
          </div>

          <div className="mt-8"><MonthEndClock /></div>

          <dl className="mt-6 grid max-w-[36rem] gap-px overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15 sm:grid-cols-2">
            <div className="bg-[#050B1F]/70 px-4 py-3 backdrop-blur">
              <dt className="text-[11.5px] uppercase tracking-[0.12em] text-white/55">Large businesses · {millions(EINV.largeRevenueAed)}+</dt>
              <dd className="mt-1 text-[14px] text-white">Accredited provider by <b className="font-semibold text-[#5FE0A8]">{day(EINV.largeAspBy)}</b> · live {day(EINV.largeGoLive)}</dd>
            </div>
            <div className="bg-[#050B1F]/70 px-4 py-3 backdrop-blur">
              <dt className="text-[11.5px] uppercase tracking-[0.12em] text-white/55">Everyone else in scope</dt>
              <dd className="mt-1 text-[14px] text-white">Accredited provider by <b className="font-semibold">{day(EINV.smeAspBy)}</b> · live {day(EINV.smeGoLive)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] text-white/55">
            Just want payouts matched? <Link href="/ramza/reconcile" className="font-medium text-white underline decoration-[#7C66FF] decoration-2 underline-offset-4 hover:decoration-white">Try the free reconcile tool →</Link>
          </p>
        </div>

        <div className="relative">
          <ChatPhonesPair />
        </div>
      </div>

      {/* where the photo is */}
      <div className="pointer-events-none absolute bottom-5 right-5 hidden items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-[11.5px] text-white/80 backdrop-blur sm:flex">
        <MapPin size={12} /> <AnimatePresence mode="wait"><motion.span key={s.place} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{s.place}</motion.span></AnimatePresence>
      </div>
    </section>
  );
}
