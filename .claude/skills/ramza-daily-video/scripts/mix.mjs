/* Mix a rendered video: a real music bed (Pixabay, see music/CREDITS) under
 * real sound effects (Pixabay, sfx/CREDITS.md), placed at the cues the page
 * logged. Effects are quiet on purpose: they should feel like UI, never like
 * an alarm. Usage: node mix.mjs <outDir> <file.mp4> [music-file] [music-vol]
 * Video: H.264 High@4.2, 30 fps, CRF 14 capped at 24 Mbps, BT.709 tagged — Instagram and
 * Facebook re-encode everything, and a high-bitrate source is what keeps text sharp after.
 * Media comes from ../media (scripts/fetch-media.sh) or $RAMZA_MEDIA. */
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const [dir, outName, musicArg = "inspired-ambient-141686.mp3", musicVolArg = "0.32"] = process.argv.slice(2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const MEDIA = process.env.RAMZA_MEDIA ?? path.resolve(HERE, "../media");
const { dur, sfx } = JSON.parse(fs.readFileSync(`${dir}/events.json`));

// cue type -> [sample, gain, trim seconds or null]
const MAP = {
  whoosh: ["whoosh.mp3", 0.38, null],
  swish: ["whoosh-short.mp3", 0.22, null],
  pop: ["click-soft.mp3", 0.55, null],
  blip: ["click-soft.mp3", 0.3, null],
  click: ["click-soft.mp3", 0.6, null],
  chime: ["chime.mp3", 0.7, null],
  sparkle: ["sparkle.mp3", 0.3, null],
  rise: ["riser.mp3", 0.22, 2.4],
  impact: ["impact-bass-1.mp3", 0.22, null],
  typing: ["typing.mp3", 0.9, null],
  tick: null, // counters stay silent
};

// keep at most one cue per 150 ms, so staggered reveals don't machine-gun
const cues = [];
for (const e of [...sfx].sort((a, b) => a.t - b.t)) {
  const m = MAP[e.type];
  if (!m) continue;
  if (cues.length && e.t - cues[cues.length - 1].t < 0.15) continue;
  cues.push({ ...e, m });
}

const inputs = [`-stream_loop -1 -i "${path.resolve(MEDIA, "music", path.basename(musicArg))}"`];
const f = [];
const impacts = cues.filter((c) => c.type === "impact").map((c) => c.t);
// music: fade in/out, and dip under each impact so the logo moment lands
const duck = impacts.map((t) => `volume=enable='between(t,${t - 0.05},${t + 1.2})':volume=0.45`).join(",");
f.push(`[0]atrim=0:${dur},asetpts=N/SR/TB,volume=${musicVolArg}${duck ? "," + duck : ""},afade=t=in:d=1.2,afade=t=out:st=${dur - 3}:d=3[bed]`);
const labels = ["[bed]"];
cues.forEach((c, i) => {
  const [file, gain, trim] = c.m;
  inputs.push(`-i "${path.resolve(MEDIA, "sfx", file)}"`);
  const ms = Math.max(0, Math.round(c.t * 1000));
  const vol = gain * (c.vol ?? 1);
  const cut = trim ? `atrim=0:${trim},afade=t=out:st=${trim - 0.6}:d=0.6,` : "";
  f.push(`[${i + 1}]${cut}volume=${vol.toFixed(3)},adelay=${ms}|${ms},apad=whole_dur=${dur}[s${i}]`);
  labels.push(`[s${i}]`);
});
f.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first,alimiter=limit=0.9,aformat=sample_rates=48000:channel_layouts=stereo[out]`);
fs.writeFileSync(`${dir}/fc.txt`, f.join(";\n"));
execSync(`ffmpeg -y -loglevel error ${inputs.join(" ")} -filter_complex_script ${dir}/fc.txt -map "[out]" -t ${dur} ${dir}/audio.wav`, { stdio: "inherit" });
execSync(`ffmpeg -y -loglevel error -framerate 30 -i ${dir}/frames/f%05d.jpg -i ${dir}/audio.wav -c:v libx264 -preset slow -crf 14 -profile:v high -level 4.2 -pix_fmt yuv420p -r 30 -g 60 -bf 2 -maxrate 24M -bufsize 48M -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 192k -ar 48000 -ac 2 -shortest -movflags +faststart ${dir}/${outName}`, { stdio: "inherit" });
console.log("ok", outName, cues.length, "cues");
