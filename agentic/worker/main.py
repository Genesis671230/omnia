"""Omnia order-ops worker — main loop (agent-driven).

Flow per order:
  1. Read order from dispatch sheet (code — deterministic).
  2. If gateway is Stripe: run amount+date match (code — deterministic, cheap).
  3. Ask the AGENT (Claude, reading the brain) to classify, decide payment
     path, decide routing vs cutoffs, and WRITE the Telegram messages.
  4. Send those messages (code — deterministic).
  5. If no API key or the agent call fails -> fall back to code rules so the
     bot never goes silent.

Run:
  ANTHROPIC_API_KEY=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
  DISPATCH_SHEET_ID=... STRIPE_SECRET_KEY=... python -m worker.main
"""
import json
import os
import time
from datetime import datetime

import config as C
from telegram import send
from sources import dispatch
from sources.stripe_match import confirm_by_amount_date
from agent import load_brain, reason_about_order


def gateway_class(gw):
    gw = (gw or "").lower()
    if gw in C.STRIPE_GATEWAYS:
        return "stripe"
    if gw in C.COD_GATEWAYS:
        return "cod"
    return "manual"


def stripe_check(o):
    return confirm_by_amount_date(
        C.STRIPE_SECRET_KEY, o.get("amount"), o.get("currency"),
        o.get("date"), C.STRIPE_DATE_WINDOW_DAYS, C.STRIPE_AMOUNT_TOLERANCE)


def past_cutoff(order_type, now=None):
    now = now or datetime.now()
    if order_type == "international":
        return now.hour >= C.INTL_CUTOFF_HOUR
    return (now.hour, now.minute) >= (C.LOCAL_CUTOFF_HOUR, C.LOCAL_CUTOFF_MIN)


def fallback_messages(o, stripe_result):
    m = C.MENTIONS
    no = o["order_no"]
    amt = o.get("amount")
    cur = o.get("currency") or ""
    gw = o["gateway"] or "?"
    gc = gateway_class(gw)
    msgs = []
    if gc == "stripe":
        status = stripe_result[0]
        if status == "PAID":
            msgs.append(f"\u2705 PAID #{no} \u00b7 {amt} {cur} \u00b7 Stripe (auto-matched)")
        elif status == "AMBIGUOUS":
            msgs.append(f"\U0001f441\ufe0f #{no} \u00b7 {amt} {cur} \u00b7 Stripe multiple matches \u2014 confirm {m['operator']}")
        else:
            msgs.append(f"\u26d4 #{no} \u00b7 {amt} {cur} \u00b7 Stripe not found yet")
    elif gc == "cod":
        msgs.append(f"\U0001f4e6 COD #{no} \u00b7 {amt} {cur} \u00b7 confirm on delivery {m['operator']}")
    else:
        msgs.append(f"\U0001f195 #{no} \u00b7 {amt} {cur} \u00b7 {gw} \u00b7 NEEDS EYE \U0001f441\ufe0f \u2014 check {gw} dashboard {m['operator']}")

    if o["order_type"] == "international":
        if past_cutoff("international"):
            msgs.append(f"\u23ed\ufe0f #{no} international after 1pm \u2192 tomorrow {m['yaseen']}")
        else:
            msgs.append(f"\U0001f69a #{no} \u2192 SMSA/DHL today (cutoff 1pm) {m['yaseen']}")
    else:
        if past_cutoff("local"):
            msgs.append(f"\u23ed\ufe0f #{no} local after 8:30pm \u2192 tomorrow OnTrack {m['sinan']}")
        else:
            msgs.append(f"\U0001f69a #{no} \u2192 OnTrack today (cutoff 8:30pm) {m['sinan']}")
    msgs.append(f"\U0001f4e6 #{no} ready to pick {m['mark']}")
    return msgs


def load_state():
    if os.path.exists(C.STATE_FILE):
        with open(C.STATE_FILE) as f:
            return set(json.load(f))
    return set()


def save_state(seen):
    with open(C.STATE_FILE, "w") as f:
        json.dump(sorted(seen), f)


def read_all_orders():
    intl = dispatch.parse_international(
        dispatch.fetch_rows(C.DISPATCH_SHEET_ID, C.TAB_INTERNATIONAL, C.GOOGLE_SA_JSON))
    local = dispatch.parse_local(
        dispatch.fetch_rows(C.DISPATCH_SHEET_ID, C.TAB_LOCAL, C.GOOGLE_SA_JSON))
    return intl + local


def process_order(o, brain):
    stripe_result = stripe_check(o) if gateway_class(o["gateway"]) == "stripe" else ("N/A", None)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M (%A)")
    decision = reason_about_order(brain, o, stripe_result, now_str, C.MENTIONS)
    if decision and decision.get("messages"):
        return decision["messages"]
    return fallback_messages(o, stripe_result)


def loop_once(seen, brain):
    new = 0
    for o in read_all_orders():
        key = f"{o['order_type']}:{o['order_no']}"
        if key in seen:
            continue
        for msg in process_order(o, brain):
            send(C.TELEGRAM_BOT_TOKEN, C.TELEGRAM_CHAT_ID, msg)
        seen.add(key)
        new += 1
    if new:
        save_state(seen)
    return new


def main():
    brain = load_brain()
    seen = load_state()
    mode = "AGENT" if os.getenv("ANTHROPIC_API_KEY") else "CODE-FALLBACK"
    send(C.TELEGRAM_BOT_TOKEN, C.TELEGRAM_CHAT_ID,
         f"\U0001f916 Omnia order-ops bot online ({mode}). Watching dispatch sheet.")
    while True:
        try:
            n = loop_once(seen, brain)
            print(f"{datetime.now():%H:%M} processed {n} new orders [{mode}]")
        except Exception as e:
            print("loop error:", e)
        time.sleep(C.LOOP_SECONDS)


if __name__ == "__main__":
    main()
