# Direction grammar (director + senior designer)

Every second of a RAMZA video is directed: what the viewer sees changes **on the word that means it**.
These are the patterns behind the reference editors, written as rules we can render.

## Reference styles, decoded
**Iman Gadzhi-style editing** (story-led, premium documentary feel):
- Hook in 1–2 s, cold open mid-thought; no logo, no "hi guys".
- One idea per line; **a visual change every 1.5–2.5 s** in the first 10 s, every 3–4 s after.
- Kinetic captions: 1–3 words at a time, centre frame, heavy sans, the **key word in the accent colour
  and 10–15% bigger**; words land on their spoken onset (2 frames early reads as "in sync").
- Punch-ins: on stressed words the frame scales 100 → 112% in 3–4 frames, holds, and eases back on the
  next sentence. Crash zoom (100 → 140% with a whoosh) for the twist.
- Metaphor B-roll: a literal visual for every abstract noun ("money leaking" → a real bank line with the
  fee visibly peeled off). Cuts land on beats; risers into reveals, a hit on the reveal.
- Film language: shallow depth (blur-to-sharp reveals), slow dolly on still images (Ken Burns with
  parallax: subject layer and background layer moving at different speeds).

**Sabri Suby-style direct response** (offer-led):
- Big quantified claim on screen in the first frame (number + outcome).
- Frameworks drawn live: numbered steps, before → after tables, a "stack" that builds item by item with
  a running "value" total, then the price or offer revealed small against it.
- Direct audience callout line ("If you run a UAE Shopify store with 3+ gateways…").
- Hard CTA with a single action, repeated in voice and on screen.

RAMZA uses both, inside the brand bar (ramza-daily-video "Hard rules"): navy/white/ink, Urbanist +
IBM Plex Sans, no emoji, no glow, no gradients on UI. Objects are real-world objects (see below), not abstract 3D.

