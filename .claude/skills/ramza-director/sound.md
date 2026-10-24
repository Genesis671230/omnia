# Sound, beats, transitions

- **Music first, then cut to it.** Pick the bed, note its BPM (`ffmpeg … ebur128` for loudness; BPM from
  the file name or a tap), and put scene changes on beats (at 120 BPM that's 0.5 s per beat; a scene
  is 4, 6 or 8 beats). Voice timing still decides; when a word and a beat are < 4 frames apart, move
  the cut to the beat.
- **SFX vocabulary** (ramza-daily-video/media, Pixabay-licensed): `whoosh` on whips and wipes, `click` on
  UI items, `soft-hit` on stamps and reveals, `riser` (≤ 1.5 s) into the big reveal, a single `bass-hit`
  on the logo. Counters are silent. No synth beeps (founder: "they scare").
- Levels: music −24 to −28 LUFS under the voice, ducked 6 dB under the hit; SFX −18 to −22; voice −14 integrated.
- **Silence is a tool**: drop the music for 0.5–1 s before the twist line, then the hit.
- Transitions must carry meaning: whip = "and next", zoom-through = "inside this", wipe = "on the other
  hand", match cut = "this is the same thing". Never use a transition only for decoration.
