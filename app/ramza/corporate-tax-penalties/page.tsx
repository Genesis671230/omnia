import type { Metadata } from "next";
import Link from "next/link";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { PageHero, CtaSection, RoutesSection } from "@/components/ramza/ct/sections";
import { Article } from "@/components/ramza/ct/article";
import { ct } from "@/components/ramza/ct/brand";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";

export const metadata: Metadata = ctMetadata(
  "/ramza/corporate-tax-penalties",
  "UAE Corporate Tax penalties explained — amounts & how to clear them — RAMZA",
  "The main UAE Corporate Tax penalties — late registration, late filing — what they cost, and the three routes to clear or reduce them.",
);

export default function PenaltiesPage() {
  return (
    <CtSiteFrame>
      <PageHero
        eyebrow="Corporate Tax penalties"
        title={<>What each penalty costs — and how to get out of it</>}
        lead="Most Corporate Tax penalties come from two things: registering late and filing late. Both have fixed amounts, and both have ways out if you act inside the windows."
      >
        <Link href="/ramza/penalty-checker" className={ct.btnWhite}>Check my penalty</Link>
      </PageHero>
      <Article
        blocks={[
          {
            h: "Late registration",
            p: ["A business that registers for Corporate Tax after its registration deadline receives a fixed administrative penalty."],
            table: [["Penalty", "AED 10,000"], ["Can it be waived?", "Yes — file the first return within 7 months"], ["Already paid?", "Credited back, refundable"]],
            note: "The waiver is automatic: there is no application form. It applies when the first Corporate Tax return or annual declaration is filed within 7 months of the first tax period ending.",
          },
          {
            h: "Late filing",
            p: ["A Corporate Tax return is due within 9 months of the end of the tax period. Filing after that adds a monthly penalty until it is filed."],
            table: [["Months 1 – 12 late", "AED 500 per month or part month"], ["From month 13", "AED 1,000 per month"], ["Example: 3 months late", "AED 1,500"]],
          },
          {
            h: "Other penalties",
            p: ["Penalties can also apply to incorrect returns, record-keeping failures and late payment. The amounts vary by violation; the notice states the article and the amount applied."],
            list: ["Read the violation named on the notice", "Check the notice date — it starts the 40-business-day window", "Keep every document that explains what happened"],
          },
          {
            h: "Before you pay — check the windows",
            p: ["Paying a penalty doesn’t close every door, but acting early keeps more of them open: the reconsideration window runs 40 business days from the notice, and the registration waiver depends on when the first return is filed."],
            note: "General information based on the FTA’s published rules, not legal advice.",
          },
        ]}
      />
      <RoutesSection />
      <CtaSection whatsappHref={whatsappHref()} />
    </CtSiteFrame>
  );
}
