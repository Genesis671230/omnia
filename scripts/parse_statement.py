"""
Omnia Finance OS — Emirates NBD statement parser.

Bank is the source of truth. This parser is the FIRST gate: it turns a raw
Emirates NBD statement (PDF or the text you already paste) into normalized
credit / debit lines that the reconciler consumes.

    statement (PDF/txt) ──► parse_statement.py ──► { credits[], debits[] }

Only CREDIT lines are reconciliation candidates. Debits are outflows (salary,
supplier, fees, tax, transfers) and are stored read-only.

Usage:
    python parse_statement.py statement.pdf   > out.json
    python parse_statement.py statement.txt   > out.json
    cat statement.txt | python parse_statement.py -   > out.json
"""

from __future__ import annotations
import sys, json, re
from dataclasses import dataclass, asdict
from typing import Optional

# ── Provider classification (bank keywords per omnia-finance skill) ───────────
# Telr → INNOVATE · Stripe → NETWORK…STRIPE · Tamara → TAMARA FZE
# Checkout → Checkout MENA · Tabby → TABBY LLC FZ
# SABB is a settlement BANK, not a gateway → inferred, needs confirmation.
RULES = [
    ("TAMARA", "Tamara", "keyword"),
    ("CHECKOUT MENA", "Checkout", "keyword"),
    ("CHECKOUT.COM", "Checkout", "keyword"),
    ("INNOVATE TECHNOLOGIES", "Telr", "keyword"),
    ("NETWORK", "Stripe", "keyword"),
    ("TABBY", "Tabby", "keyword"),
    ("SHOPIFY", "Shopify Payments", "keyword"),
    ("SABB", "Tabby", "inferred"),
]

DEBIT_KINDS = [
    ("SAL ", "salary"), ("SALARY", "salary"), ("JOYALUKKAS", "salary"),
    ("FEES OR CHARGES", "fee"), ("CHARGES", "fee"),
    ("TAX AMOUNT", "tax"),
    ("TRANSFER OF FUNDS", "transfer"), ("TOF", "transfer"),
    ("OUTWARD TELEX", "supplier"),
]

# Bank ref token: FT26181NNDMQ\HCP, DSZ26181LLDDKCJG, FT261812T6G1
REF_RE = re.compile(r"\b((?:FT|DSZ|INSTQ)[A-Z0-9]{6,})(?:\\HCP)?\b")
# A signed amount followed by a running balance, e.g. "11,485.18 874,045.23"
AMT_BAL_RE = re.compile(
    r"(-?\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*$"
)
DATE_RE = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")


@dataclass
class Line:
    id: str
    date: str            # ISO
    narration: str
    reference: str
    amount: float        # positive magnitude
    direction: str       # "credit" | "debit"
    provider: Optional[str] = None
    confidence: Optional[str] = None   # credits: keyword|inferred|unknown
    kind: Optional[str] = None         # debits: salary|supplier|fee|tax|transfer|other


def classify_credit(narration: str):
    up = narration.upper()
    for kw, prov, conf in RULES:
        if kw in up:
            return prov, conf
    return "Unclassified", "unknown"


def classify_debit(narration: str) -> str:
    up = narration.upper()
    for kw, kind in DEBIT_KINDS:
        if kw in up:
            return kind
    return "other"


def to_iso(text: str) -> str:
    m = DATE_RE.search(text)
    if not m:
        return ""
    d, mo, y = m.groups()
    return f"{y}-{mo}-{d}"


def read_input(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    if path.lower().endswith(".pdf"):
        try:
            import pdfplumber
        except ImportError:
            sys.exit("pdfplumber not installed: pip install pdfplumber --break-system-packages")
        text = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text.append(page.extract_text() or "")
        return "\n".join(text)
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def parse(raw: str) -> dict:
    """
    Emirates NBD statements wrap one transaction across several physical lines,
    ending in '<amount> <balance>'. We accumulate lines into a buffer and flush
    a transaction each time we hit an amount+balance tail.
    """
    credits: list[Line] = []
    debits: list[Line] = []
    buf: list[str] = []
    cidx = didx = 0

    for physical in raw.splitlines():
        s = physical.strip()
        if not s:
            continue
        buf.append(s)
        m = AMT_BAL_RE.search(s)
        if not m:
            continue

        block = " ".join(buf)
        amount_raw = float(m.group(1).replace(",", ""))
        # Everything before the amount+balance tail is narration.
        narration = block[: m.start()].strip(" /|")
        narration = re.sub(r"\s{2,}", " ", narration)

        ref_m = REF_RE.search(block)
        reference = ref_m.group(1) if ref_m else ""
        iso = to_iso(block)

        # Emirates NBD convention in this export: inward/credit lines are the
        # positive settlements; outward payments/fees/tax are debits. We detect
        # direction by keywords, then fall back to sign.
        up = narration.upper()
        is_credit = ("INWARD" in up or "CR ACCOUNT" in up or "CTD CR" in up) and amount_raw > 0
        is_debit = ("OUTWARD" in up or "DEBIT" in up or "FEES" in up
                    or "TAX AMOUNT" in up or "CHARGES" in up)

        if is_credit and not is_debit:
            prov, conf = classify_credit(narration)
            cidx += 1
            credits.append(Line(
                id=f"C{cidx:03d}", date=iso, narration=narration,
                reference=reference, amount=abs(amount_raw),
                direction="credit", provider=prov, confidence=conf,
            ))
        else:
            didx += 1
            debits.append(Line(
                id=f"D{didx:03d}", date=iso, narration=narration,
                reference=reference, amount=abs(amount_raw),
                direction="debit", kind=classify_debit(narration),
            ))
        buf = []

    def clean(l: Line) -> dict:
        return {k: v for k, v in asdict(l).items() if v is not None}

    return {
        "source": "Emirates NBD statement",
        "credits": [clean(c) for c in credits],
        "debits": [clean(d) for d in debits],
        "summary": {
            "credit_count": len(credits),
            "credit_total": round(sum(c.amount for c in credits), 2),
            "debit_count": len(debits),
            "debit_total": round(sum(d.amount for d in debits), 2),
            "unclassified_credits": sum(1 for c in credits if c.confidence == "unknown"),
            "inferred_credits": sum(1 for c in credits if c.confidence == "inferred"),
        },
    }


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "-"
    print(json.dumps(parse(read_input(path)), ensure_ascii=False, indent=2))
