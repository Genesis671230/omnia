// What's tracking the storefronts: the Meta pixels behind each ad account
// (and when each last fired) plus the tags each site actually loads. Answers
// "is the pixel alive?" before anyone trusts a pixel-reported number.

import { accountGroups } from "./meta";
import { getShopifyStores } from "@/lib/integrations/shopify";

const BASE = "https://graph.facebook.com/v21.0";
const CACHE_MS = 6 * 60 * 60 * 1000;

export type PixelStatus = { id: string; name: string; account: string; lastFired: string | null; hoursSinceFired: number | null };
export type SiteTags = { site: string; url: string; tags: string[]; error?: string };

const TAG_PATTERNS: [string, RegExp][] = [
  ["Meta Pixel", /connect\.facebook\.net|fbq\(/],
  ["TikTok Pixel", /analytics\.tiktok\.com|ttq\.load/],
  ["Snap Pixel", /sc-static\.net|snaptr\(/],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js/],
  ["Google Analytics 4", /googletagmanager\.com\/gtag\/js\?id=G-/],
  ["Google Ads", /googletagmanager\.com\/gtag\/js\?id=AW-|AW-\d{6,}/],
  ["Microsoft Clarity", /clarity\.ms/],
  ["Klaviyo", /klaviyo/],
  ["Shopify customer events", /web-pixels-manager|webPixelsConfigList/],
];

let cache: { at: number; value: { pixels: PixelStatus[]; sites: SiteTags[] } } | null = null;

export async function trackingCheck(): Promise<{ pixels: PixelStatus[]; sites: SiteTags[] }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const pixels = new Map<string, PixelStatus>();
  await Promise.all(accountGroups().flatMap((g) => g.adAccountIds.map(async (id) => {
    try {
      const url = `${BASE}/act_${id.replace(/^act_/, "")}/adspixels?${new URLSearchParams({ fields: "id,name,last_fired_time", access_token: g.accessToken })}`;
      const json = await fetch(url, { cache: "no-store" }).then((r) => r.json());
      for (const p of json.data ?? []) {
        const last = p.last_fired_time ? new Date(p.last_fired_time).toISOString() : null;
        const prev = pixels.get(p.id);
        if (!prev || (last && (!prev.lastFired || last > prev.lastFired))) {
          pixels.set(p.id, { id: p.id, name: p.name, account: id, lastFired: last, hoursSinceFired: last ? Math.round((Date.now() - Date.parse(last)) / 3600_000) : null });
        }
      }
    } catch { /* an unreachable account shows up on the explorer's account list */ }
  })));

  const sites: SiteTags[] = await Promise.all(getShopifyStores().map(async (s) => {
    const url = s.code === "MAIN" ? "https://omniastores.com" : s.url.startsWith("http") ? s.url : `https://${s.url}`;
    try {
      const html = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (tracking check)" }, cache: "no-store", signal: AbortSignal.timeout(15_000) }).then((r) => r.text());
      return { site: s.code, url, tags: TAG_PATTERNS.filter(([, re]) => re.test(html)).map(([name]) => name) };
    } catch (e) {
      return { site: s.code, url, tags: [], error: (e as Error).message };
    }
  }));

  const value = { pixels: [...pixels.values()].sort((a, b) => (b.lastFired ?? "").localeCompare(a.lastFired ?? "")), sites };
  cache = { at: Date.now(), value };
  return value;
}
