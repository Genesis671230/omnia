/* RAMZA outbound — prospect list builder (Apify → signals → Instantly CSV).
 *
 *   npx tsx --env-file=.env.local scripts/ramza/prospects.ts \
 *     --queries "online store,abaya shop,perfume shop" --location "Dubai, United Arab Emirates" \
 *     --per-query 50 [--instagram] [--out ~/Downloads/ramza-prospects.csv]
 *
 * 1. Discover: Apify compass/crawler-google-places (businesses with a website,
 *    open, + public business emails/socials from their site).
 * 2. Qualify: fetch each homepage ourselves (free) and detect the signals that
 *    make RAMZA relevant — BNPL/gateways (Tabby, Tamara, Postpay, Stripe,
 *    Telr, Checkout.com, Network), store platform (Shopify, WooCommerce,
 *    Salla, Zid), COD mentions.
 * 3. Optional --instagram: Apify apify/instagram-profile-scraper on the
 *    business's own Instagram handle → followers, category, public business
 *    email. Business profiles only; no DMs are automated.
 * 4. Score A/B/C and write a CSV Instantly imports directly (email, first
 *    column + custom vars {{gateways}}, {{platform}}, {{segment}}).
 *
 * Only contact data the BUSINESS publishes (its website, Maps listing or
 * business profile). Role addresses on the company domain rank first; a
 * gmail/hotmail the shop itself publishes as its contact is kept but ranked
 * last and flagged email_type=freemail. Nothing is sent
 * from here — sending happens in Instantly from the warmed secondary domains.
 * Playbook: docs/ramza/outbound-playbook.md */

import { writeFileSync } from "fs";
import { homedir } from "os";

