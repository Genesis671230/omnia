import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { LogoMarquee } from "@/components/ramza/ct/partner-logos";
import { IndustryProvider } from "@/components/ramza/demo/industry";
import { InstantDemo } from "@/components/ramza/demo/instant-demo";
import { ProcessFilm } from "@/components/ramza/demo/process-film";
import { TrackingDebug } from "@/components/ramza/demo/tracking-debug";
import { ctMetadata } from "@/lib/ramza/ct-seo";

/* The free reconcile tool (moved off the home hero 2026-10-14): drop a CSV or
 * try your industry's demo month, watch the run, get the report by email.
 * Home now leads with the e-invoicing readiness hook. */

export const metadata: Metadata = ctMetadata(
  "/ramza/reconcile",
  "Free payout reconciliation tool — RAMZA",
  "Drop a Stripe, Shopify Payments, Tabby, Tamara or bank export — or try your industry's demo — and watch payouts matched to invoices, fees and VAT split, currencies converted and the bank ticked off. Free, in your browser.",
);

export default function ReconcilePage() {
  return (
    <CtSiteFrame>
      <IndustryProvider>
        <div className="pt-16 sm:pt-20">
          <InstantDemo />
        </div>
        <div className="pb-4"><LogoMarquee /></div>
        <ProcessFilm />
        <TrackingDebug />
      </IndustryProvider>
    </CtSiteFrame>
  );
}
