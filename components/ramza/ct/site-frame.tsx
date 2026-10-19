/* Frame for every RAMZA Corporate Tax page: fonts/tokens (RamzaShell),
   first-party attribution, Meta Pixel, the nav and the footer. */

import Link from "next/link";
import type { ReactNode } from "react";
import { RamzaShell } from "@/components/ramza/ramza-shell";
import { AttributionInit } from "@/components/ramza/attribution-init";
import { CT_MORE, CT_NAV, CT_PENALTY_LINKS, whatsappHref } from "@/lib/ramza/ct-site";
import { CT_LEARN } from "@/lib/ramza/ct-learn";
import { RAMZA_EMAIL, RAMZA_LEGAL_LINE } from "@/lib/ramza/site";
import { CtNav } from "./nav";
import { Pixels } from "./pixels";
import { WhatsAppLink } from "./tracked";
import { ct } from "./brand";
import { RamzaMark } from "./mark";


export function CtSiteFrame({ children }: { children: ReactNode }) {
  const wa = whatsappHref();
  return (
    <RamzaShell>
      <AttributionInit />
      <Pixels />
      {/* One white canvas; the home hero and dark islands carry the navy brand. */}
      <div className="relative bg-[#FFFFFF] font-[family-name:var(--font-plex)]">
        <CtNav whatsappHref={wa} />
        <main>{children}</main>

        <footer className={ct.sectionDark}>
          <div className={`${ct.container} grid gap-10 py-16 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]`}>
            <div>
              <Link href="/ramza" className="inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-[19px] font-bold tracking-[0.16em]">
                <RamzaMark tone="light" /> RAMZA
              </Link>
              <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-[#B8B6C0]">
                Payout reconciliation, e-invoicing readiness and Corporate Tax for UAE e-commerce and retail brands — AI bookkeeping, checked by accountants.
              </p>
              <WhatsAppLink href={wa} placement="footer" className={`${ct.btnWhite} mt-6 h-11 text-[14px]`}>WhatsApp us</WhatsAppLink>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]">Corporate Tax</div>
              <ul className="mt-4 space-y-2.5 text-[14px] text-[#E6E4EA]">
                {[...CT_NAV, ...CT_PENALTY_LINKS].map((l) => <li key={l.href}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>)}
              </ul>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]">Guides</div>
              <ul className="mt-4 space-y-2.5 text-[14px] text-[#E6E4EA]">
                {CT_LEARN.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>)}
              </ul>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]">RAMZA</div>
              <ul className="mt-4 space-y-2.5 text-[14px] text-[#E6E4EA]">
                {CT_MORE.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>)}
                <li><a href={`mailto:${RAMZA_EMAIL}`} className="hover:text-white">{RAMZA_EMAIL}</a></li>
              </ul>
            </div>
          </div>
          <div className={`${ct.container} flex flex-col gap-2 border-t border-white/10 py-6 text-[12px] text-[#8E8B95] sm:flex-row sm:justify-between`}>
            <span>© {new Date().getFullYear()} {RAMZA_LEGAL_LINE}</span>
            <span>General information, not legal advice. Deadlines and amounts follow the FTA’s published rules — confirm your case on EmaraTax.</span>
          </div>
        </footer>
      </div>
    </RamzaShell>
  );
}
