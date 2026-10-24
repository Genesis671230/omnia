/* Reel covers / thumbnails from templates/thumbnails.html, with RULES + FACTS injected.
 *   node render-thumbs.mjs <outDir> [id,id,…]
 * Writes <id>-9x16.png (1080x1920, reel cover) and <id>-4x5.png (1080x1350, feed / grid). */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.resolve(HERE, "../../ramza-daily-video/package.json"));
const { chromium } = require("playwright");
const REPO = path.resolve(HERE, "../../../..");
const RULES = JSON.parse(fs.readFileSync(`${REPO}/config/rules.json`, "utf8"));
const FACTS = JSON.parse(fs.readFileSync(path.resolve(HERE, "../templates/facts.json"), "utf8"));
const [out, only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const url = "file://" + path.resolve(HERE, "../templates/thumbnails.html");
const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROME_PATH ?? (fs.existsSync(CACHED) ? CACHED : undefined);
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.addInitScript(([r, f]) => { window.RULES = r; window.FACTS = f; }, [RULES, FACTS]);
await page.goto(url + "?id=bank-not-books");
const ids = only ? only.split(",") : await page.evaluate(() => window.THUMBS);
for (const id of ids) {
  for (const [tag, h] of [["9x16", 1920], ["4x5", 1350]]) {
    await page.setViewportSize({ width: 1080, height: h });
    await page.goto(`${url}?id=${id}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${id}-${tag}.png` });
  }
  console.log("ok", id);
}
await browser.close();
