/* Build a 9:16 animated explainer from templates/explainers.mjs + templates/explainers/<id>.html.
 *   node build-explainer.mjs <id> <workDir> [--check "2,6,10"] [--voice <elevenlabsVoiceId>]
 * Steps: ElevenLabs voice per segment with character timestamps (cached) → window.TIMING
 * (segment starts, word times, caption keywords) → frames via ramza-daily-video/render.mjs
 * at 1080x1920 → music + UI sounds via mix.mjs → voice laid on top, loudness −14 LUFS.
 * --check renders only PNG frames at those seconds and a contact sheet, for review. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { explainers } from "../templates/explainers.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../../..");
const VIDEO = path.resolve(HERE, "../../ramza-daily-video");
const TPL = path.resolve(HERE, "../templates/explainers");
const args = process.argv.slice(2);
const [id, workArg] = args;
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const VOICE = opt("--voice") ?? "EXAVITQu4vr4xnSDxMaL"; // Sarah, same voice as Noor reels
const CHECK = opt("--check");

const env = Object.fromEntries(fs.readFileSync(`${REPO}/.env`, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "").trim()]));
const R = JSON.parse(fs.readFileSync(`${REPO}/config/rules.json`, "utf8"));
const F = JSON.parse(fs.readFileSync(path.resolve(HERE, "../templates/facts.json"), "utf8"));
const ex = explainers(R, F).find((x) => x.id === id);
if (!ex) { console.error("unknown explainer", id, "→", explainers(R, F).map((x) => x.id).join(", ")); process.exit(1); }

const dir = path.resolve(workArg, "explainers", id);
fs.mkdirSync(`${dir}/vo`, { recursive: true });
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const dur = (f) => +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`);

/* `{shown|spoken}` groups and *keyword* spans → tokens with the spoken text's char ranges */
function tokenize(say) {
  const toks = [];
  let hl = false, spoken = "";
  for (const m of say.matchAll(/\{([^|}]*)\|([^}]*)\}|\S+/g)) {
    let shown = m[1] ?? m[0], voice = m[2] ?? m[0];
    const open = shown.startsWith("*"), close = /\*[.,?!:;]*$/.test(shown);
    if (open) hl = true;
    const tokHl = hl;
    if (close) hl = false;
    shown = shown.replace(/\*/g, "");
    voice = voice.replace(/\*/g, "");
    if (spoken) spoken += " ";
    toks.push({ w: shown, hl: tokHl, c0: spoken.length, c1: spoken.length + voice.length });
    spoken += voice;
  }
  return { toks, spoken };
}

// 1. voice + timestamps per segment
const GAP = 0.28, LEAD = 0.35, TAIL = 2.4;
let t = LEAD;
const segs = [];
for (const [i, s] of ex.segments.entries()) {
  const { toks, spoken } = tokenize(s.say);
  const key = crypto.createHash("sha1").update(VOICE + spoken).digest("hex").slice(0, 10);
  const mp3 = `${dir}/vo/${i}-${key}.mp3`, js = `${dir}/vo/${i}-${key}.json`;
  if (!fs.existsSync(mp3)) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": env.ELEVEN_LABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken, model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
    });
    if (!r.ok) { console.error("ElevenLabs", r.status, await r.text()); process.exit(1); }
    const j = await r.json();
    fs.writeFileSync(mp3, Buffer.from(j.audio_base64, "base64"));
    fs.writeFileSync(js, JSON.stringify(j.alignment));
  }
  const al = JSON.parse(fs.readFileSync(js, "utf8"));
  const len = dur(mp3);
  const exact = al.characters.join("") === spoken;
  if (!exact) console.warn(`! segment ${i}: alignment text differs from input, timing words proportionally`);
  const at = (c, end) => exact
    ? (end ? al.character_end_times_seconds[c - 1] : al.character_start_times_seconds[c])
    : (c / spoken.length) * len;
  const tokens = toks.map((k) => ({ w: k.w, hl: k.hl, t0: +(t + at(k.c0, false)).toFixed(3), t1: +(t + at(k.c1, true)).toFixed(3) }));
  segs.push({ start: +(t - (i ? GAP / 2 : LEAD)).toFixed(3), voice: +t.toFixed(3), end: +(t + len + GAP / 2).toFixed(3), dark: !!s.dark, mp3, tokens });
  t += len + GAP;
}
const total = +(t + TAIL).toFixed(2);
segs[segs.length - 1].end = total;

