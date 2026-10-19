/* Build a "live action" reel: real (AI-generated) footage cut to a voice track, with a
 * transparent motion-graphics layer on top.
 *   node build-film.mjs <filmDir> [--check "1,4,9"]
 * <filmDir>/film.json:
 *   { id, music: [file, vol], overlay: "overlay.html",
 *     segments: [{ src, in, dur, zoom?: [from, to] }],          // cut list, in order
 *     voices:   [{ src, at, who, text }] }                      // seconds on the timeline
 * Steps: base.mp4 (cuts scaled to 1080x1920, optional push-in) → overlay frames (ALPHA PNG,
 * same GSAP engine; window.FILM has the cut list and voice times) → composite + voices +
 * music + UI sounds → <id>.mp4 (H.264 High CRF 14, AAC 48k stereo, −14 LUFS).
 * --check renders only overlay frames at those seconds over the base, as a contact sheet. */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../../..");
const VIDEO = path.resolve(HERE, "../../ramza-daily-video");
const TPL = path.resolve(HERE, "../templates/explainers");
const args = process.argv.slice(2);
const dir = path.resolve(args[0]);
const CHECK = args.includes("--check") ? args[args.indexOf("--check") + 1] : null;
const film = JSON.parse(fs.readFileSync(`${dir}/film.json`, "utf8"));
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 26 }).toString().trim();
const dur = (f) => +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`);

// timeline
let t = 0;
const segs = film.segments.map((s) => { const o = { ...s, start: +t.toFixed(3) }; t += s.dur; return o; });
const total = +t.toFixed(3);
const voices = film.voices.map((v) => ({ ...v, len: +dur(path.resolve(dir, v.src)).toFixed(3) }));

// 1. base cut
const base = `${dir}/base.mp4`;
if (!fs.existsSync(base) || args.includes("--rebase")) {
  const ins = segs.map((s) => `-ss ${s.in} -t ${s.dur} -i "${path.resolve(dir, s.src)}"`).join(" ");
  const f = segs.map((s, i) => {
    const n = Math.round(s.dur * 30);
    const cover = "scale=2160:3840:force_original_aspect_ratio=increase:flags=lanczos,crop=2160:3840";
    const z = s.zoom
      ? `,zoompan=z='${s.zoom[0]}+(${s.zoom[1] - s.zoom[0]})*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30`
      : ",scale=1080:1920:flags=lanczos";
    return `[${i}:v]fps=30,${cover}${z},setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS[v${i}]`;
  });
  fs.writeFileSync(`${dir}/base-fc.txt`, [...f, `${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0[v]`].join(";"));
  sh(`ffmpeg -y -loglevel error ${ins} -filter_complex_script "${dir}/base-fc.txt" -map "[v]" -c:v libx264 -preset slow -crf 12 -pix_fmt yuv420p "${base}"`);
}

// 2. overlay page
const work = `${dir}/overlay`;
fs.mkdirSync(work, { recursive: true });
for (const f of fs.readdirSync(TPL)) if (/\.(css|js)$/.test(f)) fs.copyFileSync(`${TPL}/${f}`, `${work}/${f}`);
fs.copyFileSync(`${VIDEO}/scripts/engine.js`, `${work}/engine.js`);
fs.copyFileSync(path.resolve(dir, film.overlay), `${work}/video.html`);
for (const [ln, to] of [["BRAND", "public/ramza/brand"], ["LG", "public/ramza/logos"]]) {
  fs.rmSync(`${work}/${ln}`, { force: true });
  fs.symlinkSync(`${REPO}/${to}`, `${work}/${ln}`);
}
const R = JSON.parse(fs.readFileSync(`${REPO}/config/rules.json`, "utf8"));
fs.writeFileSync(`${work}/data.js`, `window.RULES=${JSON.stringify(R)};window.FILM=${JSON.stringify({ total, segs, voices })};`);
console.log(JSON.stringify({ id: film.id, total, segs: segs.map((s) => [s.start, s.dur]), voices: voices.map((v) => [v.at, v.len]) }));

const render = (out, times) => execSync(`node "${VIDEO}/scripts/render.mjs" "${work}/video.html" "${out}" 30 ${times ? `"${times}"` : ""}`,
  { stdio: "inherit", env: { ...process.env, SIZE: "1080x1920", ALPHA: "1" } });

