"""Read the dispatch sheet (Google Sheet mirror of the monthly Orders xlsx).

Column layout comes from the real file:

SMSA Orders (international) header:
  x | S.No | Date | Order # | Total Amt | Currency | In AED | Party | Part |
  Exc Rate | (blank) | Status / Comments | Payment Authorised - Status |
  Actual Payment Status | Payment Received Date | ...
  -> "Party" holds the GATEWAY (tabby/telr/tamara/stripe/...).
  -> "Part" holds Paid/Unpaid-ish text.

Local orders header:
  Duplicate customer | Duplicate Check | S.No | Date | Order # | Voucher # |
  Type of Sale | Total | Party | Customer | contact | Comments |
  Payment Status | Delivery By | COD to Other Payment | Actual Payment Status |
  Payment Received on | ...
  -> "Party" = gateway, "Type of Sale" = Paid/COD, "Delivery By" = Ontrack/etc.
"""
from datetime import datetime


def _norm_gateway(v):
    if v is None:
        return ""
    return str(v).strip().lower()


def _parse_date(v):
    # sheet uses e.g. "01.Aug.2026"
    if isinstance(v, datetime):
        return v
    if not v:
        return None
    for fmt in ("%d.%b.%Y", "%d.%B.%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(v).strip(), fmt)
        except ValueError:
            continue
    return None


def parse_international(rows):
    """rows = list of tuples (values_only) incl. header at index 0."""
    out = []
    for r in rows[1:]:
        if r is None or len(r) < 9:
            continue
        order_no = r[3]
        if order_no in (None, ""):
            continue
        out.append({
            "order_no": str(order_no).strip(),
            "date": _parse_date(r[2]),
            "amount": r[4],                 # Total Amt
            "currency": (r[5] or "").strip() if isinstance(r[5], str) else r[5],
            "amount_aed": r[6],             # In AED
            "gateway": _norm_gateway(r[7]), # Party
            "paid_text": (str(r[8]).strip() if r[8] else ""),  # Part
            "status_comment": r[11] if len(r) > 11 else None,
            "actual_payment": r[13] if len(r) > 13 else None,
            "order_type": "international",
        })
    return out


def parse_local(rows):
    out = []
    for r in rows[1:]:
        if r is None or len(r) < 14:
            continue
        order_no = r[4]
        if order_no in (None, ""):
            continue
        out.append({
            "order_no": str(order_no).strip(),
            "date": _parse_date(r[3]),
            "type_of_sale": (str(r[6]).strip() if r[6] else ""),  # Paid / COD
            "amount": r[7],                 # Total
            "gateway": _norm_gateway(r[8]), # Party
            "customer": r[9],
            "delivery_by": (str(r[13]).strip() if r[13] else ""),  # Ontrack/...
            "actual_payment": r[15] if len(r) > 15 else None,
            "currency": "AED",
            "amount_aed": r[7],
            "order_type": "local",
        })
    return out


# ---- Live Google Sheets fetch (used in production) ----
def fetch_rows(sheet_id, tab, sa_json):
    import gspread
    gc = gspread.service_account(filename=sa_json)
    ws = gc.open_by_key(sheet_id).worksheet(tab)
    return ws.get_all_values()  # list of lists (strings)
