# The offer stack, filled in for RAMZA

A vague offer gets compared on price and the cheapest wins. RAMZA does not compete on price
(competitor anchor in `pricing.competitor_anchor`): it competes on a specific outcome, a named method,
proof, and zero effort from the client.

| # | Part | The rule | RAMZA |
|---|---|---|---|
| 1 | **Specific dream outcome** | Not "we help you grow". A number, a date, a result. | "Your month closes by the 5th: every bank credit matched to its gateway payout and invoice, fees and VAT booked." |
| 2 | **Obstacles (5–6)** | List what actually stops this audience from reaching the outcome. | (a) gateways net fees and refunds, so payouts never equal orders; (b) several gateways share one acquirer name on the bank line; (c) COD courier vouchers arrive as PDFs; (d) SAR/KWD/QAR orders settle in AED, leaving FX residue; (e) the accountant matches by hand and bills by the hour; (f) dates keep coming (CT, VAT, e-invoicing in rules.json). |
| 3 | **Value stack** | Each stack item kills one obstacle. The price must look small next to it. | (a) payout ↔ order matcher per gateway; (b) acquirer-token bank matching; (c) COD voucher reader; (d) FX difference booked to the right account; (e) Zoho posting on your click; (f) deadline calendar + e-invoicing readiness check (`offer.free_trial.includes`). |
| 4 | **Perceived likelihood (proof)** | Every claim is followed by proof: a real screen, a real number. | Real figures from `ramza-social/templates/facts.json` (close credits, % matched, AED to close), shown as "a Dubai e-commerce brand RAMZA was built inside". Never invent client results. |
| 5 | **Less time and effort** | Short time to first result; the client thinks about nothing but yes or no. | First result inside the 7-day trial (`offer.free_trial.days`). We connect read-only, we set it up, the client only approves postings. |
| 6 | **Less risk (with conditions)** | Guarantees kill commitment in a service business. De-risk, but with conditions. | Free setup (`offer.free_trial.free_setup`): AED 0 setup, billing starts only after the first month closes on their own data. Conditions = `skin_in_the_game`. No refunds and no "money back" language. |
| 7 | **True urgency and scarcity** | Only urgency you believe; otherwise it reads as fake. | Deadlines from rules.json (`ct.deadlines`, `einvoicing`, `campaign.rescue_mode_until`). Capacity limits only once the founder sets them. |
| 8 | **Name and price** | Name the method so you can't be compared. Raise the price as the offer gets stronger. | Method: **Clean Close** (bank line → payout → order → invoice → booked). Price: `pricing.tiers` (null → "Get a quote"); one-off rescue `pricing.one_off.late_filing_rescue_aed`. |

## Belief-breaking statements (the core of every hook and pitch)
A common belief → our claim → the proof shown on the next beat.

| Common belief | RAMZA claim | Proof to show |
|---|---|---|
| "Month end takes my accountant two weeks." | "A month of gateway payouts can be matched in one sitting." | The close screen with `close_credits` and `close_matched_pct` from facts.json |
| "If the bank total matches, the books are fine." | "A matching total can hide unbooked fees and refunds." | A real netted payout line (masked) vs order totals |
| "E-invoicing is my ERP vendor's problem." | "Your dates are fixed by law; the provider is your choice." | rules.json e-invoicing dates as a calendar |
| "AI accounting means I lose control." | "Nothing posts to Zoho without your click." | The Post button with chosen lines |

## Pricing test rule (from the podcast)
Track close rate per 10 qualified calls. More than 50% closing → raise the price 25% (sales confidence
stays intact); repeat until the close rate is around 30%. At 30%, check whether the losses are skill
(train) or affordability (fine: that is the price ceiling). Record each change in `funnel.md`.
