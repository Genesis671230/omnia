import { allowedStorefrontUrl } from "@/lib/storefront/sites";

export const dynamic = "force-dynamic";

// GET /api/storefront/preview?url=https://omniastores.ae/products/x
// The storefronts send X-Frame-Options: DENY + frame-ancestors 'none', so a
// plain <iframe> stays blank. This serves the page's HTML from our origin as
// a static snapshot for the dashboard's preview frame:
//   - only the three storefront hosts (never an open proxy);
//   - every <script> removed, so the Meta/TikTok/GA pixels never fire a fake
//     PageView from the office and nothing can break out of the frame;
//   - <base href> keeps Shopify CDN images/CSS loading from the real site;
//   - links re-point through this route, so clicking stays in the preview.
export async function GET(req: Request) {
  const url = allowedStorefrontUrl(new URL(req.url).searchParams.get("url"));
  if (!url) return new Response("Only omniastores.com, omniastores.ae and sa.omniastores.ae can be previewed.", { status: 400 });

  let res: Response;
  try {
    res = await fetch(url.href, {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", "Accept-Language": "en,ar;q=0.8" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    return new Response(`Couldn't load ${url.href}: ${(e as Error).message}`, { status: 502 });
  }
  const finalUrl = new URL(res.url || url.href);
  let html = await res.text();

  html = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link[^>]+rel=["'](?:preload|modulepreload|prefetch)["'][^>]*as=["']script["'][^>]*>/gi, "")
    .replace(/<meta[^>]+http-equiv=["'](?:refresh|content-security-policy)["'][^>]*>/gi, "")
    .replace(/\son[a-z]+=("[^"]*"|'[^']*')/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/(href|src|action)=(["'])\s*javascript:[^"']*\2/gi, '$1="#"');

  const redirected = finalUrl.pathname.replace(/\/$/, "") !== url.pathname.replace(/\/$/, "");
  const banner = redirected
    ? `<div style="position:sticky;top:0;z-index:2147483647;background:#A6472F;color:#fff;font:600 13px system-ui;padding:8px 12px">This link redirected: ${url.pathname} → ${finalUrl.pathname} — visitors never see the page they clicked.</div>`
    : "";
  // Absolute: the <base> below points relative URLs at the storefront.
  const self = new URL(req.url).origin;
  const helper = `<base href="${finalUrl.origin}/"><style>html{scroll-behavior:auto}</style>`;
  const nav = `<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.href;if(!/^https?:/.test(h))return;e.preventDefault();location.href=${JSON.stringify(`${self}/api/storefront/preview?url=`)}+encodeURIComponent(h);},true);document.addEventListener("submit",function(e){e.preventDefault();},true);</script>`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${helper}`) : helper + html;
  html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => `${m}${banner}`) : banner + html;
  html = html.replace(/<\/body>/i, `${nav}</body>`);

  return new Response(html, {
    status: res.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=120",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
      "X-Preview-Final-Url": finalUrl.href,
    },
  });
}
