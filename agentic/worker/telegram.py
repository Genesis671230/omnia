"""Post messages to the Omnia Telegram group."""
import urllib.parse
import urllib.request
import json


def send(bot_token, chat_id, text):
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    try:
        req = urllib.request.Request(url, data=data)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r).get("ok", False)
    except Exception as e:
        print("telegram send failed:", e)
        return False


def get_updates(bot_token):
    """One-off helper: run this once, then read chat.id from the output to get
    your group's chat_id. (Add the bot to the group and send a message first.)"""
    url = f"https://api.telegram.org/bot{bot_token}/getUpdates"
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.load(r)