if (CHECK) {
  render(`${dir}/check`, CHECK);
  const times = CHECK.split(",").map(Number);
  times.forEach((tt, i) => sh(`ffmpeg -y -loglevel error -ss ${tt} -i "${base}" -i "${dir}/check/frames/f${String(i).padStart(5, "0")}.png" -filter_complex "[0:v][1:v]overlay,scale=360:640" -frames:v 1 "${dir}/check/c${i}.jpg"`));
  const cols = Math.min(times.length, 6), rows = Math.ceil(times.length / cols);
  sh(`ffmpeg -y -loglevel error -i "${dir}/check/c%d.jpg" -vf "tile=${cols}x${rows}" -frames:v 1 "${dir}/check-sheet.jpg"`);
  console.log("check sheet", `${dir}/check-sheet.jpg`);
  process.exit(0);
}
render(`${dir}/ov`);

// 3. audio: music bed + UI sounds (cues logged by the page) + voices
const MEDIA = path.resolve(VIDEO, "media");
const MAP = { whoosh: ["whoosh.mp3", 0.38], swish: ["whoosh-short.mp3", 0.22], pop: ["click-soft.mp3", 0.5], click: ["click-soft.mp3", 0.55],
  chime: ["chime.mp3", 0.6], sparkle: ["sparkle.mp3", 0.3], rise: ["riser.mp3", 0.22], impact: ["impact-bass-1.mp3", 0.28], typing: ["typing.mp3", 0.6] };
const { sfx } = JSON.parse(fs.readFileSync(`${dir}/ov/events.json`, "utf8"));
const cues = [];
for (const e of [...sfx].sort((a, b) => a.t - b.t)) if (MAP[e.type] && !(cues.length && e.t - cues[cues.length - 1].t < 0.15)) cues.push(e);
const [music, mvol] = film.music;
const inputs = [`-stream_loop -1 -i "${MEDIA}/music/${music}"`, ...cues.map((c) => `-i "${MEDIA}/sfx/${MAP[c.type][0]}"`), ...voices.map((v) => `-i "${path.resolve(dir, v.src)}"`)];
const ms = (x) => Math.max(0, Math.round(x * 1000));
const fc = [
  `[0:a]atrim=0:${total},volume=${mvol},afade=t=in:d=0.6,afade=t=out:st=${total - 1.5}:d=1.5,aformat=sample_rates=48000:channel_layouts=stereo[m]`,
  ...cues.map((c, i) => `[${i + 1}:a]volume=${MAP[c.type][1]},adelay=${ms(c.t)}|${ms(c.t)},aformat=sample_rates=48000:channel_layouts=stereo[s${i}]`),
  ...voices.map((v, i) => `[${cues.length + 1 + i}:a]adelay=${ms(v.at)}|${ms(v.at)},aformat=sample_rates=48000:channel_layouts=stereo[o${i}]`),
  `[m]${cues.map((_, i) => `[s${i}]`).join("")}${voices.map((_, i) => `[o${i}]`).join("")}amix=inputs=${1 + cues.length + voices.length}:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[a]`,
].join(";");
fs.writeFileSync(`${dir}/audio-fc.txt`, fc);
sh(`ffmpeg -y -loglevel error ${inputs.join(" ")} -filter_complex_script "${dir}/audio-fc.txt" -map "[a]" -t ${total} "${dir}/audio.wav"`);

// 4. composite
sh(`ffmpeg -y -loglevel error -i "${base}" -framerate 30 -i "${dir}/ov/frames/f%05d.png" -i "${dir}/audio.wav" -filter_complex "[0:v][1:v]overlay=format=auto,format=yuv420p[v]" -map "[v]" -map 2:a -c:v libx264 -preset slow -crf 14 -profile:v high -level 4.2 -r 30 -g 60 -bf 2 -maxrate 24M -bufsize 48M -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 192k -ar 48000 -ac 2 -shortest -movflags +faststart "${dir}/${film.id}.mp4"`);
fs.rmSync(`${dir}/ov/frames`, { recursive: true, force: true });
console.log("ok", `${dir}/${film.id}.mp4`, total, "s");
