import type { Metadata } from "next";
import Script from "next/script";
import { RamzaShell } from "@/components/ramza/ramza-shell";
import { AttributionInit } from "@/components/ramza/attribution-init";
import { Nav } from "@/components/ramza/nav";
import { Hero } from "@/components/ramza/hero";
import { PainStrip } from "@/components/ramza/pain-strip";
import { ContrastLine } from "@/components/ramza/contrast-line";
import { HowItWorks } from "@/components/ramza/how-it-works";
import { VideoIntro } from "@/components/ramza/video-intro";
import { Orchestrator } from "@/components/ramza/orchestrator";
import { PostingStack } from "@/components/ramza/posting-stack";
import { AccountantView } from "@/components/ramza/accountant-view";
import { Copilot } from "@/components/ramza/copilot";
import { Outcomes } from "@/components/ramza/outcomes";
import { AccountantReview } from "@/components/ramza/accountant-review";
import { ValueCalculator } from "@/components/ramza/value-calculator";
import { Integrations } from "@/components/ramza/integrations";
import { AuditForm } from "@/components/ramza/audit-form";
import { FoundingPartners } from "@/components/ramza/founding-partners";
import { Faq } from "@/components/ramza/faq";
import { Footer } from "@/components/ramza/footer";
import { resolveH1, FAQ } from "@/lib/ramza/copy";
import { landingMetadata, landingJsonLd, faqNode } from "@/lib/ramza/seo";
import { RAMZA_EMAIL, RAMZA_LEGAL_LINE } from "@/lib/ramza/site";

/* Title, canonical, OG and Twitter all come from lib/ramza/seo so the landing
   page and every /ramza/* content page stay consistent. Two things that module
   fixes and this block did not: the root layout's "%s · Omnia Finance OS"
   template was silently appended to the title here, and the ?h= headline
   variants were each separately indexable with no canonical pointing home. */
export const metadata: Metadata = landingMetadata();

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;


function whatsappHref(): string {
  if (!WHATSAPP) return "#audit";
  const digits = WHATSAPP.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}`;
}

export default async function RamzaPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string | string[] }>;
}) {
  const sp = await searchParams;
  const h1 = resolveH1(sp.h);
  const wa = whatsappHref();

  /* Organization + WebSite + SoftwareApplication from the shared graph, with
     this page's FAQ appended. The nodes cross-reference by @id rather than
     repeating the org details in every node. */
  const base = landingJsonLd();
  const jsonLd = { ...base, "@graph": [...base["@graph"], faqNode(FAQ)] };

  return (
    <RamzaShell>
      <AttributionInit />

      {PIXEL_ID && (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`!function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
          </Script>
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              alt=""
              src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Nav whatsappHref={wa} />
      {/* Arc: name the pain, turn, show it, explain the mechanism, state the
          payoff, prove compatibility, price it, clear objections, then ask.
          The walkthrough sits after the turn so there is a reason to watch. */}
      <main>
        <Hero h1={h1} whatsappHref={wa} />
        <PainStrip />
        <ContrastLine />
        <VideoIntro />
        <HowItWorks />
        <Orchestrator />
        <AccountantView />
        <PostingStack />
        <Copilot />
        <Outcomes />
        <AccountantReview />
        <Integrations />
        <ValueCalculator />
        <FoundingPartners />
        <Faq />
        <AuditForm />
      </main>
      <Footer whatsappHref={wa} email={RAMZA_EMAIL} legalLine={RAMZA_LEGAL_LINE} />
    </RamzaShell>
  );
}
