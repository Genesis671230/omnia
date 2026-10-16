# RAMZA explainer videos

Deterministic motion pieces: each `*.html` builds one paused GSAP timeline and
`render.mjs` seeks it frame by frame (30 fps, 1920×1080), so motion is exact.
`mix.mjs` builds the music bed and places the sound cues each page logs.

Asset folders the pages expect next to them (symlinks):
`PHOTO` → public/ramza/photos, `GW` → public/gateways, `LG` → public/ramza/logos,
`SHOT` → a fresh Month close screenshot (omnia-sep-full.png), and `rules.js`
generated from config/rules.json (`window.RULES = {einvoicing, offer}`), so
dates, penalties and the offer line are never typed into a video.

    node render.mjs einvoicing.html out-b 30
    node mix.mjs out-b ramza-einvoicing-explainer.mp4

Brand rules: solid navy/white, small radii, real photos/logos/screens; no
gradients, glows or icon bubbles (see the design quality bar).
