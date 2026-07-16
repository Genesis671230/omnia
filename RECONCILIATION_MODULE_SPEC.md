# Omnia Finance OS — Reconciliation Module (Finalized Spec)

**Scope:** Tabby (KSA/UAE/KWD), Tamara (KSA/UAE), extensible to Stripe/Telr/Checkout/COD.
**Author context:** finalized after the KSA-SAR order proved the order sync cannot emit AED.

---

## 0. The one rule everything else obeys

**No amount is AED until the bank credits it.** The order sync records *shop-currency facts*. The
reconciliation job is the *only* place an AED figure is ever created, and it is created by dividing a
real bank credit by the payout batch it settles — never by any order-side or gateway-side rate.

Corollary that fixes the current bug: **delete every `toAed()` call in the order sync.** The
Shopify `shop_money` field is the *shop* currency (AED for UAE/WA, **SAR for KSA**), not a universal
AED base. Treating it as AED is exactly what produced `subtotal_aed = 3763.80` (which was SAR).

---

## 1. Confirmed settlement facts (basis for the design)

| Fact | Value | Consequence |
|---|---|---|
| Settlement pooling | **One AED bank credit per currency-batch** (SAR batch separate from KWD batch) | Every batch is single-currency → batch FX is exact, never ambiguous |
| Payout file currency | **Original currency only** (no AED, no FX in the file) | FX must be *derived* from bank ÷ Σ(file) |
| Fee visibility | **Fee shown per line** | `net = gross − fee` known per order → cent-level audit possible |
| Join key | **Order ID / order number** | Line ↔ order join is deterministic, scoped by (gateway, currency) |

---

## 2. The three canonical objects (strict order)

### 2.1 Bank credit — TRUTH
One AED deposit landing from a gateway, for one currency-batch.

```
bank_credit_id · gateway · settlement_currency · bank_credit_aed · value_date · bank_ref
```

Bank keyword → gateway map (from skill): Tabby → `TABBY LLC FZ`; Tamara → `TAMARA FZE`;
Telr → `INNOVATE TECHNOLOGIES`; Stripe → `NETWORK...STRIPE`; Checkout → `Checkout MENA`.

### 2.2 Payout batch — THE BRIDGE (where FX is born)
A payout file = a set of order lines in original currency that sum to exactly one bank credit.

```
batch_fx = bank_credit_aed / Σ(payout_line.net_original)
```

Because every batch is single-currency, this divide is exact. `batch_fx` is the *settlement* FX
(e.g. 0.953453 for a SAR→AED batch) and applies to every line in the batch.

**Validation gate (the delta-0.00 gate):**
```
| Σ(payout_line.net_original) × batch_fx − bank_credit_aed | < TOLERANCE   (TOLERANCE = 0.01 AED)
```
By construction this is ~0; it exists to catch a wrong bank↔file pairing, a missing line, or a
parse error. Fail → the batch is `quarantined`, never attributed.

### 2.3 Order attribution — DERIVED AED
Only now are AED figures written back to the order.

```
gross_aed        = payout_line.gross_original × batch_fx
fee_aed          = payout_line.fee_original   × batch_fx
net_received_aed = payout_line.net_original    × batch_fx
exchange_rate    = batch_fx
bank_credit_ref  = bank_credit_id
payout_status    = 'reconciled'
```

---

## 3. The settlement key (this is what your gateway×currency matrix needs)

Gateway alone is insufficient: Tabby settles into SAR, AED and KWD batches; Tamara into SAR and AED.
The settlement identity is the **pair**:

```
settlement_key = (gateway, settlement_currency)
```

| settlement_key | Store origin | Bank credit currency-batch | FX status |
|---|---|---|---|
| `Tabby|AED`   | UAE          | AED credit | rate = 1.0 (still validated) |
| `Tabby|SAR`   | KSA          | AED credit (SAR batch) | derived per batch |
| `Tabby|KWD`   | KWD orders   | **no AED credit yet** | `fx_pending` |
| `Tamara|AED`  | UAE          | AED credit | rate = 1.0 |
| `Tamara|SAR`  | KSA          | AED credit (SAR batch) | derived per batch |

