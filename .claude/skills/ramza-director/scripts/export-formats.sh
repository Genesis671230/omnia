#!/bin/bash
# Make every platform format from a 9:16 1080x1920 master.
#   export-formats.sh master.mp4 outDir [slug]
# → <slug>-9x16.mp4 (IG/FB Reels, TikTok, Shorts), -4x5.mp4 (IG/FB feed, LinkedIn),
#   -1x1.mp4 (LinkedIn square), -16x9.mp4 (LinkedIn/YouTube landscape, pillar-boxed on flat navy).
# The 4:5 and 1:1 versions are centre crops, which is why masters keep critical content in y 300–1250.
set -euo pipefail
IN="$1"; OUT="$2"; SLUG="${3:-$(basename "${IN%.*}")}"
mkdir -p "$OUT"
ENC=(-c:v libx264 -profile:v high -pix_fmt yuv420p -preset slow -movflags +faststart -c:a aac -b:a 192k)
ffmpeg -v error -y -i "$IN" -vf "scale=1080:1920,setsar=1" -crf 18 "${ENC[@]}" "$OUT/$SLUG-9x16.mp4"
ffmpeg -v error -y -i "$IN" -vf "crop=1080:1350:0:285,setsar=1" -crf 18 "${ENC[@]}" "$OUT/$SLUG-4x5.mp4"
ffmpeg -v error -y -i "$IN" -vf "crop=1080:1080:0:240,setsar=1" -crf 20 "${ENC[@]}" "$OUT/$SLUG-1x1.mp4"
ffmpeg -v error -y -i "$IN" -vf "scale=-2:1080,pad=1920:1080:(ow-iw)/2:0:color=0x0B1533,setsar=1" -crf 20 "${ENC[@]}" "$OUT/$SLUG-16x9.mp4"
for f in "$OUT/$SLUG"-*.mp4; do
  echo "$(basename "$f")  $(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$f")  $(du -h "$f" | cut -f1)"
done
