"""Agent core — the reasoning layer.

This is the part that makes it an AGENT, not a hardcoded flow. It loads the
brain (CONTEXT.md, gateways.md, couriers.md, skills) as context and asks Claude
to reason about each order: classify it, decide the payment path, decide
routing given the current time and cutoffs, and write the Telegram messages
with the right @mentions.

Deterministic work (reading the sheet, matching a Stripe charge, sending the
Telegram message) stays in code — see main.py / sources/. The agent decides
WHAT to do; the code EXECUTES it. That split keeps it fast, cheap and reliable.
"""
import json
import os
import urllib.request

import config as C

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# Brain files that get loaded into the agent's context every run.
BRAIN_FILES = [
    "../CONTEXT.md",
    "../gateways.md",
    "../couriers.md",
    "../skills/process-order.md",
    "../skills/telegram-report.md",
]


def load_brain():
    """Read the markdown brain into one context string (like nao's file-system
    context). The agent reads this before deciding anything."""
    here = os.path.dirname(__file__)
    parts = []
    for rel in BRAIN_FILES:
        path = os.path.join(here, rel)
        try:
            with open(path, encoding="utf-8") as f:
                parts.append(f"### FILE: {os.path.basename(rel)}\n{f.read()}")
        except FileNotFoundError:
            continue
    return "\n\n".join(parts)


SYSTEM = """You are the Omnia order-operations agent.

You are given the Omnia company brain (context, gateway rules, courier rules,
and the process-order + telegram-report skills). Follow those files exactly —
they are the source of truth for how Omnia works.

For each order you receive, decide:
1. order_type: "local" or "international" (use the tab it came from and the
   Delivery By / gateway hints).
2. payment_action: one of
   - "STRIPE_AUTO"  (gateway is Stripe AND a stripe match result is provided
     as PAID) -> confirmed automatically
   - "NEEDS_EYE"    (any non-Stripe, non-COD gateway -> operator must check
     that gateway's dashboard manually; APIs are broken for these)
   - "COD"          (cash on delivery -> confirm on delivery)
   - "PENDING"      (Stripe expected but no match found yet)
   - "AMBIGUOUS"    (Stripe matched multiple charges -> operator decides)
   Combo gateways (e.g. "tabby+stripe", "exchange/cod") -> NEEDS_EYE, and say
   why in one short line.
3. routing: given the CURRENT TIME provided and the cutoffs in couriers.md,
   decide the courier, the person to @mention, and whether it's held for
   tomorrow.
4. messages: the exact Telegram lines to post, following telegram-report.md
   templates and using the @mention handles from the brain's MENTIONS list
   that I pass you.

Respond ONLY with JSON, no prose, no markdown fences:
{
  "order_type": "...",
  "payment_action": "...",
  "reason": "one short line",
  "messages": ["line 1", "line 2", ...]
}
"""


def reason_about_order(brain, order, stripe_result, now_str, mentions):
    """Ask Claude to decide + write the messages for one order.
    Returns the parsed dict, or None on failure (caller falls back to code)."""
    if not ANTHROPIC_API_KEY:
        return None

    user = (
        f"COMPANY BRAIN:\n{brain}\n\n"
        f"MENTION HANDLES: {json.dumps(mentions)}\n"
        f"CURRENT TIME: {now_str}\n"
        f"STRIPE MATCH RESULT (only relevant if gateway is stripe): "
        f"{stripe_result}\n\n"
        f"ORDER:\n{json.dumps(order, default=str)}\n\n"
        f"Decide and return JSON per your instructions."
    )

    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": user}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.load(r)
        text = "".join(b.get("text", "") for b in data.get("content", [])
                       if b.get("type") == "text").strip()
        text = text.replace("```json", "").replace("```", "").strip()
        return json.loads(text)
    except Exception as e:
        print("agent reason failed:", e)
        return None
