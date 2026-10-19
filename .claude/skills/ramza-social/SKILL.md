---
name: ramza-social
description: RAMZA's CMO kit for Instagram / LinkedIn / Meta organic content: HSM-style 4:5 static posts and carousels, "How to save AED X" reels presented by Noor (RAMZA's AI presenter, ElevenLabs voice, lip-sync), captions, hook bank and a content calendar, all reading figures from config/rules.json. Use whenever the founder asks for posts, carousels, a content calendar, social media content, Instagram posts "like HSM", a persona / AI presenter video, CMO work, viral hooks or captions for RAMZA, even if the skill isn't named. For long explainer videos use ramza-daily-video.
---

# RAMZA social

Read `playbook.md` (audience, pillars, compliant hook rewrites, calendar) and `persona.md` (Noor) first.

## Hard rules
Everything in `ramza-daily-video/SKILL.md` "Hard rules" applies (brand, truth, Meta, privacy). In particular:
- Every date, penalty and price comes from `config/rules.json` (injected as `window.RULES` / `R`); Omnia figures from `templates/facts.json` (re-capture monthly with `ramza-daily-video/scripts/capture.mjs`, disclose "Omnia is RAMZA's founding company and first user").
- Never invent studies, client results or savings ("we audited 40 stores"). Never "Are you late?". Never FTA / EmaraTax / MoF names-as-branding, logos or colours.
- Every CTA slide carries "RAMZA is not a registered tax agent…" or "…not an accredited service provider" as relevant.
- Noor is always labelled AI on screen and in the caption.

## Static posts
1. Add or edit a post in `templates/posts.html` (each `post(id, slides, caption)`; slide classes `""`, `navy`, `persona`). Helpers: `aed`, `aedM`, `d(iso).full`, `daysTo`. Put list/visual blocks in `.push` so they sit on the bottom of the slide.
2. `node scripts/render-posts.mjs templates/posts.html <out> [postId]` → `<out>/<post>/slide-N.png` (2160×2700) + `caption.txt`.
3. Tile and look at every slide (`ffmpeg -pattern_type glob -i '<post>/slide-*.png' -vf scale=432:540,tile=5x1 sheet.jpg`). Fix overflow, empty space, unreadable text before delivering.

## Noor reels
1. Add a script to `templates/reels.mjs` (`say` = spoken words with numbers written out, `cap` = on-screen phrases, `visual` = `talk` or `posts/<post>/slide-N.png`). Keep talk segments ≤ 8.5 s.
2. Render the posts first into the same work dir, then `node scripts/build-reel.mjs <reelId> <work>`. Output `<work>/<reelId>.mp4` (1080×1920, loudness −14 LUFS).
3. The JSON it prints says whether lip-sync ran. If `lipsync: NO`, tell the founder it's a preview (portrait push-in), and what's needed (HF_TOKEN in `.env`, or takes from HeyGen/Higgsfield dropped in `reels/<id>/takes/<i>.mp4`).
4. Pull 8 frames and check them; check audio peak ≤ −1 dB.

## Editorial posts (studied 2026-10-18)
`templates/posts-editorial.html`, same renderer: (a) centred white "skills" carousel — `DATE 01` tag over a big headline, one UI object (calendar + pills), one takeaway, source line, "Save this." end card (`07-uae-tax-calendar`, dates computed and sorted from rules.json, past dates drop to an "Already passed" slide); (b) numbered tips over full-bleed photos with a flat wash (`08-seven-ways…`); (c) single hero word + CTA pill (`09-hero-einvoicing`). Washes are flat opacity, never gradients.

## Animated explainers (no presenter)
9:16, 40–55 s, AI voice (ElevenLabs with timestamps) driving word-by-word captions with keyword accents, numbered chips, counters and drawn diagrams.
1. Script in `templates/explainers.mjs`: one segment per scene; `{shown|spoken}` for numbers/dates, `*keyword*` for accent words, `dark: true` for navy scenes.
2. Scenes in `templates/explainers/<id>.html` (one `.scene` per segment, in order). `RL.build()` schedules wipes, progress bars, captions, disclaimer; sync visuals with `RL.w(i, "word")` / `RL.at(i, dt)`. Keep scene content between y 250–1330; captions own 1360–1640.
3. `node scripts/build-explainer.mjs <id> <work> --check "2,6,10,…"` → look at `check-sheet.jpg`; then without `--check` for the MP4 (−14 LUFS, frames deleted after).

## Noor photo posts (photoreal, 2026-10-18)
`templates/posts-noor.html`, same renderer. Split layout: solid white header band with the headline, Noor photo below (`photo(file, headerHeight, objectPosition)` — aim the crop at her face so the fact panel never covers it), flat white fact panel with numbered hairline rows. No website on slides or captions. Photos live in `templates/photos/noor-*.jpg`.
New Noor scenes: Canva `generate-image` with the portrait uploaded as an image reference keeps her face. The result only comes back as a thumbnail, so insert it with `edit-design` `insert_fill` into a scratch design page (create-design ignores media ids), commit, then `export-design` png without size options. The Canva AI-image quota ran out after 4 images on 2026-10-18.

## Photo reels (pain → fix)
Pattern used for `noor-einvoicing-12-days`: ElevenLabs v3 voice with tags (`[urgent]`, `[sighs]`) via `/with-timestamps`, pauses trimmed, word-level captions; each line gets one Noor photo with camera crash-out, punches on keywords, whip cuts, and overlay cards (date, penalty, stamp, checklist) timed to words. Frame 0 must show the hook number and Noor's face.

## Deliver
`~/Desktop/ramza-social/<YYYY-MM-DD>/` with each post folder (PNGs + caption.txt) and each reel (MP4 + caption .txt). Report which items need a founder decision (VERIFY flags in rules.json, null terms).
