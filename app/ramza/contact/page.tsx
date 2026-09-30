import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { PageHero, CtaSection } from "@/components/ramza/ct/sections";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";

export const metadata: Metadata = ctMetadata(
  "/ramza/contact",
  "Talk to a Corporate Tax specialist — free penalty review — RAMZA",
  "Send us your Corporate Tax penalty notice or dates. We map your deadlines and options and reply on WhatsApp within one business day.",
);

export default function ContactPage() {
  return (
    <CtSiteFrame>
      <PageHero
        eyebrow="Contact"
        title={<>Tell us what happened</>}
        lead="Share the notice or your dates. We’ll map your deadlines and options and reply on WhatsApp within one business day — free."
      />
      <CtaSection whatsappHref={whatsappHref()} />
    </CtSiteFrame>
  );
}
