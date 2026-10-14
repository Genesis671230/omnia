"use client";

/* Floating light pill nav — reads on the light home hero and on the dark
   sub-page heroes alike; gains a shadow once you scroll. On phones the links
   fold into a sheet. */

import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CT_NAV } from "@/lib/ramza/ct-site";
import { funnel } from "@/lib/ramza/funnel";
import { RamzaMark } from "./mark";

export function CtNav({ whatsappHref }: { whatsappHref: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="fixed inset-x-0 top-3 z-50 px-3 sm:top-4">
      <nav
        className={`mx-auto flex max-w-[1200px] items-center justify-between rounded-full px-3 py-2 transition-all duration-300 sm:px-4 ${
          scrolled ? "bg-white/90 shadow-[0_12px_40px_-18px_rgba(20,19,28,0.35)]" : "bg-white/70"
        } ring-1 ring-black/[0.06] backdrop-blur-xl`}
      >
        <Link href="/ramza" className="flex items-center gap-2.5 pl-1 font-[family-name:var(--font-display)] text-[17px] font-bold tracking-[0.16em] text-[#14131C]">
          <RamzaMark />
          RAMZA
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {CT_NAV.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={`rounded-full px-3.5 py-2 text-[13.5px] transition ${path === l.href ? "bg-[#EEF1F7] text-[#14131C]" : "text-[#55525E] hover:text-[#14131C]"}`}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <a href={whatsappHref} onClick={() => funnel("whatsapp_click", { placement: "nav" })} className="hidden h-10 items-center rounded-full px-4 text-[13.5px] text-[#14131C] ring-1 ring-[#DDE2EC] transition hover:bg-[#EEF1F7] sm:inline-flex">WhatsApp</a>
          <Link href="/ramza#start" className="inline-flex h-10 items-center rounded-full bg-[#4F35E8] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#3F26D6]">Free readiness check</Link>
          <button onClick={() => setOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#14131C] ring-1 ring-[#DDE2EC] lg:hidden" aria-label="Open menu"><Menu size={18} /></button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mx-auto mt-2 max-w-[1200px] rounded-[28px] bg-white p-4 shadow-xl ring-1 ring-black/[0.06] lg:hidden">
            <div className="mb-2 flex justify-end"><button onClick={() => setOpen(false)} className="p-2 text-[#14131C]" aria-label="Close menu"><X size={18} /></button></div>
            {CT_NAV.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] text-[#14131C] hover:bg-[#EEF1F7]">{l.label}</Link>
            ))}
            <a href={whatsappHref} onClick={() => funnel("whatsapp_click", { placement: "nav-mobile" })} className="mt-2 block rounded-2xl bg-[#4F35E8] px-4 py-3 text-center text-[15px] font-medium text-white">WhatsApp us</a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
