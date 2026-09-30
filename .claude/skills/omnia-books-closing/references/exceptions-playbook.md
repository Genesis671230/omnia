# Exceptions playbook

The dry run sorts most orders into the groups in SKILL.md. This file is for the ones
that look wrong for a reason the groups don't explain. Each entry is a real incident:
the symptom the founder saw, how to prove the cause cheaply, the fix, and whether the
agent may book it or must flag it.

The rule under all of them: **prove before you post.** Read Zoho, Stripe and the
payout rows until the numbers foot; if they don't foot, flag with both numbers.

## Contents
1. Bank credit with no payout ("Network International", no rail token)
2. One order, several charges in one payout
3. One order split across two payouts
4. Sale and refund of the same order on one payout
5. "Booked" in Omnia, missing in Zoho
6. Stripe live proof shows net 0 / rows don't foot
7. Unlabelled charges and disputes on a Stripe payout
8. Invoice paid by hand, then refunded
9. Two invoices for one order
10. Re-sync created a duplicate payout
11. Zoho API limits that stop a run
12. Flagging for review: the protocol

---

## 1. Bank credit with no payout ("Network International", no rail token)

**Symptom.** Credit shows "Awaiting payout · No file", narration contains
`NETWORK INTERNATIONAL LLC` but no `STRIPE-…` / `SHOPIFY-…` token, e.g.
`…/AE9002…/BATCB1muf2v44411/IPPCG1muf4hlma00/…\HCP`.

**Why.** Network International settles both Stripe and Shopify Payments. Without a
token the classifier guesses Stripe (`confidence: "inferred"`). FT26267TVX45 AED 785.79
was Shopify Payments UAE payout 149110423710.

**Prove.** `select * from payouts where net_amount between X-0.01 and X+0.01` across
Stripe *and* Shopify; also Stripe `GET /v1/payouts` around the date.

**Fix.** The engine now lets acquirer-inferred credits match either rail on the exact
amount (±0.01) and takes the payout's gateway. If nothing matches on either rail →
flag: "No Stripe or Shopify payout of X found; upload the payout".

## 2. One order, several charges in one payout

**Symptom.** Invoice 1,024.00 vs "gateway amount 341.34" (WA55596), or invoice
1,396.75 vs 1,326.75, "off by 70.00" (WA55581).

**Why.** The customer paid in parts (3 × 341.34; 1,326.75 + 70.00). An old save step
kept only one charge per order, so the drawer showed a partial amount.

**Prove.** Stripe `GET /v1/charges/search?query=amount:<fils>` (description is NOT a
searchable field), then `GET /v1/balance_transactions?payout=po_…` to see which payout
each charge is in. Sum the charges: they should equal the invoice (±0.05).

**Fix.** Re-save the payout from the API (`payoutOrderRefs` → `PayoutsRepository.upsertPayouts`);
charges of the same order and direction are now summed into one row. Then the normal
dry run plans one payment for the full invoice. **Book** when it foots; the "mismatch"
was never real.

## 3. One order split across two payouts

**Symptom.** Same order in two credits, each flagged "doesn't match": 70.00 on one
and 2,487.00 on another, invoice 2,557.00 (WA55612).

**Prove.** The parts sum to the open invoice balance exactly, one open invoice only.

**Fix.** Force allocation per settlement record (`POST /api/settlements/[id]/force`
or its handler): each part applied to the same invoice, dated on its own bank credit,
with a description naming the split. Then run `publishSettlements` for each record to
book its fee. **Book** only if the parts foot exactly; otherwise flag (WA55597:
24.95 + 867.93 = 892.88 vs invoice 988.52 → flag).

## 4. Sale and refund of the same order on one payout

**Symptom.** Only a refund row shows for an order that was also sold on that payout
(WA55588 Tabby, WA55548 Stripe); the invoice never closes; refund amounts look odd.

**Why.** Parser, save step and engine each used to key rows by order alone.

**Fix (in code now).** Rows are keyed by order + direction everywhere. If an old payout
still shows the merged row, re-upload the file (raw files are not stored) or re-sync
from the API. Book the sale normally; the refund books through "Refunds on this payout".

## 5. "Booked" in Omnia, missing in Zoho

