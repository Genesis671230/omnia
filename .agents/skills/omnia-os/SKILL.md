---
name: omnia-os
description: Entry point to the Omnia finance operating system, the bundle an agent needs to run a Gulf e-commerce company's money end to end, from Shopify/WooCommerce orders through Stripe, Tabby, Tamara, Telr, Checkout, Shopify Payments, COD and OnTrack/SMSA couriers to the bank and Zoho Books. Use it whenever a task touches Omnia's finance, reconciliation, payouts, invoice closing, refunds, credit notes, exchanges, cancellations, the dispatch sheet, the founder's daily numbers, or when setting up the same system for another company, and you need to know which Omnia skill and which code files to open.
---

# Omnia OS

Three skills make up the system. Open the matching `skills/<name>/GUIDE.md` (the skill's
full instructions, frontmatter included) and follow it; its references and scripts sit
beside it. This file only routes and maps. If the same skill is also installed
standalone, either copy is fine.

| Skill | Use it for |
|---|---|
| `skills/omnia-finance` | The accounting model: per gateway × currency booking playbooks (fee, VAT, FX, clearing accounts), join keys, gateway file quirks, the autonomous booking agent blueprint, the always-on "agent employee" pattern |
| `skills/omnia-sales-recon` | Daily sales numbers, which orders count as a sale, Dubai day bucketing, payout ingestion per gateway, orders → payouts → bank matching, verifying against the founder's export |
| `skills/omnia-books-closing` | Closing Zoho from the bank: open invoice report, dry-run plan, founder approval, posting, refunds with charges and VAT, credit note leftovers, returns/exchanges/cancellations report from the dispatch sheet vs Zoho, OnTrack COD, ledger snapshot |

Typical chains:
- "What came in yesterday and is it booked?" → sales-recon (numbers) → books-closing (open invoices).
- "Book the month" → books-closing, using finance's playbooks for any new gateway/currency.
- "Customer returned / exchanged / cancelled" → books-closing returns report; automation plan in `references/customer-requests-automation.md`.
- New gateway or new company → finance (model + adapter pattern) → `references/file-map.md` (what to copy) → `references/adapting-to-another-company.md`.

## Ground rules shared by all three

1. Bank is the truth, the payout file explains it, the invoice is what to close. Orders
   never match the bank directly.
2. Read only until the founder approves a named set. Dry run through the app's own
   engine, then post, then read back from Zoho. Never report a figure you didn't read back.
3. Never trust a local "booked" flag over Zoho. Never plug a difference to make numbers foot.
4. Sum only AED columns across currencies. Cross-border amounts use the bank's own rate.
5. Scheduler code is captured at server boot; restart after editing anything it imports.
6. Plain-language Excel reports to `~/Downloads`, a numbered list of decisions, no jargon.

## Maps

- `references/file-map.md`: every code file, table, route, env var by system (Zoho,
  Stripe, Shopify, Shopify Payments, Tabby, Tamara, Telr, Checkout, COD, OnTrack, SMSA,
  bank statements, dispatch sheet, Gmail payout ingest, Telegram).
- `references/customer-requests-automation.md`: how cancellations, refunds and exchanges
  become one flow that updates the store, the gateway, Zoho and the dispatch sheet together.
- `references/adapting-to-another-company.md`: what is Omnia-specific and what is reusable.
