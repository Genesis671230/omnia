"""Stripe is the ONLY gateway we can auto-confirm.
Orders have no Stripe order-id, so match by amount + date window.
"""
from datetime import timedelta


def confirm_by_amount_date(stripe_secret, amount, currency, order_date,
                           window_days=1, tolerance=0.50):
    """Return ('PAID', charge_id) | ('PENDING', None) | ('AMBIGUOUS', n)."""
    if not stripe_secret or amount is None or order_date is None:
        return ("PENDING", None)

    import stripe
    stripe.api_key = stripe_secret

    start = int((order_date - timedelta(days=window_days)).timestamp())
    end = int((order_date + timedelta(days=window_days + 1)).timestamp())

    # Stripe amounts are in the smallest currency unit (fils/halalas/cents)
    target_minor = round(float(amount) * 100)
    tol_minor = round(float(tolerance) * 100)
    cur = (currency or "").lower() if isinstance(currency, str) else ""

    matches = []
    charges = stripe.Charge.list(
        created={"gte": start, "lte": end},
        limit=100,
    )
    for ch in charges.auto_paging_iter():
        if ch.get("status") != "succeeded":
            continue
        if cur and ch.get("currency", "").lower() != cur:
            continue
        if abs(ch["amount"] - target_minor) <= tol_minor:
            matches.append(ch["id"])

    if len(matches) == 1:
        return ("PAID", matches[0])
    if len(matches) == 0:
        return ("PENDING", None)
    return ("AMBIGUOUS", len(matches))