**Symptom.** Drawer says booked; the Zoho ledger shows the customer payment but no fee
expense (Shopify 3470, SA3926…), or no exchange journal (Tamara 3469, 3477).

**Why.** Someone deleted the document in Zoho after posting; `settlement_records`
kept the id. Our revert flow logs every delete in `payout_reverts`; if the id isn't
there, it was deleted by hand.

**Prove.** `GET /expenses/{id}` or `/journals/{id}` → 404 "does not exist". The Ledger
tab's close checklist lists these from the snapshot at zero API cost.

**Fix.** Booking now re-checks stored fee/FX ids (`zohoDocumentExists`) and re-posts
when gone; "Check invoices in Zoho" clears dead ids so the order becomes selectable.
**Book** (payment already exists; only the missing document is re-posted).

## 6. Stripe live proof shows net 0 / rows don't foot

**Symptom.** "Rows add up to 10,759.03 but the payout file totals 0.00", Net settled 0.00.

**Why.** Stripe's balance transactions for a payout include the payout's own row
(type `payout`, −net) and charges with a blank description. Fixed in `payoutOrderRefs`.
If you see it again, something reintroduced summing the payout row.

## 7. Unlabelled charges and disputes on a Stripe payout

**Symptom.** Unmatched lines named `ch_…` (charge without an order in its
description) or `du_…` (a dispute / chargeback).

**Fix.** Never guess the order from the amount alone. Flag: "Unmatched charge ch_… (net
X) — Link order"; a `du_…` line is a chargeback and always goes to the founder.

## 8. Invoice paid by hand, then refunded

**Symptom.** Invoice paid (balance 0) outside Omnia; payout shows the sale, a later
payout shows a refund, a credit note is refunded (WA55470: 4,442.07 invoice, 4,434.18
sale, 4,244.71 refund via OCN-03558).

**Fix.** Flag. The fee on the sale and what the customer kept (189.47) are judgement
calls: was the fee booked by hand? is the kept amount a restocking charge? Offer the
options; don't post.

## 9. Two invoices for one order

Usually an exchange (one paid, a new open one) or a duplicate sync. Group B / D in
SKILL.md. Flag with both invoice numbers, status and amount; void-or-apply is the
founder's call.

## 10. Re-sync created a duplicate payout

**Symptom.** Two payouts, one id with a 6-hex suffix (`STRIPE-po_…-33c6b7`), same net.

**Why.** Payout identity fingerprinted the order list; a corrected list looked like a
new payout. Fixed: Stripe `po_…` and Shopify numeric ids are authoritative.

**Fix if it recurs.** Check nothing references the suffixed id (any table with a
`payout_id` column), delete it with `PayoutsRepository.deletePayout`, re-save the original.
Duplicates of the same amount can steal a bank credit; clean them the same day.

## 11. Zoho API limits that stop a run

| Limit | What happens | Do this |
|---|---|---|
| `/chartofaccounts/transactions` per minute (~50/min) | code 43, blocked **1 hour** for that endpoint only | Pace ≥ 2.5 s/call (the ledger sync does) |
| OAuth token refresh | "too many requests continuously" | One token per job: do everything in **one** script process; don't spawn a script per lookup |
| Daily (headers say 15,000; throttle budget `ZOHO_DAILY_BUDGET`) | `ZohoQuotaExceededError` | `zohoQuotaStatus()` before a big run |
| Retry-After > 2 min | throttle returns the 429 instead of stalling everything | Report and resume later |

## 12. Flagging for review: the protocol

When something can't be booked safely, flag the **bank credit** so it surfaces in the
app, and write a note a busy founder can act on without opening anything:

```ts
import { flagLine } from "@/lib/reconciliation/engine";
await flagLine(bankLineId, true,
  "[Sept Stripe close 2026-09-26] WA55563: invoice 3,035.00 vs Stripe 3,058.19 (overpaid +23.19) · Refund WA55446: not booked yet");
```

- One item per order, separated by ` · `; each names the order, both amounts and the
  signed gap, and the action ("pick invoice", "Link order", "book by hand").
- Prefix with the close run's tag so a later run can replace its own notes; keep any
  earlier human note after `earlier:`.
- Before flagging refunds, check `refund_postings` and only list what is truly unbooked.
- When an item is resolved in the same run, remove it from the note (split on ` · `).
