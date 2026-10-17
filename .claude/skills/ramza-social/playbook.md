# RAMZA social playbook (CMO brief)

## Who we talk to
1. **UAE e-commerce founders** (Shopify/Woo, 3+ gateways, COD). Pain: payouts that don't match orders, month end in spreadsheets.
2. **UAE SMB owners** facing CT / VAT / e-invoicing dates. Pain: fear of penalties, no idea which date is theirs.
3. **Accounting firms / bookkeepers** with e-commerce clients. Pain: hours of gateway matching per client. Never mock them; they are buyers and partners.

## Reference account: @hsm__uae (studied 2026-10-17)
What works there and what we copy:
- **4:5 single images and short carousels**, one idea each, bold two-tone headline (first half dark, payoff in colour).
- **Dates as objects**: calendar cards, phase boxes ("Phase 1: 30 Oct 2026 / 1 Jan 2027"). Saveable.
- **Brand top-left, website top-right, phone strip bottom** on every slide. We do the same: lockup, ramza.ai, WhatsApp.
- **Talking-head reels** in a real office, big kinetic phrase captions ("Your business can be profitable"), short caption with phone + 5 hashtags.
- **Question hooks** ("Making these VAT mistakes?", "Can profit still leave you broke?").

What we do differently (founder bar + compliance): no sky gradients, no glossy 3D renders, no stock "AI" art; flat white/navy, real photos, real product screens, real numbers from our own books. HSM's posts are generic; ours carry a number you can check.

## Content pillars (weekly mix)
| Pillar | Share | Formats | Example |
|---|---|---|---|
| Deadline & penalty clarity | 35% | carousel, Noor reel | "13 days to appoint your e-invoicing provider" |
| Hidden bleed in e-commerce books | 25% | carousel, before/after video | "Two gateways. One bank name." |
| Build in public (Omnia's real close) | 20% | notepad single, screen video | "Why we built RAMZA, in four numbers" |
| How-to-save (Noor) | 15% | Noor reel + single | "How to save AED 5,000 a month" |
| Offer | 5% | CTA slide inside the above | Free readiness check, late-filer rescue |

## Hook frameworks, made compliant
The pasted viral frameworks are good structure; most of their example hooks are **not usable as written** because they invent data or assert personal attributes. Rewrite rules:

| Framework | Pasted example (don't use) | Why not | RAMZA version |
|---|---|---|---|
| Cost of ignorance | "A late EmaraTax registration just cost them AED 10,000" | EmaraTax name, hardcoded number | "Late CT registration penalty" with the amount read from `ct.late_registration_aed`, no portal names |
| Hidden bleed | "We audited 40 Shopify stores…", "$14,000 gap" | fabricated study / figure | Omnia's real figures from facts.json, disclosed as our own company |
| Contrast teardown | "3 weeks and $4,000 vs 45 seconds and $0" | invented, and RAMZA isn't free | "September: 145 credits, 89% matched automatically" (real) |
| Contrarian | "Why founders are firing their bookkeepers" | attacks a buyer group | "Your accountant shouldn't be matching gateway payouts by hand" |
| Personal-attribute hooks | "Are YOU facing penalties?" | Meta policy | "UAE businesses with a Dec year end…" |

## Carousel skeleton (5–6 slides)
1. Hook: one claim, ≤ 12 words, a date or AED figure in it, a visual object (calendar, bank line, notepad).
2. Agitation: the cost, as a table of rows (penalty schedule, what goes wrong).
3. Mechanism: why it happens (shared acquirer name, netted refunds, phase rules).
4. Fix: three numbered steps, each a verb.
5. Proof: real screen or Omnia figure (disclosed).
6. CTA: comment keyword (READY / RESCUE / RECON / SBR) + WhatsApp + the not-a-tax-agent / not-an-ASP line.

## Reel skeleton (25–35 s, Noor)
0–4 s Noor on camera, the hook with the number · 4–14 s two B-roll slides, voice continues · 14–22 s Noor gives the fix · 22–28 s proof/offer slide · last 4 s Noor: "Comment KEYWORD". Captions are phrases, not subtitles. One CTA.

## Caption formula
Line 1 = the hook restated with the number. Two or three short lines of value (dates, penalty, who it applies to). CTA with keyword. Disclaimer line (source, not tax agent / not ASP, "Noor is RAMZA's AI presenter"). 5–7 hashtags: #UAEBusiness #DubaiBusiness + topic tags.

## Two-week calendar (from Sun 18 Oct 2026; rescue window ends on `campaign.rescue_mode_until`)
| Day | Post | Format |
|---|---|---|
| Sun 18 | 01 E-invoicing provider deadline | carousel |
| Mon 19 | Noor: How to save AED 5,000 a month | reel + 02 single |
| Tue 20 | 04 Two gateways, one bank name | carousel |
| Wed 21 | 03 CT late-filing meter | carousel |
| Thu 22 | Noor: Every month late adds AED 500 | reel |
| Fri 23 | 05 Raw numbers (build in public) | single |
| Sat 24 | Before/after video (existing) | reel |
| Sun 25 | E-invoicing countdown: days left (re-render 01 slide 1) | single |
| Mon 26 | 06 SBR still needs a return | carousel |
| Tue 27 | Noor: phase 2 dates (31 Mar / 1 Jul 2027) | reel (new script) |
| Wed 28 | Month-end explainer (existing) | reel |
| Thu 29 | Final 24h before ASP date | single + story |
| Fri 30 | "Missed today? What happens next" | carousel (new) |
| Sat 31 | Rescue window last day | Noor reel |

Re-render any slide with a countdown on the day it's posted (the day count is computed at render time).

## Before anything ships
- compliance-gate reviews every new claim (dates, penalties, partner licence line). `partner.VERIFY` (Lexoro licence number) is still open; `vat.penalties.VERIFY` is open, so no VAT-penalty posts yet.
- `offer.pay_on_savings.terms` is null: don't run "pay only when we save you money" in paid ads until terms are published.
- Meta: AI-generated realistic people must carry Meta's "AI info" label when posted; we also say it on screen and in the caption.
