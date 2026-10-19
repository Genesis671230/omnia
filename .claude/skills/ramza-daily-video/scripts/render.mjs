/* Render a GSAP timeline page frame by frame. Usage:
 *   node render.mjs page.html outDir [fps] [t1,t2,...]   (times = PNG check frames only)
 * SIZE=1080x1920 renders a vertical reel (default 1920x1080).
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
const [W, H] = (process.env.SIZE ?? "1920x1080").split("x").map(Number);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(`${outDir}/frames`, { recursive: true });
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
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
  /* ALPHA=1: transparent PNG frames, for an overlay composited onto real footage */
  const alpha = process.env.ALPHA === "1";
  await page.screenshot({ path: `${outDir}/frames/f${String(i).padStart(5, "0")}.${times || alpha ? "png" : "jpg"}`,
    ...(times || alpha ? { type: "png", omitBackground: alpha } : { type: "jpeg", quality: +(process.env.JPEG_Q ?? 97) }) });
  if (!times && i % 150 === 0) console.log("frame", i, "/", N);
}
await browser.close();
console.log("done", N, "frames", dur, "s");
