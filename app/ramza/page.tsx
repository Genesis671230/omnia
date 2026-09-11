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
import { Integrations } from "@/components/ramza/integrations";
import { AuditForm } from "@/components/ramza/audit-form";
import { FoundingPartners } from "@/components/ramza/founding-partners";
import { Faq } from "@/components/ramza/faq";
import { Footer } from "@/components/ramza/footer";
import { resolveH1, FAQ } from "@/lib/ramza/copy";

export const metadata: Metadata = {
  metadataBase: new URL("https://ramza.example"),
  title: "RAMZA — Payout reconciliation for Gulf e-commerce",
  description:
    "RAMZA matches Tabby, Tamara, Telr, Stripe and COD payouts to your bank and closes invoices in Zoho Books automatically. Built for UAE and KSA stores.",
  openGraph: {
    title: "RAMZA — Payout reconciliation for Gulf e-commerce",
    description:
      "RAMZA matches Tabby, Tamara, Telr, Stripe and COD payouts to your bank and closes invoices in Zoho Books automatically.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const EMAIL = process.env.NEXT_PUBLIC_RAMZA_EMAIL || "hello@ramza.example";
const LEGAL_LINE = process.env.LEGAL_LINE || "LEGAL_LINE";

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

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "RAMZA",
        description:
          "Payout reconciliation for Gulf e-commerce. Matches gateway payouts to the bank and closes invoices in Zoho Books.",
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

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
      <main>
        <Hero h1={h1} whatsappHref={wa} />
        <VideoIntro />
        <PainStrip />
        <ContrastLine />
        <HowItWorks />
        <Orchestrator />
        <AccountantView />
        <PostingStack />
        <Copilot />
        <Integrations />
        <AuditForm />
        <FoundingPartners />
        <Faq />
      </main>
      <Footer whatsappHref={wa} email={EMAIL} legalLine={LEGAL_LINE} />
    </RamzaShell>
  );
}
