# Formats, resolutions, safe zones

Master is always **9:16 1080×1920, 30 fps**. The other formats are made from the master by
`scripts/export-formats.sh`. A template can also re-render natively with `SIZE=WxH` when the
layout reads CSS vars.

| Platform | Placement | Size | Notes |
|---|---|---|---|
| Instagram | Reels | 1080×1920 | UI covers ≈ top 220 px and bottom 400 px; the right 120 px holds buttons |
| Instagram / Facebook | Feed video | 1080×1350 (4:5) | centre crop of the master, y 285–1635 |
| Facebook / Meta ads | Reels & Stories | 1080×1920 | Meta asks for ~14% top and ~35% bottom free of key text in ads |
| TikTok | Feed | 1080×1920 | bottom ≈ 420 px caption/UI, right 140 px buttons |
| LinkedIn | Feed video | 1080×1350 (4:5) or 1080×1080 | 4:5 is the best default; burn in captions (mostly muted) |
| LinkedIn / YouTube | Landscape | 1920×1080 | master pillar-boxed on flat navy (no blurred copy) |
| YouTube | Shorts | 1080×1920 | same as Reels |

Encoding: H.264 High, yuv420p, CRF 18 (IG/FB/TikTok), CRF 20 (LinkedIn), AAC 192k, −14 LUFS, true peak ≤ −1 dB,
`+faststart`. Under 60 s for Reels/TikTok organic; 15–30 s for ads.

**Critical box** for every master: x 80–1000, y 300–1250. It is inside every platform's UI and
inside the 4:5 crop. `scripts/review.mjs` enforces it.
