"use client";

/* Floating light pill nav — reads on the light home hero and on the dark
   sub-page heroes alike; gains a shadow once you scroll.
   2026-10-20: three menus (Product, Free tools, Corporate Tax) + Pricing.
   Each menu opens a panel of picture cards (photo, title, one line) and one
   feature card, so a visitor sees what's behind a link before clicking.
   On phones the menus fold into an accordion sheet with thumbnails. */

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CT_MENU, CT_NAV_LINKS, type Menu as MenuT } from "@/lib/ramza/ct-site";
import { funnel } from "@/lib/ramza/funnel";
import { RamzaMark } from "./mark";

function Panel({ m, onPick }: { m: MenuT; onPick: () => void }) {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_300px]">
      <div className="grid grid-cols-2 gap-2">
        {m.items.map((it) => (
          <Link key={it.href} href={it.href} onClick={onPick} className="group flex gap-3 rounded-[10px] p-2.5 transition hover:bg-[#F4F5F8]">
            <span className="relative h-[68px] w-[96px] shrink-0 overflow-hidden rounded-[6px] bg-[#EEF1F7]">
              <Image src={it.img} alt="" fill sizes="96px" className="object-cover transition duration-500 group-hover:scale-105" />
            </span>
            <span className="min-w-0">
              <b className="block text-[14px] font-semibold text-[#14131C]">{it.label}</b>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-[#5B6475]">{it.desc}</span>
            </span>
          </Link>
        ))}
      </div>
      <Link href={m.feature.href} onClick={onPick} className="group relative flex min-h-[200px] flex-col justify-end overflow-hidden rounded-[10px] bg-[#0B1533] p-4 text-white">
        <Image src={m.feature.img} alt="" fill sizes="300px" className="object-cover transition duration-700 group-hover:scale-105" />
        <span className="absolute inset-0 bg-[#0B1533]/60" />
        <span className="relative">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#C4CAD9]">{m.feature.eyebrow}</span>
          <b className="mt-1 block text-[16px] font-semibold">{m.feature.label}</b>
          <span className="mt-1 block text-[12.5px] leading-snug text-[#D5D9E4]">{m.feature.desc}</span>
        </span>
      </Link>
    </div>
  );
}

export function CtNav({ whatsappHref }: { whatsappHref: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [mobileGroup, setMobileGroup] = useState<number | null>(0);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const path = usePathname();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (menu === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onDown = (e: PointerEvent) => { if (!headerRef.current?.contains(e.target as Node)) setMenu(null); };
    const onScroll = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, { passive: true, once: true });
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); window.removeEventListener("scroll", onScroll); };
  }, [menu]);

  const enter = (i: number) => { if (closeT.current) clearTimeout(closeT.current); setMenu(i); };
  const leave = () => { closeT.current = setTimeout(() => setMenu(null), 160); };

  return (
    <header ref={headerRef} className="fixed inset-x-0 top-3 z-50 px-3 sm:top-4" onMouseLeave={leave}>
      <nav
        className={`mx-auto flex max-w-[1200px] items-center justify-between rounded-full px-3 py-2 transition-all duration-300 sm:px-4 ${
          scrolled || menu !== null ? "bg-white shadow-[0_12px_40px_-18px_rgba(20,19,28,0.35)]" : "bg-white/70"
        } ring-1 ring-black/[0.06] backdrop-blur-xl`}
      >
        <Link href="/ramza" className="flex items-center gap-2.5 pl-1 font-[family-name:var(--font-display)] text-[17px] font-bold tracking-[0.16em] text-[#14131C]">
          <RamzaMark />
          RAMZA
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {CT_MENU.map((m, i) => (
            <li key={m.label} onMouseEnter={() => enter(i)}>
              <button
                type="button"
                onClick={() => setMenu(menu === i ? null : i)}
                aria-expanded={menu === i}
                className={`inline-flex items-center gap-1 rounded-full px-3.5 py-2 text-[13.5px] transition ${menu === i ? "bg-[#EEF1F7] text-[#14131C]" : "text-[#55525E] hover:text-[#14131C]"}`}
              >
                {m.label}
                <ChevronDown size={14} className={`transition ${menu === i ? "rotate-180" : ""}`} />
              </button>
            </li>
          ))}
          {CT_NAV_LINKS.map((l) => (
            <li key={l.href} onMouseEnter={() => setMenu(null)}>
              <Link href={l.href} className={`rounded-full px-3.5 py-2 text-[13.5px] transition ${path === l.href ? "bg-[#EEF1F7] text-[#14131C]" : "text-[#55525E] hover:text-[#14131C]"}`}>{l.label}</Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <a href={whatsappHref} onClick={() => funnel("whatsapp_click", { placement: "nav" })} className="hidden h-10 items-center rounded-full px-4 text-[13.5px] text-[#14131C] ring-1 ring-[#DDE2EC] transition hover:bg-[#EEF1F7] sm:inline-flex">WhatsApp</a>
          <Link href="/ramza#start" className="inline-flex h-10 items-center rounded-full bg-[#4F35E8] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#3F26D6]">Free readiness check</Link>
          <button onClick={() => setOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#14131C] ring-1 ring-[#DDE2EC] lg:hidden" aria-label="Open menu"><Menu size={18} /></button>
        </div>
      </nav>

      {/* desktop panel */}
      <AnimatePresence>
        {menu !== null && (
          <motion.div
            key={menu}
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}
            onMouseEnter={() => enter(menu)}
            className="mx-auto mt-2 hidden max-w-[1200px] overflow-hidden rounded-[16px] bg-white shadow-[0_24px_60px_-24px_rgba(11,21,51,0.45)] ring-1 ring-black/[0.06] lg:block"
          >
            <Panel m={CT_MENU[menu]} onPick={() => setMenu(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* phone sheet */}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mx-auto mt-2 max-h-[calc(100svh-90px)] max-w-[1200px] overflow-y-auto rounded-[20px] bg-white p-3 shadow-xl ring-1 ring-black/[0.06] lg:hidden">
            <div className="mb-1 flex justify-end"><button onClick={() => setOpen(false)} className="p-2 text-[#14131C]" aria-label="Close menu"><X size={18} /></button></div>
            {CT_MENU.map((m, gi) => (
              <div key={m.label} className="border-b border-[#EEF1F7] last:border-0">
                <button type="button" onClick={() => setMobileGroup(mobileGroup === gi ? null : gi)} aria-expanded={mobileGroup === gi}
                  className="flex w-full items-center justify-between px-3 py-3 text-[15px] font-semibold text-[#14131C]">
                  {m.label}<ChevronDown size={16} className={`transition ${mobileGroup === gi ? "rotate-180" : ""}`} />
                </button>
                {mobileGroup === gi && (
                  <div className="pb-2">
                    {[...m.items, m.feature].map((it) => (
                      <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-[#F4F5F8]">
                        <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-[6px] bg-[#EEF1F7]"><Image src={it.img} alt="" fill sizes="64px" className="object-cover" /></span>
                        <span className="min-w-0">
                          <b className="block text-[14px] font-semibold text-[#14131C]">{it.label}</b>
                          <span className="block truncate text-[12.5px] text-[#5B6475]">{it.desc}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {CT_NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block px-3 py-3 text-[15px] font-semibold text-[#14131C]">{l.label}</Link>
            ))}
            <a href={whatsappHref} onClick={() => funnel("whatsapp_click", { placement: "nav-mobile" })} className="mt-2 block rounded-2xl bg-[#4F35E8] px-4 py-3 text-center text-[15px] font-medium text-white">WhatsApp us</a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