const TOKEN = process.env.APIFY_API_TOKEN;
if (!TOKEN) throw new Error("APIFY_API_TOKEN missing (.env.local)");

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const queries = (arg("queries", "online store") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const location = arg("location", "Dubai, United Arab Emirates")!;
const perQuery = Number(arg("per-query", "20"));
const out = (arg("out") ?? `~/Downloads/ramza-prospects-${new Date().toISOString().slice(0, 10)}.csv`).replace(/^~/, homedir());

async function runActor<T>(actor: string, input: object): Promise<T[]> {
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=300`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`${actor}: ${JSON.stringify(j).slice(0, 300)}`);
  return j as T[];
}

type Place = { title: string; website?: string; phone?: string; city?: string; categoryName?: string; totalScore?: number; reviewsCount?: number; emails?: string[]; instagrams?: string[]; url?: string };

const SIGNALS: [string, RegExp][] = [
  ["Tabby", /tabby\.ai|checkout\.tabby|tabby-promo|tabby/i],
  ["Tamara", /tamara\.co|tamara-widget|cdn\.tamara/i],
  ["Postpay", /postpay\.io/i],
  ["Stripe", /js\.stripe\.com/i],
  ["Telr", /telr\.com/i],
  ["Checkout.com", /checkout\.com|cko-/i],
  ["Network", /network\.ae|n-genius/i],
  ["Apple Pay", /apple-pay|applepay/i],
];
const PLATFORMS: [string, RegExp][] = [
  ["Shopify", /cdn\.shopify\.com|myshopify\.com/i],
  ["WooCommerce", /woocommerce|wp-content\/plugins\/woo/i],
  ["Salla", /salla\.(sa|network)|cdn\.salla/i],
  ["Zid", /zid\.store|zidcdn/i],
  ["Magento", /Magento_|\/static\/version\d+\/frontend/i],
];
const COD = /cash on delivery|\bCOD\b|الدفع عند الاستلام/i;

async function homepage(url: string): Promise<string> {
  try {
    const ctl = AbortSignal.timeout(12000);
    const r = await fetch(url, { signal: ctl, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36" }, redirect: "follow" });
    return r.ok ? (await r.text()).slice(0, 600_000) : "";
  } catch { return ""; }
}

const FREEMAIL = /@(gmail|hotmail|yahoo|outlook|icloud|live)\./i;
const SOCIAL_SITE = /(instagram|facebook|youtube|tiktok|wa\.me|whatsapp|linktr\.ee|carrd\.co|linkedin)\./i;
const ROLE_RANK = ["accounts", "finance", "billing", "admin", "info", "hello", "contact", "sales", "support"];
function bestEmail(emails: string[]): string | undefined {
  const all = [...new Set(emails.map((e) => e.toLowerCase().trim()))].filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !/\.(png|jpg|jpeg|webp|svg|gif)$/.test(e) && !/(sentry|wixpress|example|domain)\./.test(e));
  const rank = (e: string) => (FREEMAIL.test(e) ? 100 : 0) + ((i) => (i < 0 ? 50 : i))(ROLE_RANK.findIndex((r) => e.startsWith(r + "@")));
  return all.sort((a, b) => rank(a) - rank(b))[0];
}

const csv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

(async () => {
  console.log(`Discovering: ${queries.join(" | ")} in ${location} (${perQuery}/query)…`);
  const places = await runActor<Place>("compass~crawler-google-places", {
    searchStringsArray: queries, locationQuery: location, maxCrawledPlacesPerSearch: perQuery,
    language: "en", skipClosedPlaces: true, website: "withWebsite", scrapeContacts: true,
  });
  const seen = new Set<string>();
  const uniq = places.filter((p) => { const k = (p.website ?? p.title).replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  console.log(`${places.length} places → ${uniq.length} unique websites. Checking signals…`);

  const rows: Record<string, string | number | undefined>[] = [];
  const queue = [...uniq];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const site = p.website && !SOCIAL_SITE.test(p.website) ? p.website.replace(/\/$/, "") : "";
      let html = site ? await homepage(site) : "";
      // no email on the homepage → try the usual contact pages (Shopify: /pages/contact)
      if (site && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(html)) {
        for (const path of ["/pages/contact", "/contact", "/contact-us"]) {
          const c = await homepage(site + path);
          if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(c)) { html += c; break; }
        }
      }
      const gateways = SIGNALS.filter(([, re]) => re.test(html)).map(([n]) => n);
      const platform = PLATFORMS.find(([, re]) => re.test(html))?.[0] ?? "";
      const cod = COD.test(html);
      const siteEmails = [...html.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]);
      const email = bestEmail([...(p.emails ?? []), ...siteEmails]);
      const ig = (p.instagrams ?? [])[0];
      const bnpl = gateways.some((g) => ["Tabby", "Tamara", "Postpay"].includes(g));
      const multi = gateways.length + (cod ? 1 : 0) >= 2;
      const score = bnpl && multi ? "A" : bnpl || multi || platform ? "B" : "C";
      const segment = bnpl || platform ? "ecommerce" : "smb";
      rows.push({ email, email_type: email ? (FREEMAIL.test(email) ? "freemail" : "domain") : "", company: p.title, website: p.website, phone: p.phone, city: p.city, category: p.categoryName, rating: p.totalScore, reviews: p.reviewsCount, instagram: ig, platform, gateways: gateways.join(" + ") || (cod ? "COD" : ""), cod: cod ? "yes" : "", score, segment, maps: p.url });
    }
  }));

  if (flag("instagram")) {
    const handles = rows.map((r) => String(r.instagram ?? "").match(/instagram\.com\/([A-Za-z0-9._]+)/)?.[1]).filter((h): h is string => !!h && h !== "p");
    if (handles.length) {
      console.log(`Instagram: ${handles.length} business profiles…`);
      type Ig = { username: string; followersCount?: number; businessCategoryName?: string; isBusinessAccount?: boolean; publicEmail?: string; businessEmail?: string };
      const ig = await runActor<Ig>("apify~instagram-profile-scraper", { usernames: handles });
      const by = new Map(ig.map((x) => [x.username.toLowerCase(), x]));
      for (const r of rows) {
        const h = String(r.instagram ?? "").match(/instagram\.com\/([A-Za-z0-9._]+)/)?.[1]?.toLowerCase();
        const x = h ? by.get(h) : undefined;
        if (!x) continue;
        r.ig_followers = x.followersCount;
        r.ig_category = x.businessCategoryName;
        if (!r.email && x.isBusinessAccount) r.email = bestEmail([x.publicEmail ?? "", x.businessEmail ?? ""].filter(Boolean));
      }
    }
  }

  const cols = ["email", "email_type", "company", "website", "segment", "score", "platform", "gateways", "cod", "category", "city", "phone", "instagram", "ig_followers", "ig_category", "rating", "reviews", "maps"];
  const sorted = rows.sort((a, b) => String(a.score).localeCompare(String(b.score)));
  writeFileSync(out, [cols.join(","), ...sorted.map((r) => cols.map((c) => csv(r[c])).join(","))].join("\n"));
  const n = (s: string) => rows.filter((r) => r.score === s).length;
  console.log(`Wrote ${rows.length} rows (${rows.filter((r) => r.email).length} with a business email) → ${out}`);
  console.log(`A ${n("A")} · B ${n("B")} · C ${n("C")}`);
})();
