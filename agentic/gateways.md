# Gateways — confirmation rules

The operator's biggest manual cost: checking each gateway to see if money
actually landed before confirming. Only ONE gateway can be automated.

| Gateway       | Region  | API confirm? | How the agent handles it |
|---------------|---------|--------------|--------------------------|
| Stripe        | intl    | ✅ YES       | Auto-verify by amount + date (no order-ID link exists). Mark PAID. |
| Telr          | UAE/KSA | ❌ no        | Flag NEEDS-EYE. Operator checks Telr dashboard. |
| Tamara KSA    | KSA     | ❌ broken    | Flag NEEDS-EYE. Manual. |
| Tamara UAE    | UAE     | ❌ broken    | Flag NEEDS-EYE. Manual. |
| Tabby UAE     | UAE     | ❌ broken    | Flag NEEDS-EYE. Manual. |
| Tabby KSA     | KSA     | ❌ broken    | Flag NEEDS-EYE. Manual. |
| Tabby KWD     | KWD     | ❌ broken    | Flag NEEDS-EYE. Manual. |
| Checkout      | both    | ❌ broken    | Flag NEEDS-EYE. Manual. |
| COD           | local   | n/a          | No prepayment. Confirm on delivery. Flag COD. |

## Stripe confirmation logic (the only automatable one)
Stripe transactions here have NO Omnia order-ID attached, so we match by
**amount + date window**:
- Given order amount A (in the charge currency) and order date D,
- List Stripe charges where `status == 'succeeded'`, `amount == A`,
  `created` within D ± 1 day,
- If exactly one match → PAID ✅ (record charge id).
- If zero → PENDING.
- If several → AMBIGUOUS 👁️ (send to operator; don't auto-confirm).

Amount/date matching is imperfect — never hard-confirm on a multi-match.