## Scene grammar: every scene is OPEN → BUILD → REVEAL → EXIT
| Phase | Choices (pick one per scene; never repeat the same one twice in a row) |
|---|---|
| **Open** | `cold-number` (the hook number fills the frame, frame 0) · `shadowed-opener` (subject or object starts in shadow, under a hard vignette/silhouette, a light sweep reveals it on the key word) · `text-first` (one line on navy, then the visual) · `match-in` (the previous scene's shape becomes this scene's object) · `screen-drop` (a product screen falls into place in perspective) |
| **Build** | `stack` (items arrive one per spoken item) · `draw` (an SVG line or arrow draws while it's named) · `count` (silent counter to the spoken number, lands on the word) · `zoom-to-detail` (camera dives to the one cell that matters) · `split` (before left / after right, wipe divides) |
| **Reveal** | `mask-rise` (headline lines rise from a mask) · `blur-to-sharp` · `stamp` (scale 140→100% with a 2-frame shake and a soft hit) · `light-sweep` (a highlight passes across metal or text) · `typewriter` (only for terminal/agent output) · `peel` (a layer peels off to show what's under, e.g. the fee under the payout) |
| **Exit** | `whip` (8-frame motion-blurred pan into the next scene) · `zoom-through` (push into an object until it fills the frame and becomes the next background) · `wipe` (solid clip-path, from the direction of the next idea) · `hard-cut on beat` |

## Camera (a `.cam` wrapper or a Three.js camera)
- **Push-in** (slow, 100→108% over the scene) = "pay attention". **Pull-out** = "here's the big picture".
- **Punch-in** (3–4 frames) on stressed words. **Crash zoom** for the twist. At most one per 5 s.
- **Orbit/tilt** (3D lane or `.persp` parent): 8–15° over a scene. Never orbit and zoom at once.
- **Track** across a long object (a bank statement) with the words following the line being read.
- Camera ends every move with a 6–10 frame ease-out; never a dead stop.

## Positions and layout (9:16 master)
- Rule of thirds: subject on a third line; the eye-line or the number sits on the upper third.
- **Critical content box x 80–1000, y 300–1250.** It survives Reels/TikTok UI and a 4:5 crop
  (`formats.md`). Kinetic captions own the band **y 1000–1250**, or centre frame when a scene is
  type-only. Nothing important below y 1250.
- One focal point per frame. A caption never covers the focal element: the review script checks this.
- Backgrounds: flat navy `#0B1533` / night `#050B1F` or white; real photo with a flat wash; product
  screen in perspective; 3D chrome in the 3D lane. No busy textures behind captions.

## Words on screen
- Spoken words appear when spoken (word timestamps from ElevenLabs or whisper). Captions are phrases of
  1–3 words, never full subtitles. `*keyword*` in the script = accent colour + scale-up + optional punch-in.
- Numbers are objects: they count up silently and land exactly on the spoken number.
- Headline type 96–140 px on 9:16; captions 72–96 px; body ≥ 40 px. Max 6 words on screen at once
  outside a list.
- Entry: 6-frame rise from a mask with a slight overshoot (back.out(1.4)). Exit: 4-frame fade + 20 px drift up.

## Real-world objects, not abstract 3D (founder rule, 2026-10-24)
The founder rejected the liquid-chrome reel: "don't create like this again, do the old way". Default to
the voiced explainer style (ramza-social `templates/explainers/`, ElevenLabs VO driving captions), and
explain with **real accounting objects in their real colours**: a printed bank statement with a
highlighter, the gateway's payout report, a stack of order invoices, AED coins and notes, a calculator,
a receipt roll, a ledger/journal card, a phone with a payout email, a desk. Each object does one job in
the explanation (coins split off the sale for fee / VAT on fee / refund / FX; a line drawn from the
statement to the report; a PAID stamp on the invoice; Dr/Cr lines that balance).
Show the **real accounting being done by the agent**: read the bank line → find the payout file →
split it into orders → fee + VAT on fee + FX journal → invoice marked paid → your click to post.
Worked examples must balance to the fils and are labelled "example" in the disclaimer.
The Three.js lane (`templates/3d/liquid-metal.html`) stays as reference only. Don't use it for
RAMZA content unless the founder asks for it again.

## Value-funnel structure of a reel (what makes it addictive)
`HOOK` 0–2 s (belief-breaking line, a visual object, open loop: "the third one is why your payouts never match")
→ `PROOF` by 6 s → `OBSTACLE` (name the pain precisely) → `METHOD` (Clean Close steps, one beat each)
→ `URGENCY` (a true date) → `OFFER` (free setup) → `CTA` (keyword). Close the open loop just before the
CTA, so people watch to the end, and loop the last frame into the first (same object, same position),
so replays count.

## Launch-film grammar (Skale-style, studied 2026-10-24)
Studied: T:0 by Airwallex (agentic finance, 3M+ views), Aside (1.5M), Replit Slides (1M), Contra Creative Arena,
Self Agent Vault, TypeSafe (40M). Trims + a labelled 3-min study reel in
`~/Desktop/ramza-social/2026-10-24/launch-study/` (reference only, never post). What separates them from
our "cheap" reels:
1. **One word per beat, on the voice.** Text appears word by word, often one word on screen at a time, and
   the layout changes with every phrase (left, centre, split across the frame). No caption bar exists; the
   type IS the picture. Background flips paper ↔ black on the sentence's turn ("…scaling" / "but your finances").
2. **Hand-drawn marks in one accent colour.** A green scribble arrow under "scaling", a scribbled X striking
   "Optimize Finances", an underline under "your business". One colour, drawn on with a stroke animation.
3. **Pain shown as an object multiplying.** "Scaling" stacks 6×; "Connect App +" clones and pixel-dissolves;
   refusal messages ("I can't do that") stack up, then fly away. The problem gets *visibly* heavier.
4. **Old way as thin wireframe.** Hairline timelines (2026 → 1920), empty spreadsheet grid where one cell is
   dragged "by hand", then the grid floods pink: manual work looks archaic and absurd.
5. **The name lands on a full-bleed colour slam** (T:0 on solid green, Replit's giant "Intro" crop then the
   mark, Aside out of light rays). One frame, total silence of everything else.
6. **Real product, real task, real payoff.** Aside types "cancel unused subscriptions and request refunds",
   the agent's steps tick in, ends on "Your $120 refund will be processed" + a human "Dammm, how did you just
   do that?". T:0: question card → table → chart. Always a concrete outcome with a number.
7. **Words with objects inside the sentence.** Replit drops a thumbnail between "pre-designed" and
   "templates"; Aside puts icons inline ("can do ⇥ sign in", "🔒 private"). Copy and visual are one line.
8. **Proof as a race.** Benchmark bars grow, ours on top in the accent colour. Contra: "1st" trophy chip,
   expert faces in corner brackets.
9. **Trust beat with a typed threat.** "Aside won't let AI `read_your_passwords`" typed, then masked ****.
10. **End line = the category sentence, then URL alone.** "Your business, not your books." / "aside.com".
11. Pace: a new visual every 0.5–1 s, no frame static > 1.5 s; music-led with a soft VO; 30–90 s total.

RAMZA mapping (no Omnia, numbers from rules.json/facts.json): paper + ink + ONE accent (RAMZA navy page,
highlighter-yellow scribble). Hook "You're selling more. / But your books are still kept / by hand." →
spreadsheet cell dragged, grid floods → slam "RAMZA" → agent task: "close October" typed, steps tick
(payout matched, fee booked, VAT split, bank line ticked) → payoff "587 found. Month closed." → trust beat
"RAMZA won't `post_without_your_click`" → end "Run your business, not your books." (reword; T:0 owns theirs).
