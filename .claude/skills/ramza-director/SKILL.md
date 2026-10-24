---
name: ramza-director
description: RAMZA's video director and senior motion designer. A proven, evolving pipeline for reels, explainers and ads — outlier research (videos that beat their channel's usual views), hook library, scene/clip finder and trimmer for reference videos, scripting on the sales system, word-synced direction (camera, zoom, position, openers, revealers, kinetic captions), real-world accounting objects (bank statement, payout report, invoices, AED coins, journal), sound and beat timing, a frame review gate (no clutter, captions never over the visual, platform safe zones), a storyboard page, and exports for Instagram, Meta, LinkedIn and TikTok. Use whenever the founder asks for a reel, video, explainer, 3D or liquid-metal video, storyboard, hooks, viral formats, competitor/outlier research, clip finding or trimming, or "videos like Iman Gadzhi / Sabri Suby", even if the skill isn't named.
---

# RAMZA director

This skill directs; `ramza-daily-video` (GSAP renderer, mixer) and `ramza-social` (posts, Noor reels,
explainers, ElevenLabs voice) do the rendering. Copy and offers come from `ramza-sales-system` and the
`sales-director` agent.

## Hard rules
- All of `ramza-daily-video` "Hard rules" (brand, truth, privacy, sound) and `ramza-sales-system` rules.
- **Never mention Omnia** (or Omniastores / House of Omnia), and never show their logo, store, or names
  on screen, in VO or in captions. Our own numbers are "a Dubai e-commerce brand RAMZA was built inside".
- Captions never cover the focal visual; no text outside the critical box (`formats.md`). `review.mjs` must pass.
- Reference clips from other creators are for study. Never post them raw (see clip-finder header).

## Pipeline (every video, in order)
1. **Research.** `python3 scripts/find-outliers.py "<niche query>" … --min-ratio 3` → videos beating
   their channel median. For the top 3: `python3 scripts/clip-finder.py <url> <work>/ref-N` → scenes,
   word-timed transcript, top hook clips, contact sheet. Add hooks and formats to `hook-library.md`.
2. **Script.** Pick a hook pattern from `hook-library.md` and a format; write beats
   HOOK → PROOF → OBSTACLE → METHOD → URGENCY → OFFER → CTA (`direction.md`, "Value-funnel structure").
   Numbers only from rules.json / facts.json. Run the script through the `sales-director` agent (≥ 8/10).
3. **Direct.** For every beat choose open / camera / reveal / exit / sound from `direction.md` and
   `sound.md`. No two consecutive beats share an open or an exit. Write them into `window.BEATS` in
   the page.
4. **Build.** Default: ramza-social voiced explainers with real accounting objects (`direction.md`,
   "Real-world objects"). The liquid-metal 3D template is reference only (founder rejected it). Templates: ramza-social explainers (`templates/explainers/*.html`, voice-timed), or ramza-daily-video
   templates (screens, photos). `node scripts/data.mjs <dir>` writes `data.js` (RULES, FACTS).
   Mark the focal element with `data-focus` and captions with `.cap` or `data-cap`.
5. **Review gate.** `node scripts/review.mjs <page> <work>/review 0.25` must print 0 failures. Then
   check frames: `SIZE=1080x1920 node ../ramza-daily-video/scripts/render.mjs <page> <work>/check 30 "t1,t2,…"`
   and tile them. Look for weak hierarchy, dead frames, repeated moves, off-brand colour.
6. **Storyboard.** `node scripts/storyboard.mjs <page> <work>/storyboard --title "<Name>"` → one
   self-contained page (frames + direction per beat). Publish it as an Artifact for the founder.
7. **Render + mix + formats.** Full render (`SIZE=1080x1920`), `mix.mjs` with a music bed
   (`sound.md`), delete frames, then `bash scripts/export-formats.sh <master.mp4> <deliverDir> <slug>`
   → 9:16 / 4:5 / 1:1 / 16:9. Check 6 frames and the audio levels (peak ≤ −1 dB, mean −22…−26 dB).
8. **Deliver + learn.** `~/Desktop/ramza-social/<date>/<slug>/` with formats and a caption .txt.
   Add a row to `feedback-log.md`, then fill in results when the founder reports them.

## Files
- `direction.md`: scene grammar, camera, layout, kinetic type, the 3D lane, Iman Gadzhi / Sabri Suby decoded.
- `formats.md`: sizes, safe zones, encoding. `sound.md`: beats, SFX, transitions with meaning.
- `hook-library.md`: proven hooks and formats from outlier videos (transcribed), RAMZA rewrites.
- `feedback-log.md`: the evolving memory. Read the last 10 rows before every script.
- `scripts/`: find-outliers.py, clip-finder.py, review.mjs, storyboard.mjs, export-formats.sh, data.mjs.
  The `.venv/` holds a current yt-dlp (`/opt/homebrew/bin/python3.12 -m venv .venv && .venv/bin/pip install -U yt-dlp`).
- `templates/3d/liquid-metal.html`: rejected 3D style, reference only. Don't reuse it unless asked.
