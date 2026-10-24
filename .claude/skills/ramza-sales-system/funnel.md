# Funnel and distribution

## Distribution rules
- **Organic first, then paid.** Ads to an empty brand cost many times more per lead, and the call takes
  months instead of a day, because trust is missing. Every week has organic posts and reels
  (ramza-social calendar) before ads scale.
- **Paid: the creative is the targeting.** Meta's AI finds the audience from the words. The best
  lead ads are plain static cards that say exactly who they are for:
  > "UAE Shopify founders with 3+ payment gateways: if your payouts never match your orders, we close your
  > month for you. Free setup. Fill the form below."
- No budget: cold calls/WhatsApp (outbound-operator) while organic builds.

## Leak metrics (track weekly; fix the leak, not the salesperson)
| Stage | Metric | Where it lives |
|---|---|---|
| Inquiries by source | leads / week by utm_source (IG DM, form, WhatsApp, email, LinkedIn) | `leads` table + attribution.ts |
| First touch | **time to first call ≤ 5 minutes**: excitement peaks at the inquiry | Telegram alert → WhatsApp call |
| Pickup | % reached | CRM |
| Qualified | % passing gate 1–3 | CRM gate fields |
| Show | % attending the booked call | CRM |
| Close | % paying (target ~30%; >50% = raise price) | CRM |
Fill the form for the lead during the first call. People are lazy, and every form field leaks leads.
A 5-minute first touch for 16 leads a day takes about 2 hours. Do it before hiring.

## After the sale
The person who onboards checks that what was sold matches what we deliver. If the sale was misaligned,
send it back before work starts. A customer-success owner takes complaints so they stay inside the
company instead of going public.

## Price log
| Date | Tier/price | Calls | Closed | Rate | Decision |
|---|---|---|---|---|---|
