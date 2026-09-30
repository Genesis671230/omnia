import type { Metadata } from "next";
import Link from "next/link";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { PageHero, CtaSection } from "@/components/ramza/ct/sections";
import { Article } from "@/components/ramza/ct/article";
import { WindowArt } from "@/components/ramza/ct/art";
import { ct } from "@/components/ramza/ct/brand";
import { ctMetadata } from "@/lib/ramza/ct-seo";
import { whatsappHref } from "@/lib/ramza/ct-site";

export const metadata: Metadata = ctMetadata(
  "/ramza/reconsideration",
  "FTA penalty reconsideration: the 40-business-day window — RAMZA",
  "How to ask the FTA to reconsider a Corporate Tax penalty: the 40-business-day deadline, valid grounds, the Arabic submission on EmaraTax and what happens next.",
);

export default function ReconsiderationPage() {
  return (
    <CtSiteFrame>
      <PageHero
        eyebrow="Reconsideration"
        title={<>40 business days to ask the FTA to think again</>}
        lead="If you believe a penalty is wrong, you can ask the FTA to reconsider it — but only within 40 business days of being notified. It is a request with evidence, not an automatic cancellation."
      >
        <Link href="/ramza/penalty-checker" className={ct.btnWhite}>Count my business days</Link>
      </PageHero>
      <Article
        aside={<div className="space-y-6"><WindowArt used={20} /></div>}
        blocks={[
          {
            h: "The deadline",
            p: ["The request must be submitted within 40 business days from the date you were notified of the penalty. Business days are Monday to Friday — so it is roughly eight calendar weeks. Public holidays push the date a little later."],
            note: "Miss it and this route closes. Other routes — a penalty waiver request or instalments — may still be possible once the underlying issue is fixed.",
          },
          {
            h: "Grounds that tend to work",
            list: [
              "A documented EmaraTax or system failure that stopped you filing or registering",
              "A deadline or tax period communicated to you incorrectly",
              "A tax period or registration set up wrongly by mistake",
              "Circumstances genuinely outside your control, with proof",
            ],
            p: ["What matters is a clear timeline and documents that support it. A short, precise statement beats a long one."],
          },
          {
            h: "How it is submitted",
            list: [
              "Log in to EmaraTax and open the Reconsideration request",
              "State the grounds in Arabic (or attach a legal Arabic translation)",
              "Attach the evidence — screenshots, emails, letters, bank records",
              "Submit before the 40th business day and keep the reference",
            ],
          },
          {
            h: "If the FTA says no",
            p: ["The FTA’s decision on the request can be objected to before the Tax Disputes Resolution Committee, within its own deadline from the decision. The committee generally expects the reconsideration step to have been taken first."],
            note: "General information based on the published rules, not legal advice. We confirm the exact dates for your notice in the free review.",
          },
        ]}
      />
      <CtaSection whatsappHref={whatsappHref()} />
    </CtSiteFrame>
  );
}
