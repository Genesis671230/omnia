# The discovery call: three gates of hell

A 20–30 minute WhatsApp or Zoom call. The call has two jobs: **qualify to pitch, or disqualify.**
Nobody hears the method or the price until they pass all three gates. You are not blocking the gate;
you are guiding them through it with questions. At every gate: if they are not aligned, **realign,
educate, or disqualify**. A bad client who got through is the salesperson's fault.

## 0. Rapport (2 min) → context
Rapport sets the wall height for the rest of the call. Then the context and permission line:
> "Before I show you anything, I need to know whether we can actually help you. If we can, I'll walk
> you through how it works. If we can't, the best thing I can do is point you to someone who can.
> To find out, I'll ask a few questions about how your books run today. Is that fair?"

## Gate 1: Need (clarity only, no price)
Ask at least **three levels of "why"**, with dumb curiosity. A surface answer ("I need an accountant")
means nothing yet.
- "What made you reach out now?" → "What specifically is breaking?"
- "How many gateways and marketplaces? Roughly how many orders and bank lines a month?" (feeds `priceForTxn`)
- "Who does the books today, and how long does month end take?"
- "Have you tried fixing this before? What happened? What did it cost?"
- "If this were solved, what would be different by the 5th of next month?"
Pass only when their outcome and our outcome (Clean Close) are the same thing. If they want
something we don't do (tax-agent filing in our own name, audit, payroll), say so and disqualify kindly,
with a check-in a few months later.

## Gate 2: Decision maker, decision process, timeline
- "Besides you, who decides on this?" B2C or small owner-run business: the partner joins, or we pause.
  B2B: make the contact a **champion** and learn the process ("Walk me through how you decided on your
  last software or accountant").
- "When do you want the first month closed?" Now (this week) = **hot**: push. Later with a real reason
  (quarter planning, a deadline in rules.json) = **nurture**: helpful check-ins, no pressure. Later
  with no reason ("busy") → realign: "What changes in three months that makes you less busy?"
- Someone on the call while driving or about to travel: rebook. They can't decide anyway.

## Gate 3: Budget (never say the price first)
- "What were you planning to spend on this a month?" If they won't say, give the range in tiers
  (from rules.json; if tiers are null, give the competitor anchor as context, never an invented number).
- Low budget → which kind? **Access** (they don't have it) → disqualify. **Allocation** (they don't yet
  see the value) → "If everything I show you makes sense, is [range] something you'd invest?" → pitch.

## The pitch (only after all three gates)
1. **Belief-breaking question** (offer-stack.md table): "How long do you think it takes to match one
   month of Tabby and Stripe payouts to orders?"
2. **Proof** straight away: the real close screen and numbers.
3. **Method**: Clean Close, the 5 steps. **Process**: what, why, when, how. Day 1 read-only connect,
   free setup, first close inside the trial, then billing (rules.json terms).
4. **Shut up.** Wait for buying questions ("How do we start?").

## Objections
"I completely agree. Tell me why you believe that." Dig under the surface answer. Use the gates as
ammunition: "When we spoke about timing you said this month. What changed?" "You said that if it made
sense, [range] was fine. Which part doesn't make sense yet?"

## The 1–10 close
"Ten is 'start now', one is 'I hate it'. Where are you?" → "Why not a one?" (they list what they love)
→ "What would make it a ten?" Small tweak → fix it and start. Big gap → back to the method.
**Never end a call without the next call booked in the calendar.** No "send me a deck".

## Log after every call (CRM fields)
need_ok, decision_maker, process, timeline (hot/nurture), budget_type (access/allocation), score_1_10,
next_call_at, outcome. These are proposed `leads` columns. Add them via `db/schema.sql` + `node db/apply-schema.mjs`.
