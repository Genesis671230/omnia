#!/usr/bin/env bash
# Scaffold today's video project: ./new-video.sh <slug> [template]
# Creates <repo>/.video-build/<YYYY-MM-DD>-<slug>/ (git-ignored) with the
# engine, asset links, rules.js from config/rules.json and a copy of a template.
set -euo pipefail
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$SKILL/../../.." && pwd)"
SLUG="${1:?slug}"; TPL="${2:-before-after}"
DIR="$REPO/.video-build/$(date +%F)-$SLUG"
mkdir -p "$DIR/SHOT" "$DIR/data"
grep -qs "^/.video-build/" "$(git -C "$REPO" rev-parse --git-common-dir)/info/exclude" || echo "/.video-build/" >> "$(git -C "$REPO" rev-parse --git-common-dir)/info/exclude"
cp "$SKILL/scripts/engine.js" "$SKILL/scripts/base.css" "$DIR/"
cp "$SKILL/templates/$TPL.html" "$DIR/video.html"
ln -sfn "$REPO/public/ramza/photos" "$DIR/PHOTO"
ln -sfn "$REPO/public/gateways" "$DIR/GW"
ln -sfn "$REPO/public/ramza/logos" "$DIR/LG"
ln -sfn "$REPO/public/ramza/brand" "$DIR/BRAND"
[ -d "$SKILL/node_modules/playwright" ] || (cd "$SKILL" && npm i --silent >/dev/null)
python3 - "$REPO" "$DIR" <<'PY'
import json, sys
repo, d = sys.argv[1], sys.argv[2]
r = json.load(open(f"{repo}/config/rules.json"))
open(f"{d}/rules.js", "w").write("window.RULES = " + json.dumps({k: r[k] for k in ("einvoicing", "offer", "ct", "vat") if k in r}) + ";")
PY
"$SKILL/scripts/fetch-media.sh" >/dev/null
echo "$DIR"
