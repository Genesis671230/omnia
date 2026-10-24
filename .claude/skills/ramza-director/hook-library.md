# Hook library

Proven hooks and formats, each with its source and a compliant RAMZA rewrite. Add every new outlier
here (find-outliers.py → clip-finder.py). Ratio = views ÷ the channel's median recent upload.
Numbers in RAMZA rewrites come from rules.json / facts.json at build time. Never type them.

## Outlier study 1 (2026-10-24): niche = UAE tax, e-invoicing, AI accounting
Queries: UAE corporate tax · UAE VAT business owners · Dubai business accounting mistakes · bookkeeping
automation AI · ecommerce accounting cash flow · UAE e-invoicing · accountant AI agent. The first
3 minutes of each were transcribed with whisper (word timestamps), stored with clip-finder.

### A. "How AI Is Automating Accounting Firms (3 Systems You Can Build Now)", Gregory Villar
https://www.youtube.com/watch?v=cKW3XJu2x08 · 9,658 views vs channel median 98 (**98×**) · 6:46
- **Hook (0:00, verbatim):** "Your team is spending 60% of their week on work that AI can handle by tomorrow morning."
  → a quantified pain + a time-to-result promise in one sentence, then "I'm going to show you exactly
  what I would automate … and the order I build it in."
- **Format:** hook → 15 s credibility (NASA JPL, agency of 75 clients) → "why it's still manual"
  (regulated, sensitive, tools built for tech) → competitor fear ("your competitors are not waiting")
  → a **3-question filter** (repetitive? data-driven? prediction?) → numbered systems, each:
  stat → how it works → "picture tax season: 200 emails" → the mistake to avoid ("keep a human in the
  loop") → homework → **mid-video free assessment CTA** at 2:30.
- **Why it wins:** a numbered promise in the title, a framework the viewer can use without buying,
  objections answered before the pitch (human in the loop = our "nothing posts without your click").
- **RAMZA rewrite (reel or long video):** "UAE e-commerce founders: most of your month end is
  matching payouts to orders, and an agent can do that by tomorrow morning. Here are the three
  jobs I'd hand it first, and the order." Filter: *repetitive? matched against a bank line? a
  number you could check?* → (1) payout ↔ order matching, (2) fee and VAT booking, (3) the
  e-invoicing readiness check. CTA: free setup (rules.json). Human-in-the-loop line: "Nothing posts to Zoho without your click."

### B. "I Fired My Bookkeeper for OpenClaw AI", Arlene Xu
https://www.youtube.com/watch?v=1WclctjBsLI · 2,319 views vs channel median 16 (**145×**) · 6:05
- **Hook:** the title and thumbnail do all of it. A personal, contrarian act plus a trending tool
  name. The spoken intro is weak ("Hello everyone, I'm Arlene"). Everything after is a raw **live
  demo**: drag a real bank statement into the agent, watch it type, "25 transactions categorized".
- **Why it wins:** news-jacking a trending AI agent name + an authentic screen demo with a real
  document. It feels like watching a colleague work ("it quite feels like your accountant is working").
- **RAMZA rewrite:** never "fire your bookkeeper" (we don't attack buyers). Use the act and the
  demo instead: "I gave an AI agent last month's bank statement. Here's what it matched in one sitting."
  Real screen recording of the agent on a statement (masked), with counters from facts.json. Title
  pattern: *I gave [trending agent] my [real document]. Here's what happened.*

### C. "Corporate Tax In UAE | Full Guide | Accountant Training", Mastering Accounting Skills
https://www.youtube.com/watch?v=qB9lkwEylfU · 60,202 views vs channel median 753 (**80×**) · 19:31
- **Hook (0:05):** "a perfect easy guide … more informative and more beneficial as compared to any
  other paid training course on the topic." → the "free beats paid" promise, then a step-by-step
  walkthrough (definition → registration → dates → live screen of the portal).
- **Why it wins:** search intent. People type "corporate tax UAE full guide" at deadline time, and a
  complete, calm walkthrough answers it. Evergreen. Runner-up with the same intent: the Emirates
  Association's "Practical Guide to Your First Return Filing" (118×).
- **RAMZA rewrite (blog + long video, organic trust):** "UAE e-invoicing for e-commerce: the complete
  guide (dates, providers, what changes in your books)". Dates from rules.json, no portal or FTA
  branding on screen, "we're not an ASP" stated plainly, and a free readiness check CTA.

Skipped: "Unleashing AI in Accounting and Finance" (1,147×): a 42-view channel median with one 48k
video usually means paid promotion, not organic pull.

## From the sales podcast (2026-10-24)
| Pattern | Their line | RAMZA version |
|---|---|---|
| Breaking belief → "Can I show you?" | "How long does it take for content to work? … It takes six videos. Can I show you?" | "How long does it take to match a month of gateway payouts? [beat] Can I show you?" → close screen |
| Easy-math reframe | "20 people paying $4,000 for 12 months is a million dollars." | "[close_credits] bank credits. [close_matched_pct]% matched before anyone opened a spreadsheet." |
| Specific audience callout (static ad) | "If you're a founder/CEO of a real estate brokerage tired of losing listings…" | "If you run a UAE Shopify store with 3+ payment gateways and your payouts never match your orders…" |
| Reverse urgency | "Probably this is not for you." | "If you have one gateway and 20 orders a month, you don't need us. Everyone else, comment CLOSE." |

## Reel hook patterns (structure, then RAMZA example)
1. **Object + contradiction**: "Your payout is not your sale." (liquid-metal reel, 2026-10-24)
2. **Number + time promise**: "[N] bank lines, matched by tomorrow morning."
3. **Act + document**: "I gave an AI agent last month's bank statement."
4. **Hidden mechanism**: "Two gateways. One bank name. That's why your books don't close."
5. **True deadline**: "[days to date] days until [rules.json date]. Here's the one thing to do first."
6. **Reverse qualify**: "This is not for stores with one payment gateway."

## Thumbnail / cover hooks (2026-10-24, `ramza-social/templates/thumbnails.html`)
Centre card on a real desk object: ink headline, yellow highlighter on the turn, red pen ring on the number.
Render: `node ramza-social/scripts/render-thumbs.mjs <out> [ids]` → 9:16 cover + 4:5 grid crop.
| id | Headline | Pattern | Number source |
|---|---|---|---|
| bank-not-books | AED 1.55M in the bank. Not in the books. | real proof shock | facts.json bank_lines_not_in_zoho_aed |
| 587-vanished | AED 587 vanished. Nobody noticed. | object + mystery (Example) | worked example |
| five-percent | The 5% nobody books. | hidden mechanism | rules vat.standard_rate |
| four-hires | 4 hires. 1 AI agent. | replace-the-team math | rules market.accountant_salary_aed_month |
| sales-up-bank-flat | Sales up. Bank flat. | growth drain contradiction | none (illustrative charts, Example) |
| einvoice-100 | AED 100 per invoice. | true deadline / penalty | rules einvoicing.penalties |
| stop-excel | Stop closing the month in Excel. | "stop doing" command | none |
| gateway-cut | Every gateway takes a cut. Who books it? | question gap | worked example |
Never write "auditor" (regulated title in the UAE): say reviewer / checks every entry.

## Conversation reel (2026-10-24, `ramza-social/templates/films/brokers-aml`)
AI founder asks the question the audience has ("What's the mistake costing brokers the most?"), Noor answers with
an official number on screen (source page screenshot + yellow highlight, camera pushes into the line). Objection
line from the founder ("We're not a bank. Why us?") → answer with the regulator's own words → "So where does the
proof live?" → the books → RAMZA. Off-topic shock (AML fines), product only in the last 20 s.

## Video opener rule (2026-10-24)
Frame 0 = the cover: the hook sits as a real object in the centre (giant sticky note), then macro shots on
the two numbers, then pull back to the desk. First spoken words are the gap ("587 dirhams vanished from one
payout"), never a setup sentence. Hook ≤ 6.5 s.

## Launch-film hooks (Skale portfolio, 2026-10-24) — structure, not copy
- **Era contrast:** "You're scaling with AI… but your finances are run like it's 1920." (T:0) → RAMZA: "Your store runs on AI. Your books still run on Excel."
- **Kill line:** "We killed [the old tools]." + the icons dropping into a bin (Aside).
- **Promise vs reality:** "They promised to do the work. Instead they bury you in buttons. Then they stop when it gets real." (three beats, three visuals).
- **Outcome-first montage:** 5 s of gorgeous finished results before any logo (Replit).
- **Claim flip:** "AI doesn't replace X. It gives you superpowers." (Contra).
- **Story-film:** real person, real failure screen ("Booking failed"), hands over face, then "Meet ___" (Self).
Every one ends on a concrete outcome with a number and a human reaction.

## Pending
- Instagram reel the founder sent (instagram.com/reel/DeuNdmmkT3w): needs a logged-in download
  (see SKILL.md). Transcribe it with clip-finder and add it here.
