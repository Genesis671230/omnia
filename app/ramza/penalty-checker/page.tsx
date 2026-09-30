import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { PageHero, CtaSection, FaqSection } from "@/components/ramza/ct/sections";
import { HeroConsole } from "@/components/ramza/ct/hero-console";
import { WindowArt } from "@/components/ramza/ct/art";
import { ct } from "@/components/ramza/ct/brand";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";

export const metadata: Metadata = ctMetadata(
  "/ramza/penalty-checker",
  "UAE Corporate Tax penalty checker — deadlines & waiver — RAMZA",
  "Enter your penalty notice date and tax period to see your 40-business-day reconsideration deadline, whether the AED 10,000 registration fine can be waived, and your late-filing exposure.",
);

export default function PenaltyCheckerPage() {
  return (
    <CtSiteFrame>
      <PageHero
        eyebrow="Free checker"
        title={<>Where does your penalty stand?</>}
        lead="Three dates, one answer: your reconsideration deadline, whether the late-registration waiver still applies, and what late filing is costing you."
      />
      <section className={`${ct.sectionLight} pb-24 pt-24`}>
        <div className={`${ct.container} grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]`}>
          <HeroConsole />
          <div className="space-y-6">
            <WindowArt used={9} />
            <div className={ct.card}>
              <h2 className="text-[20px] font-medium text-[#0A1A4A]">What the checker uses</h2>
              <ul className={`${ct.body} mt-3 list-disc space-y-1.5 pl-5`}>
                <li>Reconsideration: 40 business days from the notice (Mon–Fri).</li>
                <li>Registration waiver: first return filed within 7 months of the first tax period ending.</li>
                <li>Late filing: return due 9 months after the period ends; AED 500 per month or part month for 12 months, then AED 1,000.</li>
              </ul>
              <p className="mt-4 text-[13px] text-[#8A96BD]">Public holidays aren’t counted, so the real deadline can fall a little later than shown. Nothing you type here is stored unless you send it to us.</p>
            </div>
          </div>
        </div>
      </section>
      <FaqSection />
      <CtaSection whatsappHref={whatsappHref()} />
    </CtSiteFrame>
  );
}
