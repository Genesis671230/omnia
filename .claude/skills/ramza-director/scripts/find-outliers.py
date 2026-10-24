#!/usr/bin/env python3
"""Find videos that beat their own channel's usual views (outliers).

usage: python3 find-outliers.py "<query>" ["<query>" ...] [--per 25] [--min-ratio 3] [--top 15] [--out outliers.json]

For each query: search YouTube (yt-dlp, no login). Stage 1 ranks every hit by
views / channel subscribers; stage 2 takes the --top hits, pulls each channel's
recent uploads (public /videos page) and scores the hit as views / channel median. Ratio >= --min-ratio is an outlier. Results are sorted by
ratio and written as JSON (url, title, channel, views, median, ratio, duration).
"""
import json, re, statistics, subprocess, sys
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36"

def parse_views(txt):
    mult = {"K": 1e3, "M": 1e6, "B": 1e9}.get(txt[-1], 1)
    return int(float(txt.rstrip("KMB").replace(",", "")) * mult)

VENV = Path(__file__).resolve().parent.parent / ".venv/bin/yt-dlp"
YTDLP = str(VENV) if VENV.exists() else "yt-dlp"

def ytdlp(*args):
    r = subprocess.run([YTDLP, "-J", "--flat-playlist", "--no-warnings", *args],
                       capture_output=True, text=True, timeout=180)
    out = r.stdout[r.stdout.find("{"):] if "{" in r.stdout else ""
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None

def main(argv):
    queries, per, min_ratio, out, top = [], 25, 3.0, "outliers.json", 15
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--per": per = int(argv[i + 1]); i += 2; continue
        if a == "--min-ratio": min_ratio = float(argv[i + 1]); i += 2; continue
        if a == "--top": top = int(argv[i + 1]); i += 2; continue
        if a == "--out": out = argv[i + 1]; i += 2; continue
        queries.append(a); i += 1
    if not queries:
        sys.exit(__doc__)

    hits, medians = {}, {}
    for q in queries:
        res = ytdlp(f"ytsearch{per}:{q}") or {}
        for e in res.get("entries") or []:
            if e and e.get("view_count") and e.get("channel_id"):
                e["_query"] = q
                hits[e["id"]] = e
        print(f"[search] {q}: {len(res.get('entries') or [])} results", file=sys.stderr)

    # stage 1: views / subscribers, one flat call per channel (fast prefilter)
    subs = {}
    for cid in {h["channel_id"] for h in hits.values()}:
        ch = ytdlp("--playlist-end", "1", f"https://www.youtube.com/channel/{cid}/videos") or {}
        subs[cid] = ch.get("channel_follower_count") or 0
    pre = sorted((h for h in hits.values() if subs.get(h["channel_id"])),
                 key=lambda h: h["view_count"] / subs[h["channel_id"]], reverse=True)[:top]

    # stage 2: median of the "N views" labels on the channel's public /videos page
    # (yt-dlp's full extractor needs an up-to-date install; the page needs no login)
    for cid in {h["channel_id"] for h in pre}:
        html = subprocess.run(["curl", "-sL", "-A", UA, "-H", "Accept-Language: en-US,en", "-b", "CONSENT=YES+1",
                               f"https://www.youtube.com/channel/{cid}/videos"],
                              capture_output=True, text=True, timeout=60).stdout
        views = [parse_views(m) for m in re.findall(r'"([0-9][0-9.,]*[KMB]?) views"', html)][:30]
        print(f"[channel] {cid}: {len(views)} uploads", file=sys.stderr)
        if len(views) >= 5:
            medians[cid] = statistics.median(views)
    hits = {h["id"]: h for h in pre}

    rows = []
    for h in hits.values():
        med = medians.get(h["channel_id"])
        if not med:
            continue
        rows.append({
            "url": h.get("url") or f"https://www.youtube.com/watch?v={h['id']}",
            "title": h.get("title"), "channel": h.get("channel"),
            "views": h["view_count"], "channel_median": int(med),
            "ratio": round(h["view_count"] / med, 1),
            "duration_s": h.get("duration"), "query": h["_query"],
        })
        rows[-1]["subscribers"] = subs.get(h["channel_id"])
    rows.sort(key=lambda r: r["ratio"], reverse=True)
    json.dump([r for r in rows if r["ratio"] >= min_ratio], open(out, "w"), indent=1, ensure_ascii=False)
    for r in rows[:15]:
        print(f'{r["ratio"]:>6}x  {r["views"]:>9,}  med {r["channel_median"]:>8,}  {r["channel"][:24]:<24}  {r["title"][:70]}')

if __name__ == "__main__":
    main(sys.argv[1:])
