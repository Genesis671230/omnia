# Skill: process-order

The step-by-step flow the worker follows for every order it sees.

## Steps
1. **Ingest** — read the order from the dispatch sheet (SMSA Orders / Local
   orders tab) or a store pull. Normalize to: order_no, date, amount, currency,
   amount_aed, gateway, order_type (local|international), customer, sales_person.

2. **Classify order_type**
   - From "SMSA Orders" tab → international.
   - From "Local orders" tab → local.
   - (Cross-check "Delivery By" column: Ontrack=local, SMSA/DHL=international.)

3. **Payment check**
   - gateway == stripe → run stripe amount+date match (gateways.md).
     - one match → PAID ✅
     - none → PENDING
     - multi → AMBIGUOUS 👁️ (operator)
   - gateway == COD → COD (confirm on delivery)
   - anything else → NEEDS-EYE 👁️ (operator checks that gateway's dashboard)

4. **On confirmed (PAID or operator-Y)**
   - REPORT-ONLY mode: post what would happen.
   - LIVE mode: generate invoice + AWB via Zoho, decrement inventory.

5. **Route by cutoff (couriers.md)**
   - international before 1pm → SMSA/DHL today (@Yaseen)
   - international after 1pm → held tomorrow
   - local before 8:30pm → OnTrack today (@Sinan)
   - local after 8:30pm → OnTrack tomorrow
   - urgent → @Muneeb
   - always → 📦 ready to pick @Mark

6. **Post to Telegram** (telegram-report.md) with the right @mention.

## Idempotency
Track processed order_no in a local state file so the same order isn't posted
twice on the next loop.
