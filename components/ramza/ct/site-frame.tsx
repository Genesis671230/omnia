/* Frame for every RAMZA Corporate Tax page: fonts/tokens (RamzaShell),
   first-party attribution, Meta Pixel, the nav and the footer. */

import Link from "next/link";
import type { ReactNode } from "react";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { RamzaShell } from "@/components/ramza/ramza-shell";
import { AttributionInit } from "@/components/ramza/attribution-init";
import { CT_MORE, CT_NAV, CT_PENALTY_LINKS, whatsappHref } from "@/lib/ramza/ct-site";
import { RAMZA_EMAIL, RAMZA_LEGAL_LINE } from "@/lib/ramza/site";
import { CtNav } from "./nav";
import { Pixels } from "./pixels";
import { WhatsAppLink } from "./tracked";
import { ct } from "./brand";


export function CtSiteFrame({ children }: { children: ReactNode }) {
  const wa = whatsappHref();
  return (
    <RamzaShell>
      <AttributionInit />
      <Pixels />

      {/* Solid ground so the old RAMZA backdrop never shows through */}
      <div className="bg-[#F7F9FE] font-[family-name:var(--font-plex)]">
        <CtNav whatsappHref={wa} />
        <main>{children}</main>

        <footer className={ct.sectionDark}>
          <div className={`${ct.container} grid gap-10 py-16 md:grid-cols-[1.3fr_1fr_1fr]`}>
            <div>
              <Link href="/ramza" className="inline-flex items-center gap-2.5 text-[18px] font-semibold tracking-[0.18em]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2347D9]"><ShieldCheck size={18} /></span> RAMZA
              </Link>
              <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-[#B9C6EE]">
                Corporate Tax filed on time for UAE businesses — AI bookkeeping, expert accountants, and help with penalties when a deadline was missed.
              </p>
              <WhatsAppLink href={wa} placement="footer" className={`${ct.btnWhite} mt-6 h-11 text-[14px]`}><MessageCircle size={16} /> WhatsApp us</WhatsAppLink>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#8FB0FF]">Corporate Tax</div>
              <ul className="mt-4 space-y-2.5 text-[14px] text-[#DCE4FF]">
                {[...CT_NAV, ...CT_PENALTY_LINKS].map((l) => <li key={l.href}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>)}
              </ul>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#8FB0FF]">RAMZA</div>
              <ul className="mt-4 space-y-2.5 text-[14px] text-[#DCE4FF]">
                {CT_MORE.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>)}
                <li><a href={`mailto:${RAMZA_EMAIL}`} className="hover:text-white">{RAMZA_EMAIL}</a></li>
              </ul>
            </div>
          </div>
          <div className={`${ct.container} flex flex-col gap-2 border-t border-white/10 py-6 text-[12px] text-[#8A96BD] sm:flex-row sm:justify-between`}>
            <span>© {new Date().getFullYear()} {RAMZA_LEGAL_LINE}</span>
            <span>General information, not legal advice. Deadlines and amounts follow the FTA’s published rules — confirm your case on EmaraTax.</span>
          </div>
        </footer>
      </div>
    </RamzaShell>
  );
}
