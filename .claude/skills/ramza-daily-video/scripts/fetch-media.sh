#!/usr/bin/env bash
# Download the licensed music and sound effects into ../media (git-ignored).
# Sources: HeyGen hyperframes media-use SFX (Pixabay Content License) and the
# buildatscale-tv promo-video skill's Pixabay music. Both allow commercial use.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p media/sfx media/music
SFX=https://raw.githubusercontent.com/heygen-com/hyperframes/main/skills/media-use/audio/assets/sfx
for f in whoosh whoosh-short whoosh-cinematic click-soft chime sparkle riser impact-bass-1 typing pop ping; do
  [ -s "media/sfx/$f.mp3" ] || curl -sfL -o "media/sfx/$f.mp3" "$SFX/$f.mp3"
done
[ -s media/sfx/CREDITS.md ] || curl -sfL -o media/sfx/CREDITS.md "$SFX/CREDITS.md"
MUS=https://raw.githubusercontent.com/buildatscale-tv/claude-code-plugins/main/plugins/promo-video/skills/promo-video/music
for m in inspired-ambient-141686 motivational-day-112790 the-upbeat-inspiring-corporate-142313; do
  [ -s "media/music/$m.mp3" ] || curl -sfL -o "media/music/$m.mp3" "$MUS/$m.mp3"
done
ls media/sfx media/music
