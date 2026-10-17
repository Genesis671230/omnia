/* Build a 9:16 Noor reel from templates/reels.mjs.
 *   node build-reel.mjs <reelId> <workDir> [--voice <elevenlabsVoiceId>]
 * <workDir> must contain posts/ (output of render-posts.mjs) for the B-roll slides.
 * Steps: ElevenLabs voice per segment (cached) → Noor take per talk segment
 * (takes/<i>.mp4 if present; else LeapTalk lip-sync when HF_TOKEN is in the repo .env;
 * else a slow push-in on the portrait, flagged in the log) → caption cards rendered
 * by Playwright → ffmpeg composite → music bed + soft whoosh at cuts → <id>.mp4. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { reels } from "../templates/reels.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../../..");
const MEDIA = path.resolve(HERE, "../../ramza-daily-video/media");
const PORTRAIT = `${REPO}/public/ramza/persona/noor-desk.png`;
const args = process.argv.slice(2);
const [id, work] = args;
const VOICE = args.includes("--voice") ? args[args.indexOf("--voice") + 1] : "EXAVITQu4vr4xnSDxMaL"; // Sarah: mature, reassuring
const W = 1080, H = 1920, FPS = 30;

const env = Object.fromEntries(fs.readFileSync(`${REPO}/.env`, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "").trim()]));
const R = JSON.parse(fs.readFileSync(`${REPO}/config/rules.json`, "utf8"));
const F = JSON.parse(fs.readFileSync(path.resolve(HERE, "../templates/facts.json"), "utf8"));
const reel = reels(R, F).find((r) => r.id === id);
if (!reel) { console.error("unknown reel", id, "→", reels(R, F).map((r) => r.id).join(", ")); process.exit(1); }

const dir = path.resolve(work, "reels", id);
for (const d of ["vo", "takes", "cards", "segs"]) fs.mkdirSync(`${dir}/${d}`, { recursive: true });
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const dur = (f) => +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`);

// 1. voice
for (const [i, s] of reel.segments.entries()) {
  const key = crypto.createHash("sha1").update(VOICE + s.say).digest("hex").slice(0, 10);
  s.vo = `${dir}/vo/${i}-${key}.mp3`;
  if (!fs.existsSync(s.vo)) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": env.ELEVEN_LABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text: s.say, model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
    });
    if (!r.ok) { console.error("ElevenLabs", r.status, await r.text()); process.exit(1); }
    fs.writeFileSync(s.vo, Buffer.from(await r.arrayBuffer()));
  }
  s.len = dur(s.vo) + 0.35; // breath before the cut
  if (s.visual === "talk" && s.len > 9) console.warn(`! segment ${i} speech is ${s.len.toFixed(1)}s, LeapTalk caps at 9s: split it`);
}

// 2. Noor takes
const fallbacks = [];
for (const [i, s] of reel.segments.entries()) {
  if (s.visual !== "talk") continue;
  s.take = `${dir}/takes/${i}.mp4`;
  if (fs.existsSync(s.take)) continue;
  if (env.HF_TOKEN) {
    const r = spawnSync("uv", ["run", "--quiet", "--with", "gradio_client", "python", "-I", `${HERE}/leaptalk.py`, PORTRAIT, s.vo, s.take],
      { stdio: "inherit", env: { ...process.env, HF_TOKEN: env.HF_TOKEN } });
    if (r.status === 0 && fs.existsSync(s.take)) continue;
  }
  s.take = null;
  fallbacks.push(i);
}

// slide background (white or navy) from a corner pixel, so the canvas matches
for (const s of reel.segments) {
  if (s.visual === "talk") continue;
  const px = execSync(`ffmpeg -v error -i "${path.resolve(work, s.visual)}" -vf crop=1:1:8:8 -f rawvideo -pix_fmt rgb24 -`);
  s.bg = "0x" + [...px.subarray(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join("");
  s.dark = px[0] + px[1] + px[2] < 200;
}

// 3. caption + overlay cards (transparent PNGs)
const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROME_PATH ?? (fs.existsSync(CACHED) ? CACHED : undefined);
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
const css = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;600&family=Urbanist:wght@700;800&display=block');
*{margin:0;box-sizing:border-box}html,body{background:transparent;width:${W}px;height:${H}px;font-family:'IBM Plex Sans'}
.cap{position:absolute;left:64px;right:64px;bottom:300px;display:flex;justify-content:center}
.cap span{font-family:'Urbanist';font-weight:800;font-size:76px;line-height:1.08;letter-spacing:-.02em;color:#fff;background:#0B1533;padding:18px 30px 22px;border-radius:10px;text-align:center;max-width:952px}
.logo{position:absolute;left:64px;top:96px;height:52px}
.ai{position:absolute;right:64px;top:104px;font-size:24px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:rgba(5,11,31,.78);padding:10px 16px;border-radius:6px}
.lt{position:absolute;left:64px;bottom:150px;color:#fff;font-size:30px;font-weight:600;background:rgba(5,11,31,.78);padding:12px 20px;border-radius:8px}
.lt b{color:#B3A6FF;font-weight:600}
.disc{position:absolute;left:64px;right:64px;bottom:64px;font-size:22px;line-height:1.4;color:#5B6478}`;
async function card(file, html) {
  await page.setContent(`<style>${css}</style>${html}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: true });
}
const logoW = "data:image/png;base64," + fs.readFileSync(`${REPO}/public/ramza/brand/ramza-lockup-ink.png`).toString("base64");
for (const [i, s] of reel.segments.entries()) {
  s.cards = [];
  for (const [j, c] of s.cap.entries()) {
    const f = `${dir}/cards/${i}-${j}.png`;
    const talk = s.visual === "talk";
    await card(f, `${talk ? `<img class="logo" src="${logoW}"><div class="ai">AI presenter</div>${i === 0 ? `<div class="lt">Noor <b>· RAMZA AI analyst</b></div>` : ""}` : ""}
      <div class="cap" style="${talk ? "" : "bottom:200px"}"><span style="${s.dark ? "background:#fff;color:#0B1533" : ""}">${c}</span></div>${i === reel.segments.length - 1 ? `<div class="disc" style="color:${talk ? "#C4CAD9" : "#5B6478"}">${reel.disclaimer}</div>` : ""}`);
    s.cards.push(f);
  }
}
await browser.close();

// 4. composite each segment
const segFiles = [];
for (const [i, s] of reel.segments.entries()) {
  const out = `${dir}/segs/${i}.mp4`, L = s.len.toFixed(3), frames = Math.ceil(s.len * FPS);
  let base;
  if (s.visual === "talk" && s.take) {
    base = `-stream_loop -1 -i "${s.take}"`;
    s.vf = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},trim=duration=${L},setpts=PTS-STARTPTS[b]`;
  } else if (s.visual === "talk") { // fallback: slow push-in on the portrait
    base = `-loop 1 -framerate ${FPS} -i "${PORTRAIT}"`;
    const z0 = 1 + (i % 2 ? 0.06 : 0), z1 = 1 + (i % 2 ? 0 : 0.06);
    s.vf = `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z0}+(${(z1 - z0).toFixed(3)})*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih*0.18-(ih*0.18/zoom)':d=1:s=${W}x${H}:fps=${FPS}[b]`;
  } else { // slide as B-roll on white, gentle drift up
    const src = path.resolve(work, s.visual);
    base = `-loop 1 -framerate ${FPS} -i "${src}"`;
    s.vf = `color=${s.bg}:s=${W}x${H}:r=${FPS}:d=${L}[bg];[0:v]scale=${W}:-2,fps=${FPS}[sl];[bg][sl]overlay=x=0:y='120-12*t/${L}':shortest=1[b]`;
  }
  const n = s.cards.length, step = s.len / n;
  const cardIn = s.cards.map((c) => `-loop 1 -i "${c}"`).join(" ");
  let chain = s.vf, last = "b";
  s.cards.forEach((_, j) => {
    const a = (j * step).toFixed(2), b = j === n - 1 ? L : ((j + 1) * step).toFixed(2);
    chain += `;[${last}][${j + 1}:v]overlay=0:0:enable='between(t,${a},${b})'[o${j}]`; last = `o${j}`;
  });
  fs.writeFileSync(`${dir}/segs/${i}.fc`, chain);
  sh(`ffmpeg -y -v error ${base} ${cardIn} -i "${s.vo}" -filter_complex_script "${dir}/segs/${i}.fc" -map "[${last}]" -map ${n + 1}:a -t ${L} -r ${FPS} -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 -b:a 192k "${out}"`);
  segFiles.push(out);
}

// 5. join, bed + whoosh at each cut, loudness for phones
fs.writeFileSync(`${dir}/concat.txt`, segFiles.map((f) => `file '${f}'`).join("\n"));
sh(`ffmpeg -y -v error -f concat -safe 0 -i "${dir}/concat.txt" -c copy "${dir}/joined.mp4"`);
const total = dur(`${dir}/joined.mp4`);
let t = 0; const cuts = reel.segments.slice(0, -1).map((s) => (t += s.len));
const music = `${MEDIA}/music/motivational-day-112790.mp3`, whoosh = `${MEDIA}/sfx/whoosh-short.mp3`;
const fc = [`[1:a]atrim=0:${total},asetpts=N/SR/TB,volume=0.085,afade=t=in:d=1,afade=t=out:st=${(total - 2.5).toFixed(2)}:d=2.5[m]`];
const mixIn = ["[0:a]", "[m]"];
cuts.forEach((c, k) => { const ms = Math.round((c - 0.12) * 1000); fc.push(`[${k + 2}:a]volume=0.16,adelay=${ms}|${ms},apad=whole_dur=${total}[w${k}]`); mixIn.push(`[w${k}]`); });
fc.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=9[a]`);
fs.writeFileSync(`${dir}/mix.fc`, fc.join(";\n"));
const outFile = path.resolve(work, `${id}.mp4`);
sh(`ffmpeg -y -v error -i "${dir}/joined.mp4" -stream_loop -1 -i "${music}" ${cuts.map(() => `-i "${whoosh}"`).join(" ")} -filter_complex_script "${dir}/mix.fc" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -t ${total} "${outFile}"`);
console.log(JSON.stringify({ out: outFile, seconds: +total.toFixed(1), segments: reel.segments.length,
  lipsync: fallbacks.length ? `NO — portrait push-in used for talk segments ${fallbacks.join(",")} (add HF_TOKEN to .env, or drop takes/<i>.mp4)` : "yes" }, null, 1));