A `Tabby|SAR` payout line can NEVER match a `Tabby|KWD` order. Scope every join by the pair.

**KWD handling (no longer a hack):** KWD is simply "a currency-batch whose AED bank credit has not
landed." Lines sit in `fx_pending` until a KWD-origin AED credit appears, then resolve through the
identical divide. This formalizes the existing `FX_PENDING` quarantine.

---

## 4. Reconciliation state machine (per order line)

```
awaiting            order synced, no payout line found yet
matched_in_batch    payout line found, batch not yet tied to a bank credit
fx_resolved         batch tied to bank credit, batch_fx derived
reconciled          settled AED attributed, batch delta within tolerance
fx_pending          currency batch has no AED bank credit yet (all-KWD today)
quarantined         batch sum mismatch / no bank match / mixed currency detected
```

Forward-only, except `quarantined`/`fx_pending` → `reconciled` when the missing bank credit arrives.

---

## 5. Field model (what each stage writes)

### 5.1 Order sync emits — SHOP CURRENCY, never AED
Rename all `*_aed` → shop-currency. One field set, both platforms:
```
gross · subtotal · shipping · tax · discount · currency · gateway · store · order_id · order_number
```
Settlement fields stay blank (`payout_status='awaiting'`) exactly as today.

Field mapping corrections:
- **Shopify:** use `*_set.shop_money.amount` as the **shop-currency** amount and
  `*_set.shop_money.currency_code` as `currency`. Do NOT assume it is AED. KSA = SAR.
- **WooCommerce:** `total` is in the store's base currency as-is. **Delete the `wmc_order_info`
  divide** — it produced a third, unrelated wrong rate. Emit raw `total`, tag `currency`.

### 5.2 Payout parser emits — per line, ORIGINAL currency
```
payout_id · gateway · settlement_currency · order_id ·
gross_original · fee_original · net_original
```
`net_original = gross_original − fee_original` (validate the file's own net equals this).

### 5.3 Reconcile writes back — AED, derived only after bank match
```
batch_fx · gross_aed · fee_aed · net_received_aed · bank_credit_ref · payout_status='reconciled'
```

---

## 6. Reconcile algorithm (pseudocode)

```
for each payout_batch (grouped by payout_id):
    sc            = settlement_currency of the batch          # single by construction
    gateway       = batch.gateway
    sum_net_orig  = Σ line.net_original

    bank = find_bank_credit(gateway, settlement_currency=sc, near value_date)
    if not bank:
        mark batch fx_pending (if sc has no credits yet) else quarantined
        continue

    batch_fx = bank.bank_credit_aed / sum_net_orig

    # gate
    if | sum_net_orig * batch_fx - bank.bank_credit_aed | >= TOLERANCE:
        quarantine(batch); continue

    for line in batch:
        order = find_order(order_id=line.order_id, gateway, currency=sc)   # scoped by pair
        if not order: record anomaly (payout line with no order); continue
        write settled AED to order using batch_fx
        order.payout_status = 'reconciled'
```

Anomalies (unchanged three buckets): payout line with no order; bank credit with no batch;
batch delta ≠ 0.

---

## 7. Build order

1. **Src fix** — order sync: strip `toAed`, rename to shop currency, tag `currency` correctly
   (KSA→SAR). *Everything downstream is wrong until this ships.*
2. **Tabby parser** — emit per-line gross/fee/net + settlement_currency (needs one real file).
3. **Tamara parser** — same shape.
4. **Reconcile node** — batch-FX derive + gate + attribution + state machine.
5. **Wire KWD** — confirm `fx_pending` path with a real KWD batch.

---

## 8. Open items to confirm against real files (before coding parsers)

- Exact column names + which column is gross vs fee vs net in the Tabby file.
- Exact column names in the Tamara file.
- Where the payout_id lives (banner row like Telr? column? filename?).
- Whether the file states its own currency, or currency must be inferred from the store/batch.
- Tolerance: 0.01 AED assumed; confirm rounding convention (banker's vs half-up) matches bank.
