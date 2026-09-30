/* One call → every ad platform that is switched on.
 *
 *   track("Lead", { value: 1, eventId })
 *
 * Which platforms receive it is decided by env vars (set any subset):
 *   NEXT_PUBLIC_META_PIXEL_ID        Meta Pixel (+ server CAPI in app/api/lead/*)
 *   NEXT_PUBLIC_TIKTOK_PIXEL_ID      TikTok Pixel
 *   NEXT_PUBLIC_GTM_ID               Google Tag Manager — every event also goes to dataLayer
 *   NEXT_PUBLIC_GOOGLE_ADS_ID        Google Ads (AW-…) via gtag
 *   NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL  conversion label fired on "Lead"
 *
 * Events the RAMZA pages fire (optimise ad sets on Lead):
 *   Lead            form submitted (deduped with CAPI via eventId)
 *   Contact         WhatsApp button clicked
 *   FormStart       first field of a lead form touched (custom)
 *   CheckerComplete penalty checker shown a result (custom)
 *   SectionView     a tracked section scrolled into view (custom, { section })
 *   ViewContent     the case study or pricing-intent sections viewed */

type Params = Record<string, unknown> & { eventId?: string };

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    ttq?: { track: (event: string, params?: Record<string, unknown>) => void };
    gtag?: (...args: unknown[]) => void;
    dataLayer?: Record<string, unknown>[];
  }
}

const META_STANDARD = new Set(["Lead", "Contact", "ViewContent", "InitiateCheckout", "CompleteRegistration", "Schedule"]);
const TIKTOK_MAP: Record<string, string> = { Lead: "SubmitForm", Contact: "Contact", ViewContent: "ViewContent", FormStart: "ClickButton" };

export function track(event: string, params: Params = {}): void {
  if (typeof window === "undefined") return;
  const { eventId, ...rest } = params;
  try {
    // Meta: standard events via track, the rest via trackCustom. eventID dedupes with CAPI.
    if (window.fbq) {
      if (META_STANDARD.has(event)) window.fbq("track", event, rest, eventId ? { eventID: eventId } : undefined);
      else window.fbq("trackCustom", event, rest);
    }
    // TikTok: only the events it understands.
    if (window.ttq && TIKTOK_MAP[event]) window.ttq.track(TIKTOK_MAP[event], { ...rest, event_id: eventId });
    // Google Ads conversion on Lead.
    const ads = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
    const label = process.env.NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL;
    if (window.gtag && ads && label && event === "Lead") window.gtag("event", "conversion", { send_to: `${ads}/${label}`, transaction_id: eventId });
    // GTM / GA4: everything lands in dataLayer as ramza_<event>.
    (window.dataLayer ??= []).push({ event: `ramza_${event}`, event_id: eventId, ...rest });
  } catch {
    /* tracking must never break the page */
  }
}

/** Fire once per page load per key (e.g. FormStart, SectionView:hero). */
const fired = new Set<string>();
export function trackOnce(key: string, event: string, params: Params = {}): void {
  if (fired.has(key)) return;
  fired.add(key);
  track(event, params);
}