// 2. work page: template + engine + data
for (const f of fs.readdirSync(TPL)) if (/\.(css|js)$/.test(f)) fs.copyFileSync(`${TPL}/${f}`, `${dir}/${f}`);
fs.copyFileSync(`${TPL}/${id}.html`, `${dir}/video.html`);
fs.copyFileSync(`${VIDEO}/scripts/engine.js`, `${dir}/engine.js`);
for (const [ln, to] of [["PHOTO", "public/ramza/photos"], ["BRAND", "public/ramza/brand"], ["LG", "public/ramza/logos"], ["GW", "public/gateways"]]) {
  fs.rmSync(`${dir}/${ln}`, { force: true });
  fs.symlinkSync(`${REPO}/${to}`, `${dir}/${ln}`);
}
fs.writeFileSync(`${dir}/data.js`, `window.RULES=${JSON.stringify(R)};window.FACTS=${JSON.stringify(F)};window.TIMING=${JSON.stringify({ dur: total,
  segs: segs.map(({ mp3, ...s }) => s) })};window.DISCLAIMER=${JSON.stringify(ex.disclaimer)};`);
console.log(JSON.stringify({ id, dur: total, segs: segs.map((s) => [s.start, s.end]) }));

// 3. frames
const render = (out, times) => execSync(`node "${VIDEO}/scripts/render.mjs" "${dir}/video.html" "${out}" 30 ${times ? `"${times}"` : ""}`,
  { stdio: "inherit", env: { ...process.env, SIZE: "1080x1920" } });
if (CHECK) {
  render(`${dir}/check`, CHECK);
  const nf = CHECK.split(",").length, cols = Math.min(nf, 6), rows = Math.ceil(nf / cols);
  sh(`ffmpeg -y -loglevel error -i "${dir}/check/frames/f%05d.png" -vf "scale=360:640,tile=${cols}x${rows}" -frames:v 1 "${dir}/check-sheet.jpg"`);
  console.log("check sheet", `${dir}/check-sheet.jpg`);
  process.exit(0);
}
render(`${dir}/out`);

// 4. music + UI sounds, then the voice on top
const [music, vol] = ex.music;
execSync(`node "${VIDEO}/scripts/mix.mjs" "${dir}/out" bed.mp4 ${music} ${vol}`, { stdio: "inherit" });
const vin = segs.map((s) => `-i "${s.mp3}"`).join(" ");
const vf = segs.map((s, i) => `[${i + 1}]adelay=${Math.round(s.voice * 1000)}|${Math.round(s.voice * 1000)},aformat=sample_rates=48000:channel_layouts=stereo[v${i}]`);
const fc = [...vf, `${segs.map((_, i) => `[v${i}]`).join("")}amix=inputs=${segs.length}:normalize=0:duration=longest,volume=1.0[vo]`,
  `[0:a][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_rates=48000[a]`].join(";");
fs.writeFileSync(`${dir}/vo-fc.txt`, fc);
sh(`ffmpeg -y -loglevel error -i "${dir}/out/bed.mp4" ${vin} -filter_complex_script "${dir}/vo-fc.txt" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "${dir}/${id}.mp4"`);
fs.rmSync(`${dir}/out/frames`, { recursive: true, force: true });
fs.writeFileSync(`${dir}/${id}.txt`, ex.caption + "\n");
console.log("ok", `${dir}/${id}.mp4`, total, "s");
