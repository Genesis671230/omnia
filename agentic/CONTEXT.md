# OMNIA — Company Brain

The single source of truth for the Omnia order-operations agent. Every worker
and skill reads this before acting.

## What Omnia is
A Gulf multi-store e-commerce operation (jewelry/fashion). Four storefronts,
one order-operations flow, reported daily to Fouad (owner; reviews the
operator's work — refer to Fouad as "she").

## The 4 stores
- **WooCommerce (main):** https://omniastores.com
- **Shopify UAE:** https://omniastores.ae
- **Shopify KSA:** https://sa.omniastores.ae
- **Shopify WhatsApp:** https://whatsapp.omniastores.ae

## Order types (this drives everything)
- **Local orders** → delivered by **OnTrack**. Managed by **Sinan**.
  Cutoff **8:30pm**.
- **International orders** → delivered by **SMSA** or **DHL**. Inventory +
  handling managed by **Yaseen**. Cutoff **1:00pm** — an international order
  that lands after 1pm is NOT processed today; it's picked up tomorrow.
- **Same-day urgent** → **Muneeb** handles it.
- **Inventory (picking/packing):** **Mark**.

## The 6+ payment gateways
Stripe, Telr, Tamara (KSA), Tamara (UAE), Tabby (UAE/KSA/KWD), Checkout, COD.
See gateways.md. **CRITICAL: only Stripe has a working payment-confirmation
API.** All others are confirmed manually by the operator. The agent must NOT
pretend it can auto-confirm non-Stripe payments.

## Data sources the agent reads
- **Dispatch sheet** (Google Sheet, mirror of the monthly Orders xlsx):
  two live tabs — "SMSA Orders" (international) and "Local orders".
- **Supabase** — normalized orders data (from the reconciliation build); used
  for the ODS / analytical agent and daily sales reporting.
- **Shopify** (3 stores) + **WooCommerce** — order + product pulls.
- **Zoho** — inventory + invoice/AWB generation.

## What the agent does
1. Watches the dispatch sheet + store orders.
2. Auto-confirms Stripe; flags all other gateways NEEDS-EYE for the operator.
3. On confirm: routes by order type to the right courier + person, at the
   right cutoff.
4. Posts live updates to the Omnia Telegram group, @mentioning the right
   person at their step.
5. Reports daily sales (per store + dispatch sheet) to the group.

## Who gets @mentioned for what
- New/needs-eye order → operator (whoever confirms payment)
- Local order confirmed → Sinan (+ Mark for picking)
- International order confirmed → Yaseen (+ Mark for picking)
- Same-day urgent → Muneeb
- Daily report → Fouad
(Map the real Telegram @usernames in worker/config.py — placeholders for now.)
