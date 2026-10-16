import fs from "node:fs"; import { execSync } from "node:child_process";
const [dir, outName] = process.argv.slice(2);
const { dur, sfx } = JSON.parse(fs.readFileSync(`${dir}/events.json`));
const SR = 48000;
const ae = (expr, d) => `aevalsrc='${expr}':s=${SR}:d=${d}`;
const S = {
  click: () => ae("0.6*sin(2*PI*1800*t)*exp(-t*70)", 0.1),
  blip: () => ae("0.32*sin(2*PI*1320*t)*exp(-t*28)+0.12*sin(2*PI*2640*t)*exp(-t*40)", 0.25),
  pop: () => ae("0.4*sin(2*PI*(520+900*t)*t)*exp(-t*16)", 0.3),
  rise: () => ae("0.2*sin(2*PI*(260*t+380*t*t/1.3))*min(t/0.25\\,1)*(1-t/1.3)", 1.3),
  chime: () => ae("0.26*(sin(2*PI*880*t)+0.55*sin(2*PI*1318.5*t)+0.25*sin(2*PI*1760*t))*exp(-t*2.6)", 2.0),
  whoosh: () => "anoisesrc=c=pink:a=0.45:d=0.8:r=48000,highpass=f=400,lowpass=f=4200,afade=t=in:d=0.38,afade=t=out:st=0.38:d=0.42,volume=0.7",
  swish: () => "anoisesrc=c=pink:a=0.35:d=0.45:r=48000,highpass=f=1200,afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.27,volume=0.55",
  tick: (d = 1.2) => ae(`0.16*sin(2*PI*2400*t)*exp(-mod(t\\,0.055)*90)*lt(t\\,${d})*(1-t/${d + 0.2})`, d + 0.1),
};
// Music bed: C – Am – F – G, 4.8 s each; soft pad + plucked arpeggio; kick from 0.4 s.
const chords = [[261.63, 329.63, 392, 523.25], [220, 261.63, 329.63, 440], [174.61, 220, 261.63, 349.23], [196, 246.94, 293.66, 392]];
const seg = 4.8, step = 0.3;
const pad = chords.map((c) => ae(`(${c.slice(0, 3).map((f) => `sin(2*PI*${f / 2}*t)+0.4*sin(2*PI*${f}*t)`).join("+")})*0.03*min(t/0.8\\,1)*min((${seg}-t)/0.8\\,1)`, seg));
const arp = chords.map((c) => {
  const pick = `if(eq(mod(floor(t/${step})\\,4)\\,0)\\,${c[0]}\\,if(eq(mod(floor(t/${step})\\,4)\\,1)\\,${c[1]}\\,if(eq(mod(floor(t/${step})\\,4)\\,2)\\,${c[2]}\\,${c[3]})))`;
  return ae(`0.07*sin(2*PI*${pick}*2*mod(t\\,${step}))*exp(-mod(t\\,${step})*7)`, seg);
});
const inputs = [...pad, ...arp];
const f = [];
f.push(`[0][1][2][3]concat=n=4:v=0:a=1,aloop=loop=-1:size=${Math.round(4 * seg * SR)},atrim=0:${dur}[pad]`);
f.push(`[4][5][6][7]concat=n=4:v=0:a=1,aloop=loop=-1:size=${Math.round(4 * seg * SR)},atrim=0:${dur},lowpass=f=3500,aecho=0.8:0.5:300:0.25[arp]`);
inputs.push(ae("0.6*sin(2*PI*(46+70*exp(-mod(t\\,0.6)*30))*mod(t\\,0.6))*exp(-mod(t\\,0.6)*9)", dur));
f.push(`[8]volume=enable='lt(t,0.4)':volume=0,lowpass=f=900[kick]`);
f.push(`[pad][arp][kick]amix=inputs=3:normalize=0,volume=0.8,afade=t=in:d=0.6,afade=t=out:st=${dur - 2.5}:d=2.5[bed]`);
const labels = ["[bed]"];
sfx.forEach((e, i) => {
  if (!S[e.type]) return;
  inputs.push(S[e.type](e.dur));
  const idx = inputs.length - 1, ms = Math.max(0, Math.round(e.t * 1000)), vol = e.vol ?? 1;
  f.push(`[${idx}]volume=${vol},adelay=${ms}|${ms},apad=whole_dur=${dur}[s${i}]`);
  labels.push(`[s${i}]`);
});
f.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first,alimiter=limit=0.89,aformat=channel_layouts=stereo[out]`);
fs.writeFileSync(`${dir}/fc.txt`, f.join(";\n"));
const args = inputs.map((x) => `-f lavfi -i "${x}"`).join(" ");
execSync(`ffmpeg -y -loglevel error ${args} -filter_complex_script ${dir}/fc.txt -map "[out]" -t ${dur} -ar ${SR} ${dir}/audio.wav`, { stdio: "inherit" });
execSync(`ffmpeg -y -loglevel error -framerate 30 -i ${dir}/frames/f%05d.jpg -i ${dir}/audio.wav -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart ${dir}/${outName}`, { stdio: "inherit" });
console.log("ok", outName);
