# Campaign: "Hire the agent for 7 days" (2026-10-20)

Figures come from `config/rules.json` (offer.free_trial, einvoicing, ct) and `templates/facts.json`. Anything marked VERIFY there stays out of paid ads until cleared.

## 1. Strategy in one line
Don't sell accounting. **Sell a finished month.** The free week is the product demo: the founder hands over one month of statements, and the agent hands back a closed month with the problems circled. Everything in the funnel exists to get to that one moment.

**Why this wins in the UAE right now**
- **Fear has a date.** E-invoicing provider appointment for AED 50m+ businesses: 30 Oct 2026 (10 days). Unfiled Dec-2025 Corporate Tax returns are now in month 1 of the AED 500/month meter. Fear gets the view. The trial gets the click.
- **Proof beats promise.** Finance viewers swipe anything that smells like a pitch in about 1.5 s, so the hook is a number, a scene or a named mistake. Never "AI accounting solution".
- **Instagram DMs are a sales channel.** Every reel ends in a comment keyword that opens a DM conversation, not a link in bio.

## 2. The offer stack (what converts)
| Layer | Offer | Job |
|---|---|---|
| Free, no data | Penalty checker, e-invoicing readiness check (site tools) | Catch the scared. Capture WhatsApp + revenue band. |
| **Free, with data (core)** | **7 days of the RAMZA agent**: upload last month's bank statement + one gateway file (+ Zoho read-only if they have it). Within 48 h: the month matched, a "Money not explained" figure, open invoices, missing fees, e-invoicing gaps. | The aha moment. They keep the report either way. |
| Paid, urgent | Late-filer rescue AED 4,999 one-off (until 31 Oct); e-invoicing readiness via accredited partner | Cash now from the scared segment. |
| Paid, recurring | Monthly close by transactions (tier prices still null → "Get a quote") | The real business. |

**Rules for the free week**
- Read-only, revocable, deleted on request. Say this on screen; it's the #1 objection to handing over bank data.
- Day 8: no auto-charge (recommended). A human (accountant) walks them through the report on WhatsApp and quotes from their real transaction count. That call is the close.
- Never promise a saving or a result in ads. Promise the **report**.

## 3. Funnel layers
1. **Attention (organic + paid reels).** Five reels below, posted 1/day; boost the winner after 48 h. Meta: instant-form lead ads (rules.json channels) using the best reel as creative.
2. **Engagement.** Comment keyword → auto-DM (ManyChat or Meta inbox automation): `AGENT` → trial sign-up, `READY` → readiness check, `RESCUE` → CT rescue, `RECON` → free month-end check.
3. **Lead.** Form or DM collects: name, WhatsApp, revenue band (<3m / 3–50m / 50m+), gateways used, accounting software. Routes into `leads` (Telegram alert already wired).
4. **Activation (hours 0–48).** WhatsApp message with an upload link → agent run → report. Nudge at 24 h if nothing is uploaded ("Your agent is waiting for one file").
5. **Aha (day 2–3).** Report delivered as a 4:5 image + PDF: matched %, AED not explained, open invoices, e-invoicing gaps. Noor voice note optional.
6. **Close (day 6–8).** Accountant call on WhatsApp: walk the report, quote by transactions, offer the rescue or readiness add-on where relevant.
7. **Retarget.** 50%-viewers of any reel → the Omnia case-study reel (145 credits, 89% matched). Trial-started-not-uploaded → "one file" reminder reel. Report-delivered-not-converted → day-7 Noor reel.
8. **Refer.** After the first paid month: "Give a founder friend their own 7 days."

**KPIs to watch:** 3-s hold rate > 35%, comment rate, DM → upload rate (target 30%), upload → paid (target 20%).

