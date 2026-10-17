# Noor: RAMZA's AI presenter

**Who she is:** a fictional AI finance analyst who explains UAE deadlines and "how to save AED X" in 30 seconds. She is not a real person, not an accountant and not a tax agent, and never claims to be. Portrait generated with FLUX.1 Krea (2026-10-17), file `public/ramza/persona/noor-desk.png`.

**Look:** early thirties, navy blazer, white blouse, dark hair in a low bun, white desk, laptop, Business Bay glass behind. Always the same portrait (or lip-synced takes made from it) so she stays recognisable. No glamour shots, no luxury props.

**Voice:** ElevenLabs "Sarah: mature, reassuring" (`EXAVITQu4vr4xnSDxMaL`), multilingual v2, stability 0.5, style 0.2. Calm, plain English, short sentences. Numbers spoken in words ("five thousand dirhams"); captions show digits.

**What she says:** one number, one date, one fix, one keyword. "If your UAE business…", never "Are you…". She talks about Omnia only as "our own company".

**Disclosure (every time):** "AI presenter" tag on screen, "Noor is RAMZA's AI presenter" in the caption, and Meta's AI label switched on when posting.

**Lip-sync:** `scripts/leaptalk.py` (Hugging Face LeapTalk, ≤ 9 s per take). Needs `HF_TOKEN` in the repo `.env`; without it the reel uses a slow push-in on the portrait and the build log says so. Paid alternatives that look better on long takes: HeyGen / Higgsfield (add credits).
