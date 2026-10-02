import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import {
  CaseStudySection, FinalCta, HOME_FAQ, HomeFaq, HomeHero, HowSection, PenaltyBand, PeopleSection, ProblemSection, ProofStrip, ServicesGrid,
} from "@/components/ramza/ct/home";
import { EngineShowcase } from "@/components/ramza/ct/engine-showcase";
import { AiOfficeSection } from "@/components/ramza/ct/ai-office";
import { EInvoicingSection } from "@/components/ramza/ct/einvoicing";
import { FreeToolsSection } from "@/components/ramza/ct/free-tools";
import { GrowthSection } from "@/components/ramza/ct/growth";
import { PricingCounter } from "@/components/ramza/ct/pricing-counter";
import { DeadlineTimeline, StakesSection } from "@/components/ramza/ct/editorial";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";
import { faqNode, organizationNode, websiteNode } from "@/lib/ramza/seo";

/* RAMZA home — Corporate Tax filed on time: AI bookkeeping + expert
   accountants. Primary action: the "Start my filing" form in the hero.
   Penalty help is the secondary path (PenaltyBand → /ramza/penalty-checker).
   Section order and the job each does: components/ramza/ct/home.tsx. */

export const metadata: Metadata = ctMetadata(
  "/ramza",
  "Corporate Tax return filed before the deadline — RAMZA",
  "Books behind and the Corporate Tax deadline close? RAMZA's AI bookkeeping and UAE accountants catch up your records and file your return on EmaraTax. Fixed quote before we start.",
);

// Hourly, so the deadline → rescue switch (rules.json campaign dates) goes live on its own.
export const revalidate = 3600;

export default function RamzaHome() {
  const wa = whatsappHref("Hi RAMZA, I need my Corporate Tax return filed.");
  const jsonLd = { "@context": "https://schema.org", "@graph": [organizationNode(), websiteNode(), faqNode(HOME_FAQ)] };
  return (
    <CtSiteFrame>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeHero whatsappHref={wa} />
      <ProofStrip />
      <FreeToolsSection />
      <DeadlineTimeline />
      <EngineShowcase />
      <AiOfficeSection />
      <ProblemSection />
      <HowSection />
      <StakesSection />
      <EInvoicingSection />
      <GrowthSection />
      <CaseStudySection />
      <PricingCounter />
      <ServicesGrid />
      <PeopleSection whatsappHref={wa} />
      <PenaltyBand />
      <HomeFaq />
      <FinalCta whatsappHref={wa} />
    </CtSiteFrame>
  );
}
