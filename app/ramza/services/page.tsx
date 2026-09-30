import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { PageHero, CtaSection, ServicesSection, WhySection } from "@/components/ramza/ct/sections";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";

export const metadata: Metadata = ctMetadata(
  "/ramza/services",
  "Corporate Tax filing, bookkeeping & penalty services — RAMZA",
  "Penalty review, Arabic reconsideration requests, Corporate Tax registration and returns, waiver and instalment requests, and bookkeeping that keeps you compliant.",
);

export default function ServicesPage() {
  return (
    <CtSiteFrame>
      <PageHero
        eyebrow="Services"
        title={<>Your Corporate Tax, handled end to end</>}
        lead="AI bookkeeping, accountant-reviewed returns filed on time, and penalty help when a deadline slipped. Free review first, fixed quote before any work."
      />
      <ServicesSection openFirst />
      <WhySection />
      <CtaSection whatsappHref={whatsappHref()} />
    </CtSiteFrame>
  );
}
