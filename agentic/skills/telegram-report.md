# Skill: telegram-report

What the worker posts to the Omnia Telegram group and who it tags.

## Message templates
- New non-Stripe order:
  `🆕 #{order_no} · {amount} {currency} · {gateway} · NEEDS EYE 👁️ — check {gateway} dashboard`
- Stripe auto-paid:
  `✅ PAID #{order_no} · {amount} {currency} · Stripe (auto-matched)`
- Stripe ambiguous:
  `👁️ #{order_no} · {amount} {currency} · Stripe — {n} possible matches, confirm manually`
- COD:
  `📦 COD #{order_no} · {amount} AED · confirm on delivery`
- Confirmed → route:
  - international today: `🚚 #{order_no} → SMSA/DHL today (cutoff 1pm) — @Yaseen`
  - international held:  `⏭️ #{order_no} international after 1pm → tomorrow's pickup`
  - local today:        `🚚 #{order_no} → OnTrack today (cutoff 8:30pm) — @Sinan`
  - urgent:             `⚡ #{order_no} SAME-DAY — @Muneeb`
  - pick:               `📦 #{order_no} ready to pick — @Mark`
- Low stock: `⚠️ {sku} — {name} down to {qty} units`

## Daily report (end of day, tag @Fouad)
```
📊 Omnia daily — {date}
Orders: {total} ({intl} intl / {local} local)
Paid: {paid} · Needs-eye: {needs_eye} · COD: {cod} · Held: {held}
Sales: AED {sales_aed}
  Woo: {woo} · Shopify UAE: {shpu} · KSA: {shpk} · WA: {shpw}
Dispatched: SMSA/DHL {smsa} · OnTrack {ontrack}
```

## Tone
Short lines. Emojis as status markers only. One post per event; batch the daily
report into a single message.
