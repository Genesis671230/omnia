/* Render every [data-slide] in a posts page to a 4:5 PNG (1080x1350 CSS px at 2x).
 *   node render-posts.mjs <posts.html> <outDir> [onlyPostId]
 * The page receives window.RULES (config/rules.json), window.FACTS (facts.json next
 * to the page) and window.CONTACT (WhatsApp number from the repo .env) before it runs.
 * Slides are written as <outDir>/<post>/slide-N.png plus caption.txt from data-caption. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(path.resolve(here, "../../ramza-daily-video/package.json"))("playwright");
const repo = path.resolve(here, "../../../..");
const [html, outDir, only] = process.argv.slice(2);
if (!html || !outDir) { console.error("usage: render-posts.mjs posts.html outDir [postId]"); process.exit(1); }

const rules = JSON.parse(fs.readFileSync(`${repo}/config/rules.json`, "utf8"));
const factsPath = path.join(path.dirname(path.resolve(html)), "facts.json");
const facts = fs.existsSync(factsPath) ? JSON.parse(fs.readFileSync(factsPath, "utf8")) : {};
const env = fs.existsSync(`${repo}/.env`) ? fs.readFileSync(`${repo}/.env`, "utf8") : "";
const wa = (env.match(/^NEXT_PUBLIC_WHATSAPP_NUMBER=(.*)$/m)?.[1] ?? "").replace(/["']/g, "").trim();
const contact = { whatsapp: wa ? wa.replace(/^\+?971/, "+971 ").replace(/(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3") : "", site: "ramza.ai" };

const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROME_PATH ?? (fs.existsSync(CACHED) ? CACHED : undefined);
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 })).newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.addInitScript(({ rules, facts, contact }) => { window.RULES = rules; window.FACTS = facts; window.CONTACT = contact; },
  { rules, facts, contact });
await page.goto("file://" + path.resolve(html), { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const posts = await page.evaluate(() => [...document.querySelectorAll("[data-post]")].map((p) => ({
  id: p.dataset.post, caption: p.querySelector("template[data-caption]")?.innerHTML.trim() ?? "",
  slides: p.querySelectorAll("[data-slide]").length,
})));
for (const post of posts) {
  if (only && post.id !== only) continue;
  const dir = path.join(outDir, post.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < post.slides; i++) {
    const el = page.locator(`[data-post="${post.id}"] [data-slide]`).nth(i);
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: path.join(dir, `slide-${i + 1}.png`) });
  }
  if (post.caption) fs.writeFileSync(path.join(dir, "caption.txt"), post.caption.replace(/^[ \t]+/gm, "") + "\n");
  console.log("rendered", post.id, post.slides, "slides");
}
await browser.close();
