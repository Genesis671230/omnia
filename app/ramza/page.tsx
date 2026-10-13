import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import {
  CaseStudySection, FinalCta, HOME_FAQ, HomeFaq, HomeHero, PenaltyBand, PeopleSection, ServicesGrid, StartSection,
} from "@/components/ramza/ct/home";
import { EngineShowcase } from "@/components/ramza/ct/engine-showcase";
import { AiOfficeSection } from "@/components/ramza/ct/ai-office";
import { EInvoicingSection } from "@/components/ramza/ct/einvoicing";
import { StorySection } from "@/components/ramza/ct/story";
import { TestimonialsSection } from "@/components/ramza/ct/testimonials";
import { FreeToolsSection } from "@/components/ramza/ct/free-tools";
import { GrowthSection } from "@/components/ramza/ct/growth";
import { PricingCounter } from "@/components/ramza/ct/pricing-counter";
import { DeadlineTimeline, StakesSection } from "@/components/ramza/ct/editorial";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";
import { faqNode, organizationNode, websiteNode } from "@/lib/ramza/seo";

/* RAMZA home — multi-gateway payout reconciliation + e-invoicing readiness
   for UAE e-commerce and retail brands; Corporate Tax and penalty help follow.
   Primary action: the form in <StartSection> (#start), right under the hero.
   Section order and the job each does: components/ramza/ct/home.tsx. */

export const metadata: Metadata = ctMetadata(
  "/ramza",
  "Gateway payout reconciliation & e-invoicing for UAE e-commerce — RAMZA",
  "Tabby, Tamara, Stripe, Telr and COD payouts matched to orders and the bank, booked in Zoho, and invoice data made e-invoicing ready — checked by UAE accountants. Free reconciliation check.",
);

// Hourly, so the deadline → rescue switch (rules.json campaign dates) goes live on its own.
export const revalidate = 3600;

export default function RamzaHome() {
  const wa = whatsappHref("Hi RAMZA, I need my gateway payouts reconciled.");
  const jsonLd = { "@context": "https://schema.org", "@graph": [organizationNode(), websiteNode(), faqNode(HOME_FAQ)] };
  return (
    <CtSiteFrame>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeHero whatsappHref={wa} />
      <StartSection />
      <StorySection />
      <EngineShowcase />
      <EInvoicingSection />
      <TestimonialsSection />
      <ServicesGrid />
      <FreeToolsSection />
      <AiOfficeSection />
      <GrowthSection />
      <CaseStudySection />
      <PricingCounter />
      <PeopleSection whatsappHref={wa} />
      <DeadlineTimeline />
      <StakesSection />
      <PenaltyBand />
      <HomeFaq />
      <FinalCta whatsappHref={wa} />
    </CtSiteFrame>
  );
}
