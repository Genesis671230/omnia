"use client";

/* First-party attribution. On the first /ramza visit we capture Meta ad
   parameters into a 90-day cookie so a lead submitted days later still carries
   its campaign. Read back by the audit form. */

const COOKIE = "ramza_attr";
const MAX_AGE = 60 * 60 * 24 * 90;

export type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  fbc?: string;
  fbp?: string;
  referrer?: string;
  landing_path?: string;
};

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function fbpFromBrowser(): string | undefined {
  return readCookie("_fbp") || undefined;
}

/** Call once on mount. Writes the cookie only if it does not already exist. */
export function ensureAttribution(): void {
  if (typeof window === "undefined") return;
  if (readCookie(COOKIE)) return;

  const p = new URLSearchParams(window.location.search);
  const fbclid = p.get("fbclid");
  const attr: Attribution = {
    utm_source: p.get("utm_source") || undefined,
    utm_medium: p.get("utm_medium") || undefined,
    utm_campaign: p.get("utm_campaign") || undefined,
    utm_content: p.get("utm_content") || undefined,
    fbc: fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined,
    referrer: document.referrer || undefined,
    landing_path: window.location.pathname || undefined,
  };

  // drop empties
  const clean = Object.fromEntries(
    Object.entries(attr).filter(([, v]) => Boolean(v)),
  );

  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(clean))}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
  } catch {
    /* cookies blocked — fine, form falls back to live params */
  }
}

/** Best-effort read for the form. Merges the stored cookie with the live _fbp. */
export function getAttribution(): Attribution {
  let stored: Attribution = {};
  const raw = readCookie(COOKIE);
  if (raw) {
    try {
      stored = JSON.parse(raw) as Attribution;
    } catch {
      /* ignore */
    }
  }
  const fbp = fbpFromBrowser();
  return { ...stored, ...(fbp ? { fbp } : {}) };
}
