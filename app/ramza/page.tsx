import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { FinalCta, HOME_FAQ, HomeFaq, PenaltyBand, PeopleSection, ServicesGrid, StartSection } from "@/components/ramza/ct/home";
import { EInvoicingHero } from "@/components/ramza/ct/einv-hero";
import { EInvoicingSection } from "@/components/ramza/ct/einvoicing";
import { TestimonialsSection } from "@/components/ramza/ct/testimonials";
import { CaseStudySection, TrustLine } from "@/components/ramza/ct/case-study";
import { PricingCounter } from "@/components/ramza/ct/pricing-counter";
import { LogoMarquee } from "@/components/ramza/ct/partner-logos";
import { IndustryProvider } from "@/components/ramza/demo/industry";
import { ProcessFilm } from "@/components/ramza/demo/process-film";
import { IndustryLive } from "@/components/ramza/demo/industry-live";
import { LiveUpdates } from "@/components/ramza/demo/live-updates";
import { ToolsHub } from "@/components/ramza/demo/tools-hub";
import { TrackingDebug } from "@/components/ramza/demo/tracking-debug";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";
import { faqNode, organizationNode, websiteNode } from "@/lib/ramza/seo";

/* RAMZA home (2026-10-14) — e-invoicing readiness first:
 *   1 EInvoicingHero  "E-invoicing is coming. Your invoice backlog must close by
 *                     month end." Business Bay / DIFC photography, go-live
 *                     dates (rules.json), month-end countdown, live WhatsApp +
 *                     Telegram phones
 *   1b CaseStudySection  Omniastores' real September 2026 close: photo header,
 *                     money-flow diagram, before/after (social proof)
 *   1c TestimonialsSection  Muhammad Akmal (co-founder) + animated agent
 *   2 StartSection    the offer: free readiness check form (#start)
 *   3 EInvoicing      5-corner model + the two go-live tracks
 *   4 ProcessFilm / IndustryLive / LiveUpdates / ToolsHub
 *   then clients, services, pricing, people, FAQ, CT rescue band, CTA.
 * The reconcile tool (InstantDemo) lives on /ramza/reconcile.
 * Every interaction is a funnel event (lib/ramza/funnel.ts); ?ramza_debug=1
 * shows the pixels and events live. */

export const metadata: Metadata = ctMetadata(
  "/ramza",
  "UAE e-invoicing readiness — close your invoice backlog by month end | RAMZA",
  "E-invoicing is coming to the UAE. RAMZA closes your invoice backlog, reconciles every gateway payout and connects you to an accredited provider — checked by UAE accountants. Free readiness check.",
);

// Hourly, so the deadline → rescue switch (rules.json campaign dates) goes live on its own.
export const revalidate = 3600;

export default function RamzaHome() {
  const wa = whatsappHref("Hi RAMZA, I want my invoices e-invoicing ready.");
  const jsonLd = { "@context": "https://schema.org", "@graph": [organizationNode(), websiteNode(), faqNode(HOME_FAQ)] };
  return (
    <CtSiteFrame>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <IndustryProvider>
        <EInvoicingHero whatsappHref={wa} />
        <div className="border-b border-[#E3E7F0] bg-white py-6"><TrustLine /><LogoMarquee /></div>
        <CaseStudySection />
        <TestimonialsSection />
        <StartSection focus="einvoicing" />
        <EInvoicingSection />
        <ProcessFilm />
        <IndustryLive />
        <LiveUpdates />
        <ToolsHub />
        <ServicesGrid />
        <PricingCounter />
        <PeopleSection whatsappHref={wa} />
        <HomeFaq />
        <PenaltyBand />
        <FinalCta whatsappHref={wa} />
        <TrackingDebug />
      </IndustryProvider>
    </CtSiteFrame>
  );
}
