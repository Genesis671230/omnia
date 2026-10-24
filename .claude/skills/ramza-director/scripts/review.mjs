/* Frame review: no clutter, nothing outside the safe box, captions never over the visual.
 *   node review.mjs page.html outDir [step=0.5] [--size 1080x1920]
 * Seeks the page (window.__seek / window.__DUR, same contract as render.mjs) every `step` seconds and
 * reads the boxes of every visible text element plus every [data-focus] element. Flags:
 *   SAFE     text outside the critical box (x 80–1000, y 300–1250 on 9:16; scaled for other sizes)
 *   OVERLAP  two text boxes intersecting (> 6% of the smaller one)
 *   COVER    a caption ([data-cap] or .cap) over a [data-focus] element
 *   OFFFRAME text cut by the frame edge
 * Writes report.json and a PNG of each failing time with the boxes drawn (red = problem, green = safe box).
 * Exit code 1 when anything fails, so builds can gate on it. Elements with [data-review-ignore] are skipped. */
import { chromium } from "../../ramza-daily-video/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const [html, outDir, stepArg = "0.5"] = args;
const size = args.includes("--size") ? args[args.indexOf("--size") + 1] : process.env.SIZE ?? "1080x1920";
const [W, H] = size.split("x").map(Number);
const sx = W / 1080, sy = H / 1920;
const SAFE = H > W ? { x0: 80 * sx, x1: 1000 * sx, y0: 300 * sy, y1: 1250 * sy } : { x0: W * 0.05, x1: W * 0.95, y0: H * 0.08, y1: H * 0.88 };

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (/^fail-.*\.png$/.test(f)) fs.rmSync(`${outDir}/${f}`);
const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const exe = process.env.CHROME_PATH ?? (fs.existsSync(CACHED) ? CACHED : undefined);
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
await page.goto("file://" + path.resolve(html), { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
const dur = await page.evaluate(() => window.__DUR);

const issues = [];
for (let t = 0; t <= dur; t = +(t + +stepArg).toFixed(2)) {
  await page.evaluate((t) => window.__seek(t), t);
  const boxes = await page.evaluate(() => {
    const vis = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === "none" || s.visibility === "hidden" || +s.opacity < 0.08) return false;
      }
      return true;
    };
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const el = n.parentElement;
      if (!n.textContent.trim() || el.closest("[data-review-ignore]") || !vis(el)) continue;
      // measure the text node itself, so a parent never "overlaps" its own children
      const r = document.createRange(); r.selectNodeContents(n);
      const b = r.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      // parked off-screen or clipped away by an overflow:hidden ancestor = not on screen, skip
      let cx0 = 0, cy0 = 0, cx1 = innerWidth, cy1 = innerHeight;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        if (getComputedStyle(e).overflow === "visible") continue;
        const c = e.getBoundingClientRect();
        cx0 = Math.max(cx0, c.x); cy0 = Math.max(cy0, c.y); cx1 = Math.min(cx1, c.right); cy1 = Math.min(cy1, c.bottom);
      }
      if (b.right <= cx0 || b.x >= cx1 || b.bottom <= cy0 || b.y >= cy1) continue;
      out.push({ kind: el.closest("[data-cap],.cap") ? "cap" : "text", txt: n.textContent.trim().slice(0, 40), x: b.x, y: b.y, w: b.width, h: b.height });
    }
    for (const el of document.querySelectorAll("[data-focus]")) {
      if (!vis(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width > 2) out.push({ kind: "focus", txt: el.dataset.focus, x: b.x, y: b.y, w: b.width, h: b.height });
    }
    return out;
  });
  // glyph boxes include the font's ascent/descent; compare ink-ish boxes (15% trimmed top and bottom)
  const ink = (b) => ({ ...b, y: b.y + b.h * 0.15, h: b.h * 0.7 });
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const bad = [];
  const texts = boxes.filter((b) => b.kind !== "focus");
  for (const b of texts) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1) bad.push({ rule: "OFFFRAME", ...b });
    else if (b.x < SAFE.x0 || b.x + b.w > SAFE.x1 || b.y < SAFE.y0 || b.y + b.h > SAFE.y1) bad.push({ rule: "SAFE", ...b });
  }
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = ink(texts[i]), b = ink(texts[j]);
      if (inter(a, b) > 0.06 * Math.min(a.w * a.h, b.w * b.h)) bad.push({ rule: "OVERLAP", ...a, with: b.txt, x2: b.x, y2: b.y, w2: b.w, h2: b.h });
    }
  for (const c of boxes.filter((b) => b.kind === "cap"))
    for (const f of boxes.filter((b) => b.kind === "focus"))
      if (inter(c, f) > 0.04 * c.w * c.h) bad.push({ rule: "COVER", ...c, with: f.txt, x2: f.x, y2: f.y, w2: f.w, h2: f.h });
  if (!bad.length) continue;
  issues.push({ t, bad });
  await page.evaluate(({ bad, SAFE }) => {
    const o = document.createElement("div");
    o.id = "__rv"; o.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
    const box = (x, y, w, h, c) => { const d = document.createElement("div"); d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;outline:4px solid ${c}`; o.appendChild(d); };
    box(SAFE.x0, SAFE.y0, SAFE.x1 - SAFE.x0, SAFE.y1 - SAFE.y0, "#2ecc71");
    for (const b of bad) { box(b.x, b.y, b.w, b.h, "#ff2d2d"); if (b.w2) box(b.x2, b.y2, b.w2, b.h2, "#ffb020"); }
    document.body.appendChild(o);
  }, { bad, SAFE });
  await page.screenshot({ path: `${outDir}/fail-${String(t.toFixed(1)).padStart(5, "0")}.png` });
  await page.evaluate(() => document.getElementById("__rv")?.remove());
}
await browser.close();
fs.writeFileSync(`${outDir}/report.json`, JSON.stringify({ html, size, safe: SAFE, dur, issues }, null, 1));
const count = (r) => issues.reduce((n, i) => n + i.bad.filter((b) => b.rule === r).length, 0);
console.log(`review ${path.basename(html)} ${size}: ${issues.length} failing times · SAFE ${count("SAFE")} · OVERLAP ${count("OVERLAP")} · COVER ${count("COVER")} · OFFFRAME ${count("OFFFRAME")}`);
for (const i of issues.slice(0, 12)) console.log(` t=${i.t}s`, i.bad.map((b) => `${b.rule}:"${b.txt}"${b.with ? "↔" + b.with : ""}`).join("  "));
process.exit(issues.length ? 1 : 0);
