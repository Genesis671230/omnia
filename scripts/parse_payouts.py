"""
Omnia Finance OS — payout file parsers (Workflow B).

A payout file explains a bank credit. ONE file = ONE payout = ONE bank deposit.
The parser's job: extract the payout id, the NET total, and the order refs, so
the reconciler can go   bank credit → payout → orders.

Two gateways here (build concrete-then-abstract — no generic engine yet):

  Telr  (.xls)  — "Payout ID <n>" banner row at the very top, then blank rows,
                  a section label, the header row (Ref,Date,Time,Type,CartID,
                  Description,Name,Currency,Amount,Currency,Amount,MDR,Fees,Tax,
                  Net), then transactions. Sum the Net column = payout total.
                  CartID prefix (before "_") = order number.
                  ⚠ The banner survives .xls but is DROPPED by CSV export — so
                  ingest .xls, or put the payout id in the filename as fallback.

  Stripe (CSV)  — payout RECONCILIATION report (not the transactions export).
                  `automatic_payout_id` links each charge to its payout.
                  Order refs live in a human-typed `description`: WA54610,
                  multi "WA54728/WA54730", refunds "REFUND FOR CHARGE (WA54553)",
                  or blank → needs a description parser.

Usage:
    python parse_payouts.py telr telr_payout_4841777.xls   > payout.json
    python parse_payouts.py stripe stripe_payout_recon.csv  > payout.json
"""

from __future__ import annotations
import sys, json, re, csv, os
from collections import defaultdict

# ── Stripe description parser ─────────────────────────────────────────────────
# Pull order tokens like WA54610, UAE3345, KSA3646, or bare 5199 out of the
# messy human-typed description. Handles multi-order and refund wrappers.
ORDER_TOKEN_RE = re.compile(r"\b((?:WA|UAE|KSA|WOO)?\d{3,6})\b", re.IGNORECASE)
REFUND_RE = re.compile(r"REFUND\s+FOR\s+CHARGE\s*\(([^)]+)\)", re.IGNORECASE)


def stripe_order_refs(description: str) -> tuple[list[str], bool]:
    """Return (order_refs, is_refund)."""
    if not description:
        return [], False
    is_refund = bool(REFUND_RE.search(description))
    # split on common human separators
    parts = re.split(r"[\/,;&]+", description)
    refs: list[str] = []
    for p in parts:
        for m in ORDER_TOKEN_RE.finditer(p):
            tok = m.group(1).upper()
            if tok not in refs:
                refs.append(tok)
    return refs, is_refund


def parse_stripe(path: str) -> dict:
    payouts: dict[str, dict] = defaultdict(
        lambda: {"net": 0.0, "gross": 0.0, "fees": 0.0, "orderRefs": [], "charges": 0, "refunds": 0}
    )
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        # tolerate column-name variants
        cols = {c.lower(): c for c in (reader.fieldnames or [])}

        def col(*names):
            for n in names:
                if n in cols:
                    return cols[n]
            return None

        c_payout = col("automatic_payout_id", "payout_id")
        c_net = col("net", "amount")
        c_gross = col("gross", "amount")
        c_fee = col("fee", "fees")
        c_desc = col("description", "memo")
        if not c_payout:
            sys.exit("Stripe CSV missing automatic_payout_id — get the PAYOUT reconciliation report, not the transactions export.")

        for row in reader:
            pid = (row.get(c_payout) or "").strip()
            if not pid:
                continue
            p = payouts[pid]
            net = float(row.get(c_net) or 0)
            p["net"] += net
            if c_gross:
                p["gross"] += float(row.get(c_gross) or 0)
            if c_fee:
                p["fees"] += float(row.get(c_fee) or 0)
            refs, is_refund = stripe_order_refs(row.get(c_desc, "") if c_desc else "")
            if is_refund:
                p["refunds"] += 1
            else:
                p["charges"] += 1
            for r in refs:
                if r not in p["orderRefs"]:
                    p["orderRefs"].append(r)

    files = []
    for pid, p in payouts.items():
        files.append({
            "id": pid,
            "provider": "Stripe",
            "net": round(p["net"], 2),
            "gross": round(p["gross"], 2),
            "fees": round(p["fees"], 2),
            "orderRefs": p["orderRefs"],
            "source": os.path.basename(path),
            "notes": f'{p["charges"]} charges, {p["refunds"]} refunds',
        })
    return {"provider": "Stripe", "payouts": files}


# ── Telr .xls parser ──────────────────────────────────────────────────────────
PAYOUT_ID_RE = re.compile(r"PAYOUT\s*ID\s*(\d+)", re.IGNORECASE)
# filename fallback: telr_payout_4841777.xls
FNAME_ID_RE = re.compile(r"(\d{6,})")


def parse_telr(path: str) -> dict:
    try:
        import openpyxl  # noqa
        engine = "openpyxl"
    except ImportError:
        engine = None
    try:
        import xlrd  # noqa
    except ImportError:
        xlrd = None

    rows: list[list] = []
    payout_id = None

    # Read every cell as string; scan for the banner AND the header.
    if path.lower().endswith(".xlsx"):
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        for r in ws.iter_rows(values_only=True):
            rows.append(["" if c is None else c for c in r])
    else:
        # .xls
        if xlrd is None:
            sys.exit("xlrd not installed for .xls: pip install xlrd --break-system-packages")
        import xlrd as _xlrd
        book = _xlrd.open_workbook(path)
        sh = book.sheet_by_index(0)
        for i in range(sh.nrows):
            rows.append([sh.cell_value(i, j) for j in range(sh.ncols)])

    # 1) find payout id from banner
    for r in rows:
        joined = " ".join(str(c) for c in r)
        m = PAYOUT_ID_RE.search(joined)
        if m:
            payout_id = m.group(1)
            break
    # 2) filename fallback (banner dropped by CSV export)
    if not payout_id:
        fm = FNAME_ID_RE.search(os.path.basename(path))
        payout_id = fm.group(1) if fm else "TELR-UNKNOWN"

    # 3) locate header row
    header_idx = None
    for i, r in enumerate(rows):
        cells = [str(c).strip().lower() for c in r]
        if "cartid" in cells and "net" in cells:
            header_idx = i
            break
    if header_idx is None:
        sys.exit("Telr header row not found (need columns incl. CartID, Net).")

    header = [str(c).strip() for c in rows[header_idx]]
    idx = {name.lower(): j for j, name in enumerate(header)}
    j_cart = idx["cartid"]
    j_net = idx["net"]

    net_total = 0.0
    order_refs: list[str] = []
    tx = 0
    for r in rows[header_idx + 1:]:
        if j_cart >= len(r):
            continue
        cart = str(r[j_cart]).strip()
        if not cart:
            continue
        try:
            net_total += float(r[j_net])
        except (ValueError, TypeError):
            continue
        tx += 1
        prefix = cart.split("_")[0]  # CartID prefix = order number
        if prefix and prefix not in order_refs:
            order_refs.append(prefix)

    return {
        "provider": "Telr",
        "payouts": [{
            "id": f"TELR-{payout_id}",
            "provider": "Telr",
            "net": round(net_total, 2),
            "orderRefs": order_refs,
            "source": os.path.basename(path),
            "notes": f"{tx} transactions; net = sum of Net column",
        }],
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: parse_payouts.py <telr|stripe> <file>")
    kind, path = sys.argv[1].lower(), sys.argv[2]
    result = parse_telr(path) if kind == "telr" else parse_stripe(path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
