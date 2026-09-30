"use client";

/* Floating pill nav over the dark hero; turns solid once you scroll.
   On phones the links fold into a sheet. */

import { AnimatePresence, motion } from "framer-motion";
import { Menu, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CT_NAV } from "@/lib/ramza/ct-site";
import { track } from "@/lib/ramza/track";

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
          scrolled ? "bg-[#050D2B]/90 shadow-[0_12px_40px_-12px_rgba(5,13,43,0.6)] backdrop-blur-xl" : "bg-white/[0.06] backdrop-blur-md"
        } ring-1 ring-white/10`}
      >
        <Link href="/ramza" className="flex items-center gap-2.5 pl-1 text-[15px] font-semibold tracking-[0.18em] text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2347D9]"><ShieldCheck size={17} /></span>
          RAMZA
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {CT_NAV.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={`rounded-full px-3.5 py-2 text-[13.5px] transition ${path === l.href ? "bg-white/10 text-white" : "text-[#C9D5FF] hover:text-white"}`}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <a href={whatsappHref} onClick={() => track("Contact", { placement: "nav", channel: "whatsapp" })} className="hidden h-10 items-center rounded-full px-4 text-[13.5px] text-white ring-1 ring-white/20 transition hover:bg-white/10 sm:inline-flex">WhatsApp</a>
          <Link href="/ramza#start" className="inline-flex h-10 items-center rounded-full bg-white px-4 text-[13.5px] font-medium text-[#0A1A4A] transition hover:bg-[#EEF3FF]">Start my filing</Link>
          <button onClick={() => setOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white ring-1 ring-white/20 lg:hidden" aria-label="Open menu"><Menu size={18} /></button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mx-auto mt-2 max-w-[1200px] rounded-[28px] bg-[#050D2B] p-4 ring-1 ring-white/10 lg:hidden">
            <div className="mb-2 flex justify-end"><button onClick={() => setOpen(false)} className="p-2 text-white" aria-label="Close menu"><X size={18} /></button></div>
            {CT_NAV.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] text-[#DCE4FF] hover:bg-white/5">{l.label}</Link>
            ))}
            <a href={whatsappHref} onClick={() => track("Contact", { placement: "nav-mobile", channel: "whatsapp" })} className="mt-2 block rounded-2xl bg-[#2347D9] px-4 py-3 text-center text-[15px] font-medium text-white">WhatsApp us</a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
