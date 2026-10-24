/* Screenshot source pages with the quoted lines highlighted (yellow marker), for B-roll.
 *   node shoot-sources.mjs <sources.json> <outDir>
 * sources.json: [{ name, url, marks: ["exact text", …], width?: 1280 }]
 * Writes <name>.png (viewport, first mark centred, 2x) + <name>-full.png + <name>.json (mark boxes in the PNG). */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.resolve(HERE, "../../ramza-daily-video/package.json"));
const { chromium } = require("playwright");
const [src, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: fs.existsSync(CACHED) ? CACHED : undefined });
for (const s of JSON.parse(fs.readFileSync(src, "utf8"))) {
  const ctx = await browser.newContext({ viewport: { width: s.width ?? 1280, height: 1500 }, deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" });
  const page = await ctx.newPage();
  try {
    await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
    const boxes = await page.evaluate((marks) => {
      document.querySelectorAll("[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[class*=popup i],[class*=modal i],[id*=onetrust i]").forEach((e) => e.remove());
      document.documentElement.style.overflow = "auto"; document.body.style.overflow = "auto";
      const found = [];
      for (const m of marks) {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          const i = n.data.indexOf(m);
          if (i < 0) continue;
          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + m.length);
          const mk = document.createElement("mark");
          mk.style.cssText = "background:#FFE14D;color:inherit;padding:0 2px;box-decoration-break:clone;-webkit-box-decoration-break:clone";
          r.surroundContents(mk); found.push(mk); break;
        }
      }
      return found.length ? (found[0].scrollIntoView({ block: "center" }), true) : false;
    }, s.marks);
    await page.waitForTimeout(800);
    const rects = await page.$$eval("mark", (ms) => ms.map((m) => { const r = m.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
    await page.screenshot({ path: `${out}/${s.name}.png` });
    await page.screenshot({ path: `${out}/${s.name}-full.png`, fullPage: true }).catch(() => {});
    fs.writeFileSync(`${out}/${s.name}.json`, JSON.stringify({ url: s.url, found: boxes, marks: rects.map((r) => r.map((v) => v * 2)) }));
    console.log(boxes ? "ok" : "NO MARK", s.name, rects.length);
  } catch (e) { console.log("FAIL", s.name, e.message.split("\n")[0]); }
  await ctx.close();
}
await browser.close();
