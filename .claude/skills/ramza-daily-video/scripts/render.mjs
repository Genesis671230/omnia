/* Render a GSAP timeline page frame by frame. Usage:
 *   node render.mjs page.html outDir [fps] [t1,t2,...]   (times = PNG check frames only)
 * Full renders write JPEG frames; delete them after mix.mjs (≈250 MB per minute). */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
// Playwright's own browser if installed, else a cached Chrome for Testing, else $CHROME_PATH
const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROME_PATH ?? (existsSync(CACHED) ? CACHED : undefined);
import fs from "node:fs";
import path from "node:path";
const [html, outDir, fpsArg = "30", only] = process.argv.slice(2);
const fps = +fpsArg;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(`${outDir}/frames`, { recursive: true });
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
await page.goto("file://" + path.resolve(html), { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const dur = await page.evaluate(() => window.__DUR);
const sfx = await page.evaluate(() => window.SFX);
fs.writeFileSync(`${outDir}/events.json`, JSON.stringify({ dur, sfx }, null, 1));
const times = only ? only.split(",").map(Number) : null;
const N = times ? times.length : Math.ceil(dur * fps);
for (let i = 0; i < N; i++) {
  const t = times ? times[i] : i / fps;
  await page.evaluate((t) => window.__seek(t), t);
  await page.screenshot({ path: `${outDir}/frames/f${String(i).padStart(5, "0")}.${times ? "png" : "jpg"}`, ...(times ? { type: "png" } : { type: "jpeg", quality: 90 }) });
  if (!times && i % 150 === 0) console.log("frame", i, "/", N);
}
await browser.close();
console.log("done", N, "frames", dur, "s");
