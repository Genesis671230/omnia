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

## Deliver
`~/Desktop/ramza-social/<YYYY-MM-DD>/` with each post folder (PNGs + caption.txt) and each reel (MP4 + caption .txt). Report which items need a founder decision (VERIFY flags in rules.json, null terms).