## 4. Hook ranking (for today)
Scored on: stops the scroll in 1 s, true today, leads to the trial.
1. **"Your bank says AED 18,420 arrived. From who?"** Scene cold-open, a universal e-commerce pain, leads straight to the trial. ★ best fit for the direct offer.
2. **"10 days."** The real deadline number. Best for the e-invoicing segment; already built (agent-ten-days).
3. **"I gave an AI agent our company's books for 7 days."** First-person experiment, curiosity format, uses the Omnia proof honestly.
4. **"POV: it's month end and you have 5 payout emails"** Relatable POV.
5. **"Your accountant vs an agent, same month"** Comparison; must stay factual (time to close, not price).

Not used: "Are you late?" (Meta personal-attributes rule), unverified news angles (e.g. pre-approval removal) until compliance-gate checks the primary MoF text.

## 5. The five reels (today's variants)
Noor appears on the photo / video beats only, always tagged "AI presenter". The agent logo is the character that "takes over" the office. Visual sources: **[H]** = Higgsfield generation (needs credits), **[P]** = licensed photo in `public/ramza/photos` (see SOURCES.md), **[A]** = real RAMZA app capture (`ramza-daily-video/scripts/capture.mjs`), **[M]** = motion design (kit.css).

### R1 `agent-hire-7-days` — direct offer (hook 3), 40 s
| t | Visual | Voice (Noor) |
|---|---|---|
| 0–3 | [H] top-down shot: Noor at a white desk, laptop, phone, coffee; camera pushes down. Text: "7 days." | "We gave an AI agent our own company's books. For seven days." |
| 3–8 | [M] agent logo drops onto the laptop screen, eyes blink, it "boots": office lights switch on row by row over [P] bb-office-team | "Day one, it read every bank line, and every payout file." |
| 8–15 | [A] real recon screen, rows flip to Matched; counter to 145 credits | "September: one hundred forty-five bank credits. Eighty-nine percent matched." |
| 15–22 | [M] Day 1…Day 7 timeline: statements → matched → fees booked → invoices closed → report | "By day seven, the month was closed. And the problems were circled." |
| 22–30 | [H] Noor to camera in a Business Bay office | "Now it's your turn. Seven days, free. Read-only. Delete it any time." |
| 30–40 | [M] sticker agent + "Comment AGENT" | "Comment AGENT, and we'll set yours up." |

### R2 `agent-from-who` — pain → trial (hook 1), 35 s
0–2 [M] bank app push: "+AED 18,420.50 · NETWORK INTL"; big "From who?" · 2–9 [P] in-ecommerce-packing → [M] it splits into 31 orders, 2 refunds, fees, VAT · 9–16 [M] spreadsheet chaos · 16–24 [M] agent eats the line, outputs "Stripe payout · 31 orders · fee AED X · VAT" · 24–30 [H] Noor: "Send us one month. The agent explains every line, free for seven days." · 30–35 CTA AGENT.

### R3 `agent-ten-days` — e-invoicing deadline (hook 2), 37 s. **Built and delivered**; rebuild daily so the count stays true.

### R4 `agent-pov-month-end` — POV (hook 4), 30 s
Already scripted as `agent-inbox-month-end`; change the CTA from RECON to AGENT + "7 days free".

### R5 `agent-vs-accountant-week` — comparison (hook 5), 35 s
Split screen. Left [P] px-accountant-files "Week 1: collecting statements"; right [A] agent "Hour 1: matched". Four rows: collect → match → book fees → report. End: "Your accountant still signs off. The agent does the matching." (positions RAMZA as help, not a threat to the accountant who might refer). CTA AGENT.

## 6. What production needs
- **ElevenLabs:** about 2,500 characters for R1, R2, R4, R5. The connected key still showed the free 10k quota with 14 left on 2026-10-20.
- **Higgsfield:** 3 Noor shots (top-down desk, Business Bay office to camera, desk reaction) as image-to-video, about 5 s each. The connected workspace showed 1 credit / free plan on 2026-10-20.
- **App captures:** run capture.mjs against the live app (recon month-close, Zoho closed).
