"""Omnia order-ops worker — configuration.
Fill the values marked TODO. Everything else is derived from the brain files.
"""
import os

# ---- Telegram ----
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")   # you have this
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")     # the Omnia group id (see README)

# Map roles -> Telegram @usernames (TODO: put real handles; keep the @)
MENTIONS = {
    "operator": "@operator",   # whoever confirms non-Stripe payments
    "sinan":    "@Sinan",      # local / OnTrack
    "yaseen":   "@Yaseen",     # international / SMSA-DHL + intl inventory
    "muneeb":   "@Muneeb",     # same-day urgent
    "mark":     "@Mark",       # picking / packing
    "fouad":    "@Fouad",      # owner, daily report
}

# ---- Stripe (only gateway with a working confirm API) ----
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_DATE_WINDOW_DAYS = 1        # match charges within order_date ± this
STRIPE_AMOUNT_TOLERANCE = 0.50     # currency-unit tolerance on amount match

# ---- Google Sheet (dispatch) ----
# Service-account JSON path + the sheet id. Tabs must match the xlsx tab names.
GOOGLE_SA_JSON = os.getenv("GOOGLE_SA_JSON", "service_account.json")
DISPATCH_SHEET_ID = os.getenv("DISPATCH_SHEET_ID", "")   # TODO
TAB_INTERNATIONAL = "SMSA Orders"
TAB_LOCAL         = " Local orders"    # note the leading space in the file

# ---- Supabase (orders for ODS / analytics + daily sales) ----
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# ---- Cutoffs (couriers.md) ----
INTL_CUTOFF_HOUR = 13      # 1:00pm
LOCAL_CUTOFF_HOUR = 20     # 8:30pm
LOCAL_CUTOFF_MIN  = 30

# ---- Modes ----
REPORT_ONLY = True   # True = post what WOULD happen, don't write Zoho yet
LOOP_SECONDS = 600   # 10 min
LOW_STOCK_THRESHOLD = 5

# ---- Gateways that CANNOT be auto-confirmed (need operator eye) ----
MANUAL_GATEWAYS = {"telr", "tamara", "tabby", "checkout"}
STRIPE_GATEWAYS = {"stripe"}
COD_GATEWAYS = {"cod"}

STATE_FILE = "processed_orders.json"
