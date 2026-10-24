#!/usr/bin/env python3
"""Scene finder + clip finder + trimmer for reference videos.

usage: python3 clip-finder.py <url|file> <outDir> [--top 6] [--min 2.5] [--max 9] [--window 240]
       [--query "words to favour"] [--model small]

1. downloads the video (skill .venv yt-dlp, current enough for YouTube) or takes a local file
2. scene cuts with ffmpeg scdet; word-timed transcript of the first --window seconds with whisper
3. scores every sentence-aligned window (min..max s): hook language (numbers, "you", contrast,
   questions, negations, money), loudness, cut density, earliness, and --query words
4. trims the top clips snapped to the nearest cut (clip-N.mp4), writes clips.json, scenes.json,
   transcript.json and a contact sheet (sheet.jpg) for the storyboard

Reference clips are for studying hooks and formats. Publishing someone else's footage needs a
licence, or it has to be short commentary with credit. Default: recreate the format with our own
visuals (templates/), and never post the raw clip.
"""
import json, math, os, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
YTDLP = HERE.parent / ".venv/bin/yt-dlp"
HOOK = re.compile(r"\b(you|your|nobody|no one|never|stop|why|how|secret|mistake|wrong|actually|but|"
                  r"instead|truth|lie|fired|million|thousand|aed|dirham|dollar|\$|percent|%|free|"
                  r"cost|lose|losing|money|tax|penalty|deadline|days?)\b", re.I)
NUM = re.compile(r"\d")

def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)

def arg(argv, k, d):
    return type(d)(argv[argv.index(k) + 1]) if k in argv else d

def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    src, out = argv[0], Path(argv[1])
    top, mn, mx = arg(argv, "--top", 6), arg(argv, "--min", 2.5), arg(argv, "--max", 9.0)
    window, model, query = arg(argv, "--window", 240), arg(argv, "--model", "small"), arg(argv, "--query", "")
    out.mkdir(parents=True, exist_ok=True)

    video = Path(src)
    if not video.exists():
        video = out / "source.mp4"
        if not video.exists():
            r = sh([str(YTDLP), "-q", "--no-warnings", "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                    "--merge-output-format", "mp4", "-o", str(video), src])
            if r.returncode:
                sys.exit("download failed: " + r.stderr[-400:])

    # scene cuts
    r = sh(["ffmpeg", "-hide_banner", "-t", str(window), "-i", str(video), "-vf", "scdet=t=10", "-an", "-f", "null", "-"])
    cuts = sorted(float(m) for m in re.findall(r"lavfi\.scd\.time:\s*([\d.]+)", r.stderr))
    json.dump(cuts, open(out / "scenes.json", "w"))

    # transcript (cached)
    tj = out / "transcript.json"
    if not tj.exists():
        wav = out / "audio.wav"
        sh(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-t", str(window), "-ac", "1", "-ar", "16000", str(wav)])
        sh(["whisper", str(wav), "--model", model, "--word_timestamps", "True", "--output_format", "json",
            "--output_dir", str(out)])
        (out / "audio.json").rename(tj)
    segs = json.load(open(tj))["segments"]

    # loudness per second
    r = sh(["ffmpeg", "-hide_banner", "-t", str(window), "-i", str(video), "-af",
            "aresample=16000,asetnsamples=n=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"])
    rms = [float(x) for x in re.findall(r"RMS_level=(-?[\d.]+)", r.stderr) if x not in ("-inf",)]
    def loud(a, b):
        sl = rms[int(a * 1):int(b * 1) + 1] or [-40]
        return (sum(sl) / len(sl) + 40) / 40  # ~0..1

    qwords = [w.lower() for w in query.split()]
    cands = []
    for i in range(len(segs)):
        text, a = "", segs[i]["start"]
        for j in range(i, len(segs)):
            text += segs[j]["text"]
            b = segs[j]["end"]
            if b - a > mx:
                break
            if b - a < mn:
                continue
            t = text.strip()
            score = (len(HOOK.findall(t)) * 1.0 + len(NUM.findall(t)) * 0.6 + t.count("?") * 1.5
                     + sum(t.lower().count(q) for q in qwords) * 2
                     + loud(a, b) * 2
                     + sum(1 for c in cuts if a <= c <= b) * 0.4
                     + max(0, 1 - a / 60) * 2.5)  # the first minute is where hooks live
            cands.append({"start": round(a, 2), "end": round(b, 2), "text": t, "score": round(score / math.sqrt(b - a), 3)})

    cands.sort(key=lambda c: c["score"], reverse=True)
    picked = []
    for c in cands:
        if all(c["end"] <= p["start"] or c["start"] >= p["end"] for p in picked):
            picked.append(c)
        if len(picked) == top:
            break
    snap = lambda t: min(cuts, key=lambda c: abs(c - t)) if cuts and min(abs(c - t) for c in cuts) < 0.6 else t
    for n, c in enumerate(sorted(picked, key=lambda c: c["start"]), 1):
        c["clip_start"], c["clip_end"] = round(snap(c["start"]), 2), round(snap(c["end"]) + 0.15, 2)
        c["file"] = f"clip-{n}.mp4"
        sh(["ffmpeg", "-v", "error", "-y", "-ss", str(c["clip_start"]), "-to", str(c["clip_end"]), "-i", str(video),
            "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-c:a", "aac", str(out / c["file"])])
        sh(["ffmpeg", "-v", "error", "-y", "-ss", str((c["clip_start"] + c["clip_end"]) / 2), "-i", str(video),
            "-frames:v", "1", "-vf", "scale=360:-2", str(out / f"clip-{n}.jpg")])
    picked.sort(key=lambda c: c["clip_start"])
    json.dump(picked, open(out / "clips.json", "w"), indent=1)
    if picked:
        sh(["ffmpeg", "-v", "error", "-y", "-pattern_type", "glob", "-i", str(out / "clip-*.jpg"),
            "-vf", f"scale=360:-2,tile={min(len(picked), 6)}x1", "-frames:v", "1", str(out / "sheet.jpg")])
    for c in picked:
        print(f'{c["clip_start"]:>7.2f}–{c["clip_end"]:<7.2f} {c["score"]:>5}  {c["text"][:90]}')
    print(f"{len(cuts)} cuts in the first {window}s · clips in {out}")

if __name__ == "__main__":
    main(sys.argv[1:])
