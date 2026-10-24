/* Storyboard from a template's window.BEATS: two frames per beat + the direction for each.
 *   node storyboard.mjs page.html outDir [--title "Name"] [--size 1080x1920]
 * Renders frames with ramza-daily-video/render.mjs at beat start + 0.4 s and beat middle, then
 * writes outDir/storyboard.html: one self-contained page (frames as data: URIs) that follows the
 * Artifact page contract, so it can be published as-is for the founder to review. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "../../ramza-daily-video/node_modules/playwright/index.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const [html, outDir] = args;
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const size = opt("--size", "1080x1920");
const [W, H] = size.split("x").map(Number);
fs.mkdirSync(outDir, { recursive: true });

const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const exe = process.env.CHROME_PATH ?? (fs.existsSync(CACHED) ? CACHED : undefined);
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
await page.goto("file://" + path.resolve(html), { waitUntil: "load" });
const { beats, dur, title } = await page.evaluate(() => ({ beats: window.BEATS, dur: window.__DUR, title: document.title }));
await browser.close();
if (!beats?.length) { console.error("page has no window.BEATS"); process.exit(1); }

const times = beats.flatMap((b) => [+(b.t + 0.4).toFixed(2), +(b.t + b.dur / 2 + 0.2).toFixed(2)]);
execFileSync("node", [path.resolve(HERE, "../../ramza-daily-video/scripts/render.mjs"), html, `${outDir}/sb`, "30", times.join(",")],
  { env: { ...process.env, SIZE: size }, stdio: "inherit" });
const thumb = (i) => {
  const src = `${outDir}/sb/frames/f${String(i).padStart(5, "0")}.png`, dst = `${outDir}/sb/t${i}.jpg`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `scale=${Math.round(W / 3)}:-2`, "-q:v", "4", dst]);
  return "data:image/jpeg;base64," + fs.readFileSync(dst).toString("base64");
};

const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mark = (s) => esc(s).replace(/\*([^*]+)\*/g, "<b>$1</b>");
const tc = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const name = opt("--title", title || path.basename(html, ".html"));
const rows = beats.map((b, i) => `
  <article class="beat">
    <header><span class="tag">${esc(b.beat)}</span><span class="tc">${tc(b.t)} – ${tc(b.t + b.dur)}</span><span class="len">${b.dur.toFixed(1)} s</span></header>
    <div class="frames"><figure><img src="${thumb(i * 2)}" alt="${esc(b.beat)} at ${times[i * 2]} s"><figcaption>${times[i * 2]} s</figcaption></figure>
      <figure><img src="${thumb(i * 2 + 1)}" alt="${esc(b.beat)} at ${times[i * 2 + 1]} s"><figcaption>${times[i * 2 + 1]} s</figcaption></figure></div>
    <dl>
      <dt>Voice</dt><dd class="vo">${esc(b.vo)}</dd>
      <dt>On screen</dt><dd>${mark(b.onscreen)}</dd>
      <dt>Open</dt><dd>${esc(b.open)}</dd>
      <dt>Camera</dt><dd>${esc(b.camera)}</dd>
      <dt>Reveal</dt><dd>${esc(b.reveal)}</dd>
      <dt>Exit</dt><dd>${esc(b.exit)}</dd>
      <dt>Sound</dt><dd>${esc(b.sfx)}</dd>
    </dl>
  </article>`).join("");

const doc = `<title>${esc(name)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Urbanist:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
/* Layout: a shot list. Each beat is a row: two frames on the left, the direction sheet on the right. */
:root { --bg:#F6F7FB; --paper:#FFFFFF; --ink:#14131C; --muted:#5B6479; --line:#E3E7F0; --navy:#0B1533; --accent:#4F35E8;
  --display:"Urbanist",system-ui,sans-serif; --body:"IBM Plex Sans",system-ui,sans-serif; --mono:"IBM Plex Mono",ui-monospace,monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#050B1F; --paper:#0B1533; --ink:#EEF0F7; --muted:#A3AAC0; --line:#24305A; --navy:#050B1F; --accent:#B3A6FF; color-scheme:dark; } }
:root[data-theme="dark"] { --bg:#050B1F; --paper:#0B1533; --ink:#EEF0F7; --muted:#A3AAC0; --line:#24305A; --navy:#050B1F; --accent:#B3A6FF; color-scheme:dark; }
body { background:var(--bg); color:var(--ink); font:400 15px/1.55 var(--body); padding-left:max(16px, env(safe-area-inset-left, 0px)); padding-right:max(16px, env(safe-area-inset-right, 0px)); padding-block:32px 64px; }
main { max-width:1080px; margin:0 auto; display:grid; gap:20px; }
h1 { font:800 clamp(30px,5vw,46px)/1.05 var(--display); letter-spacing:-.5px; margin:0; text-wrap:balance; }
.meta { color:var(--muted); display:flex; flex-wrap:wrap; gap:6px 18px; font-size:14px; }
.meta span { font-family:var(--mono); font-size:13px; }
.beat { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:18px; display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px 24px; }
.beat header { grid-column:1 / -1; display:flex; align-items:baseline; gap:14px; }
.tag { font:700 13px/1 var(--mono); letter-spacing:.08em; color:var(--accent); }
.tc, .len { font:500 13px/1 var(--mono); color:var(--muted); font-variant-numeric:tabular-nums; }
.len { margin-left:auto; }
.frames { display:flex; gap:10px; }
figure { margin:0; }
figure img { width:150px; aspect-ratio:${W}/${H}; height:auto; display:block; border-radius:4px; border:1px solid var(--line); background:var(--navy); }
figcaption { font:500 12px/1 var(--mono); color:var(--muted); margin-top:6px; }
dl { margin:0; display:grid; grid-template-columns:92px minmax(0,1fr); gap:6px 14px; align-content:start; }
dt { font:600 12px/1.6 var(--body); color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
dd { margin:0; min-width:0; }
dd.vo { font-weight:500; }
dd b { color:var(--accent); font-weight:600; }
@media (max-width:720px) { .beat { grid-template-columns:minmax(0,1fr); } figure img { width:calc((100vw - 90px) / 2); max-width:180px; } dl { grid-template-columns:78px minmax(0,1fr); } }
</style>
<main>
  <h1>${esc(name)}</h1>
  <div class="meta"><span>${size} · 30 fps · ${dur.toFixed(1)} s</span><span>${beats.length} beats</span><span>${beats.map((b) => b.beat).join(" → ")}</span></div>
  ${rows}
</main>`;
fs.writeFileSync(`${outDir}/storyboard.html`, doc);
fs.rmSync(`${outDir}/sb`, { recursive: true, force: true });
console.log("wrote", `${outDir}/storyboard.html`, (doc.length / 1024).toFixed(0) + " KB");
