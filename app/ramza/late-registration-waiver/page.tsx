import type { Metadata } from "next";
import Link from "next/link";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { PageHero, CtaSection } from "@/components/ramza/ct/sections";
import { Article } from "@/components/ramza/ct/article";
import { NoticeArt } from "@/components/ramza/ct/art";
import { ct } from "@/components/ramza/ct/brand";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";

export const metadata: Metadata = ctMetadata(
  "/ramza/late-registration-waiver",
  "AED 10,000 late registration penalty waiver — file within 7 months — RAMZA",
  "The FTA cancels the AED 10,000 Corporate Tax late-registration penalty if your first return is filed within 7 months of your first tax period. How it works and how to claim a refund.",
);

export default function WaiverPage() {
  return (
    <CtSiteFrame>
      <PageHero
        eyebrow="Late registration waiver"
        title={<>The AED 10,000 fine can disappear — if you file in time</>}
        lead="Registered late? File your first Corporate Tax return or annual declaration within 7 months of your first tax period ending, and the late-registration penalty is waived automatically."
      >
        <Link href="/ramza/penalty-checker" className={ct.btnWhite}>Find my filing date</Link>
      </PageHero>
      <Article
        aside={<NoticeArt />}
        blocks={[
          {
            h: "How the waiver works",
            p: ["There is no form and no committee. Once the first return (or annual declaration, for exempt persons that must file one) is submitted within 7 months of the end of the first tax period, the AED 10,000 penalty is cancelled on the account."],
            table: [["Financial year ends 31 Dec 2024", "File by 31 Jul 2025"], ["Financial year ends 31 Mar 2025", "File by 31 Oct 2025"], ["Financial year ends 30 Jun 2025", "File by 31 Jan 2026"]],
          },
          {
            h: "Already paid the penalty?",
            p: ["If the fine was paid before filing, a timely return still qualifies. The amount is credited back to your EmaraTax account and a refund can be requested from there."],
          },
          {
            h: "Missed the 7 months?",
            p: ["Then the automatic waiver no longer applies and the penalty stands unless another route works — a reconsideration request within 40 business days of the notice, or a waiver request once everything is registered and filed."],
            list: ["Check the notice date first", "File any overdue return — late filing adds AED 500 a month", "Keep evidence of anything that caused the delay"],
          },
        ]}
      />
      <CtaSection whatsappHref={whatsappHref()} />
    </CtSiteFrame>
  );
}
