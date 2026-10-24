---
name: ramza-daily-video
description: Make RAMZA's daily explainer / promo video (1080p MP4 with music and sound effects) from real Omnia screens and data, in the RAMZA brand. Use whenever the founder asks for a RAMZA video, a daily video, a product demo, an explainer, a reel, a "before and after", an e-invoicing or month-end video, or more videos "like the last ones", even if the word skill isn't used.
---

# RAMZA daily video

Each video is one HTML page with a paused GSAP timeline. `render.mjs` seeks
it frame by frame (exact motion at any fps), `mix.mjs` lays a licensed music
bed and soft sound effects on the cues the page logged. Three finished
templates live in `templates/`; most days you adapt one rather than start
from zero.

## Hard rules (check every one before showing anything)

**Brand (founder's design bar):** safety and trust, never luxury. White and
navy `#0B1533` / night `#050B1F`, ink `#14131C`, hairlines `#E3E7F0`, lilac
`#B3A6FF` only on dark, indigo `#4F35E8` only small. Urbanist for headlines,
IBM Plex Sans for text. Radii 4–12px. No gradients, glows, blurred blobs,
glass, icon bubbles, emoji, or stock "AI" art. The logo is the two-bracket
mark in `public/ramza/brand/` (animate it by sliding the brackets shut).

**Truth:**
- Every figure comes from Omnia's live data (`capture.mjs`) or from
  `config/rules.json` via `rules.js`. Never type a date, penalty or price.
- Pricing that is `null` in rules.json is undecided: say "Get a quote".
- `offer.pay_on_savings.terms` is still null: the line can appear, but flag
  to the founder that terms must be published before paid ads.
- RAMZA is not a registered tax agent and not an ASP. Filing is via a
  licensed partner; e-invoicing goes through an accredited provider.
- Unbuilt features (WhatsApp CFO, Google Drive, document-request agents) are
  shown only with a "Coming soon" tag. See the Built column in `topics.md`.
- No FTA / EmaraTax / MoF logos or colours. Meta-safe copy: never "Are you
  late?", say "UAE businesses with…".
- Never mention Omnia, Omniastores or House of Omnia (founder rule 2026-10-24). Our own numbers are
  "a Dubai e-commerce brand RAMZA was built inside"; no store names, logos or storefronts on screen.
- Privacy: no customer or payee names, no full account numbers (capture.mjs
  masks long digit runs and skips owner transfers). Never film the Zoho books
  or Bank lines tabs for public video.

**Sound:** effects are UI-quiet (clicks, soft whooshes, one bass hit for the
logo). Counters are silent. No synth beeps. Music ducks under the logo hit.

## Workflow

1. **Pick the topic.** Use the founder's request, else the next row of
   `topics.md` not done recently (check `~/Desktop/ramza-videos/`). One
   audience, one pain, one proof, one CTA ("Free readiness check · ramza.ai").
2. **Scaffold.** `scripts/new-video.sh <slug> <template>` → prints the
   project dir under `<repo>/.video-build/` (git-ignored). Templates:
   `before-after` (sheet → Zoho → RAMZA), `month-end` (photo opener, real
   bank line, camera over the close screen, steps, offer, logos),
   `einvoicing` (dates, provider flow, penalties, service, offer).
3. **Capture proof.** Start the app without schedulers
   (`OMNIA_DISABLE_SCHEDULERS=1 npx next dev -p 3456`), then
   `node scripts/capture.mjs <dir> <YYYY-MM>`. Use the month just closed.
   Read the printed facts and put those numbers in the copy.
4. **Write the page.** Edit `<dir>/video.html`. Engine helpers (`engine.js`):
   `E.scene`, `E.wipe` (solid clip-path wipe + whoosh), `E.lines` (masked
   headline rise), `E.kenBurns` (photo push), `E.count` (silent counter),
   `E.draw` (SVG line draw), `E.sfx(type, t)`. Camera moves: scale/x/y on an
   inner `.cam` over a screenshot (zoom in/out), `rotationX/Y` + `z` inside a
   `.persp` parent for the over-the-shoulder tilt, and a push-in that flattens
   to face the viewer for the reveal. Real photos: `PHOTO/`, real logos:
   `GW/`, `LG/`, brand: `BRAND/`. Keep text ≥ 24px, headlines 72–118px.
   45–60 s; scenes 4–10 s; set `window.__DUR`.
5. **Check frames before the full render.**
   `node scripts/render.mjs video.html check 30 "2,8,14,20,26,32,38,44"` then
   tile them (`ffmpeg -i check/frames/f%05d.png -vf scale=640:360,tile=4x2
   -frames:v 1 sheet.jpg`) and look. Fix anything off-brand, cut off,
   overlapping or unreadable. Repeat until clean.
6. **Render + mix.** `node scripts/render.mjs video.html out 30`, then
   `node scripts/mix.mjs out <slug>.mp4 <music> <vol>`. Music:
   `inspired-ambient-141686.mp3` (calm, 0.34), `motivational-day-112790.mp3`
   (steady, 0.26), `the-upbeat-inspiring-corporate-142313.mp3` (energy, 0.2).
   Then **delete `out/frames`**. JPEG frames are ≈250 MB a minute and this
   Mac's disk runs close to full; check `df -h /` before rendering.
7. **Deliver.** Copy to `~/Desktop/ramza-videos/<YYYY-MM-DD>-<slug>.mp4`
   with a `.txt` caption (hook line, 3 short lines of value, CTA, hashtags).
   Spot-check 6 frames of the final MP4 and the audio peak (≈ −6 dB max,
   −22 to −26 dB mean). Tell the founder what's in it and anything that
   needs their decision.

## Files

- `scripts/engine.js`, `base.css`: the motion engine and base styles.
- `scripts/render.mjs`: frame renderer (set `CHROME_PATH` if Playwright's
  bundled Chromium isn't installed).
- `scripts/mix.mjs`: music + SFX mixer. `scripts/fetch-media.sh` downloads
  the Pixabay-licensed media into `media/` (git-ignored, credits included).
- `scripts/capture.mjs`: real screens + data. `scripts/tok.mjs`: local
  session cookie (reads the repo `.env`, never prints secrets elsewhere).
- `scripts/new-video.sh`: project scaffold.
- `templates/*.html`: the three shipped videos. `topics.md`: topic bank.
