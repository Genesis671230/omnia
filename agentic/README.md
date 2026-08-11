# Omnia Brain + Order-Ops Bot

A git repo (the "company brain") + a worker that reads the dispatch sheet and
posts live order updates to a Telegram group, @mentioning the right person at
each step. No lock-in — the brain is markdown, readable by any agent.

## Structure
```
omnia-brain/
  CONTEXT.md          what Omnia is, 4 stores, gateways, staff, sources
  gateways.md         Stripe=API; everything else manual
  couriers.md         OnTrack 8:30pm / SMSA-DHL 1pm / Muneeb same-day
  zoho-fields.md      invoice/AWB/inventory mappings (fill later)
  skills/
    process-order.md
    telegram-report.md
  worker/
    config.py         <- fill TODOs here
    main.py           the loop
    telegram.py
    sources/dispatch.py      (mapped to the real xlsx columns)
    sources/stripe_match.py  (amount+date matching)
```

## One-time setup
1. `pip install gspread stripe` (telegram uses stdlib only)
2. Create the Telegram group, add your bot, send any message in it.
3. Get the group chat id: set your token and run
   `python -c "from worker.telegram import get_updates; import json;
   print(json.dumps(get_updates('YOUR_TOKEN'), indent=2))"`
   → find `chat.id` (a negative number for groups).
4. Google Sheet: share the dispatch sheet with your service-account email,
   put the sheet id + service_account.json path in config.
5. Fill real @usernames in `config.MENTIONS`.

## Run (Day-1 = dispatch sheet only)
```
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=-100xxxxxxxxx
export DISPATCH_SHEET_ID=...
export STRIPE_SECRET_KEY=...        # optional; without it Stripe stays PENDING
python -m worker.main
```

## Modes
- `REPORT_ONLY = True` (default): posts what WOULD happen, writes nothing to
  Zoho. Keep this ON for the demo. Flip to False only after Zoho fields are
  wired and tested.

## Known edge cases (found by testing against August data)
- Combo gateways in the sheet (`tamara+stripe`, `tabby+stripe`, `exchange/cod`,
  `exchange`, `shopify`) → routed to NEEDS-EYE (fails safe; operator decides).
- Only ~14% of orders are pure Stripe (auto-confirmable). The bot's value is
  organizing + routing the manual flow, not verifying payments.
- Order numbers come as numeric (801873) and text (SA3751); both handled.

## Next (after the demo lands)
- Supabase read for daily sales report (per store + dispatch) → tag Fouad.
- Shopify (UAE/KSA/WA) + WooCommerce order pulls into the same group.
- Zoho invoice/AWB/inventory (flip REPORT_ONLY off).
- Swap Telegram adapter for WhatsApp (same worker, new output).
```
```
